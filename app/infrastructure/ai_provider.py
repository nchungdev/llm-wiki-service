from google import genai
import logging
import os
import httpx
import json
from typing import List, Optional
from .rate_limiter import AsyncRateLimiter

logger = logging.getLogger(__name__)

class AIProvider:
    def __init__(self, api_key: str = None, model_name: str = None, provider_type: str = None,
                 max_rpm: int = 15, max_tpm: int = 30000,
                 gcp_project: str = None, gcp_location: str = None, gcp_key_file: str = None):
        
        self.provider_type = provider_type or os.getenv("AI_PROVIDER", "ollama")
        self.ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
        self.api_key = api_key
        
        # Rate Limiter
        self.limiter = AsyncRateLimiter(max_rpm, max_tpm)

        # Configs for other providers (to allow fallback)
        self.gcp_project = gcp_project
        self.gcp_location = gcp_location
        self.gcp_key_file = gcp_key_file

        # Model Names
        default_model = "llama3.1:8b" if self.provider_type == "ollama" else "publishers/google/models/gemini-2.5-flash"
        self.model_name = model_name or os.getenv("AI_MODEL", default_model)
        self.heavy_model = os.getenv("AI_HEAVY_MODEL", "gemma4")

        # Initialize Clients
        self.clients = {} # Store multiple clients
        self.is_fallback = False
        self._init_clients()

    def _init_clients(self):
        """Initialize all possible clients based on configuration."""
        # 1. Gemini
        if self.api_key:
            try:
                self.clients["gemini"] = genai.Client(api_key=self.api_key)
                logger.debug("✅ Gemini client initialized")
            except Exception as e:
                logger.error(f"Failed to init Gemini client: {e}")

        # 2. Vertex AI
        key_path = self.gcp_key_file or os.getenv("GCP_KEY_FILE")
        if key_path and os.path.exists(key_path):
            try:
                from google.oauth2 import service_account
                creds = service_account.Credentials.from_service_account_file(
                    key_path,
                    scopes=["https://www.googleapis.com/auth/cloud-platform"]
                )
                proj = self.gcp_project or getattr(creds, 'project_id', None) or os.getenv("GCP_PROJECT_ID")
                loc = self.gcp_location or os.getenv("GCP_LOCATION", "us-central1")
                
                if proj:
                    self.clients["vertexai"] = genai.Client(
                        vertexai=True,
                        project=proj,
                        location=loc,
                        credentials=creds
                    )
                    logger.debug(f"✅ Vertex AI client initialized (project={proj})")
            except Exception as e:
                logger.error(f"Failed to init Vertex AI client: {e}")

        # Validation of primary provider
        if self.provider_type == "gemini" and "gemini" not in self.clients:
            logger.warning("⚠️ Gemini selected but no API key. Fallback enabled.")
            self.is_fallback = True
        elif self.provider_type == "vertexai" and "vertexai" not in self.clients:
            logger.warning("⚠️ VertexAI selected but not configured. Fallback enabled.")
            self.is_fallback = True

    async def generate_content(self, prompt: str):
        active_provider = self.provider_type
        if self.is_fallback:
            active_provider = "ollama"

        # Try active provider
        try:
            return await self._call_provider(active_provider, prompt)
        except Exception as e:
            logger.warning(f"Primary provider {active_provider} failed: {e}. Trying fallbacks...")
            for f in ["gemini", "vertexai", "ollama"]:
                if f == active_provider: continue
                if f in ("gemini", "vertexai") and f not in self.clients: continue
                try:
                    res = await self._call_provider(f, prompt)
                    logger.info(f"✅ Fallback successful using {f}")
                    return res
                except: continue
            raise e

    async def _call_provider(self, provider: str, prompt: str):
        if provider in ("gemini", "vertexai"):
            client = self.clients.get(provider)
            if not client: raise ValueError(f"Provider {provider} not ready")
            await self.limiter.wait_for_slot(len(prompt) // 2)
            
            model = self.model_name
            logger.info(f"🚀 Calling {provider} with model: {model}")
            
            try:
                response = await client.aio.models.generate_content(
                    model=model,
                    contents=prompt
                )
            except Exception as e:
                if "404" in str(e):
                    logger.warning(f"⚠️ Model {model} not found (404) on {provider}. Attempting dynamic discovery...")
                    # Try to find ANY available model to prevent failure
                    try:
                        available = []
                        for m in client.models.list():
                            name = m.name
                            if "gemini" in name and "embedding" not in name and "tts" not in name \
                                    and "image" not in name and "audio" not in name:
                                available.append(name)

                        if available:
                            # Prefer flash, use full path as model ID
                            fallback_model = next((m for m in available if "flash" in m.lower() and "preview" not in m.lower()), available[0])
                            logger.info(f"🔄 Dynamic fallback found: {fallback_model}. Retrying...")
                            response = await client.aio.models.generate_content(
                                model=fallback_model,
                                contents=prompt
                            )
                        else:
                            raise e
                    except Exception as fe:
                        logger.error(f"Dynamic discovery failed: {fe}")
                        raise e
                else:
                    raise e

            usage = getattr(response, 'usage_metadata', None)
            total_tokens = usage.total_token_count if usage else len(response.text) // 2
            await self.limiter.record_usage(total_tokens)
            return response.text
        else:
            # Ollama
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{self.ollama_host}/api/generate",
                    json={"model": self.model_name, "prompt": prompt, "stream": False}
                )
                resp.raise_for_status()
                return resp.json().get("response", "")

    async def generate_structured_json(self, prompt: str, use_heavy_model: bool = False):
        active_provider = self.provider_type
        if self.is_fallback: active_provider = "ollama"
        try:
            return await self._call_provider_structured(active_provider, prompt, use_heavy_model)
        except Exception as e:
            logger.warning(f"Primary provider {active_provider} failed (Structured): {e}. Trying fallbacks...")
            for f in ["gemini", "vertexai", "ollama"]:
                if f == active_provider: continue
                if f in ("gemini", "vertexai") and f not in self.clients: continue
                try:
                    return await self._call_provider_structured(f, prompt, use_heavy_model)
                except: continue
            raise e

    async def _call_provider_structured(self, provider: str, prompt: str, use_heavy_model: bool):
        if provider in ("gemini", "vertexai"):
            client = self.clients.get(provider)
            if not client: raise ValueError(f"Provider {provider} not ready")
            await self.limiter.wait_for_slot(len(prompt) // 2)
            
            model = self.model_name
            logger.info(f"🚀 Calling {provider} (Structured) with model: {model}")

            try:
                response = await client.aio.models.generate_content(
                    model=model,
                    contents=prompt,
                    config={'response_mime_type': 'application/json'}
                )
            except Exception as e:
                if "404" in str(e):
                    logger.warning(f"⚠️ Model {model} not found (404). Attempting dynamic discovery...")
                    try:
                        available = []
                        async for m in client.aio.models.list():
                            if 'generateContent' in m.supported_generation_methods:
                                available.append(m.name)
                        if available:
                            fallback_model = next((m for m in available if "flash" in m.lower()), available[0])
                            logger.info(f"🔄 Dynamic fallback found: {fallback_model}. Retrying...")
                            response = await client.aio.models.generate_content(
                                model=fallback_model,
                                contents=prompt,
                                config={'response_mime_type': 'application/json'}
                            )
                        else: raise e
                    except: raise e
                else: raise e

            usage = getattr(response, 'usage_metadata', None)
            total_tokens = usage.total_token_count if usage else len(response.text) // 2
            await self.limiter.record_usage(total_tokens)
            return json.loads(response.text)
        else:
            import re
            model = self.heavy_model if use_heavy_model else self.model_name
            keep_alive = "0" if use_heavy_model else "5m"
            async with httpx.AsyncClient(timeout=180.0) as client:
                resp = await client.post(
                    f"{self.ollama_host}/api/generate",
                    json={
                        "model": model,
                        "prompt": prompt + "\n\nQUAN TRỌNG: CHỈ TRẢ VỀ JSON. Đảm bảo JSON hợp lệ.",
                        "format": "json",
                        "stream": False,
                        "keep_alive": keep_alive,
                        "options": {"num_ctx": 16384}
                    }
                )
                resp.raise_for_status()
                raw_response = resp.json().get("response", "{}").strip()
                try:
                    return json.loads(raw_response)
                except json.JSONDecodeError:
                    match = re.search(r'(\{.*\})', raw_response, re.DOTALL)
                    if match:
                        clean_json = match.group(1)
                        clean_json = re.sub(r'"((?:\\.|[^"\\])*)"', lambda m: m.group(0).replace('\n', '\\n'), clean_json)
                        try: return json.loads(clean_json)
                        except: pass
                    raise

    def update_config(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        if api_key:
            self.api_key = api_key
        if model_name:
            self.model_name = model_name
        self._init_clients()
        logger.info(f"🔄 AIProvider updated: provider={self.provider_type}, model={self.model_name}")

    async def check_availability(self):
        """Check connectivity for all providers."""
        status = {
            "ollama": {"available": False, "message": "Not found"},
            "gemini": {"available": False, "message": "Missing API Key"},
            "vertexai": {"available": False, "message": "Missing GCP Key"}
        }
        # 1. Ollama
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"{self.ollama_host}/api/tags")
                if resp.status_code == 200:
                    status["ollama"] = {"available": True, "message": "Ready"}
        except: pass

        # 2. Gemini
        if "gemini" in self.clients:
            status["gemini"] = {"available": True, "message": "Ready"}
        
        # 3. Vertex AI
        if "vertexai" in self.clients:
            status["vertexai"] = {"available": True, "message": "Ready"}

        return status

    async def get_available_models(self, provider_type: Optional[str] = None):
        """Fetch models from specific or all configured providers."""
        models = []
        target = provider_type or self.provider_type
        
        # 1. Try Gemini
        if target == "gemini" and "gemini" in self.clients:
            try:
                async for m in self.clients["gemini"].aio.models.list():
                    if 'generateContent' in m.supported_generation_methods:
                        name = m.name # Use full name as ID
                        label = name.replace("models/", "")
                        models.append({"id": name, "label": label})
            except: pass

        # 2. Try Vertex — model ID must be the full "publishers/google/models/..." path
        if target == "vertexai" and "vertexai" in self.clients:
            try:
                for m in self.clients["vertexai"].models.list():
                    name = m.name  # e.g. "publishers/google/models/gemini-2.5-flash"
                    if "gemini" in name and "embedding" not in name and "tts" not in name \
                            and "image" not in name and "audio" not in name and "computer" not in name:
                        label = name.split("/")[-1]
                        models.append({"id": name, "label": label})
            except: pass

        # 3. Try Ollama
        if target == "ollama":
            try:
                async with httpx.AsyncClient(timeout=3.0) as client:
                    resp = await client.get(f"{self.ollama_host}/api/tags")
                    if resp.status_code == 200:
                        for m in resp.json().get("models", []):
                            name = m["name"]
                            models.append({"id": name, "label": name})
            except: pass

        if not models:
            if target == "ollama":
                return [{"id": "llama3.1:8b", "label": "llama3.1:8b (Default)"}]
            elif target == "gemini":
                return [
                    {"id": "gemini-2.0-flash-001", "label": "gemini-2.0-flash-001"},
                    {"id": "gemini-2.0-flash", "label": "gemini-2.0-flash"},
                    {"id": "gemini-2.5-flash-preview-05-20", "label": "gemini-2.5-flash-preview"},
                ]
            elif target == "vertexai":
                return [
                    {"id": "publishers/google/models/gemini-2.5-flash", "label": "gemini-2.5-flash"},
                    {"id": "publishers/google/models/gemini-2.5-pro", "label": "gemini-2.5-pro"},
                    {"id": "publishers/google/models/gemini-2.0-flash-001", "label": "gemini-2.0-flash-001"},
                ]

        return sorted(models, key=lambda x: x["label"])
