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

        # Model Names (Initially empty if not in env, will discover dynamically if needed)
        self.model_name = model_name or os.getenv("AI_MODEL")
        self.heavy_model = os.getenv("AI_HEAVY_MODEL")

        # Initialize Clients
        self.clients = {} # Store multiple clients
        self.is_fallback = False
        self._init_clients()

        # If no model specified, we'll try to pick one dynamically later during first call
        # but let's log the initial state
        if not self.model_name:
            logger.info("ℹ️ No AI_MODEL specified. Will perform dynamic discovery on first call.")

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
            logger.warning(f"Primary provider {active_provider} failed: {type(e).__name__}: {e}. Trying fallbacks...")
            for f in ["gemini", "vertexai", "ollama"]:
                if f == active_provider: continue
                if f in ("gemini", "vertexai") and f not in self.clients: continue
                try:
                    res = await self._call_provider(f, prompt)
                    logger.info(f"✅ Fallback successful using {f}")
                    return res
                except Exception as fe:
                    logger.warning(f"  Fallback {f} also failed: {type(fe).__name__}: {fe}")
                    continue
            raise e

    async def _call_provider(self, provider: str, prompt: str):
        if provider in ("gemini", "vertexai"):
            client = self.clients.get(provider)
            if not client: raise ValueError(f"Provider {provider} not ready")
            await self.limiter.wait_for_slot(len(prompt) // 2)
            
            # ── Dynamic Model Discovery ────────────────────────
            if not self.model_name:
                logger.info(f"🔍 Discovering models for {provider}...")
                available = await self.get_available_models(provider)
                if available:
                    # Logic: Prefer flash, then anything available
                    best = next((m["id"] for m in available if "flash" in m["id"].lower() and "preview" not in m["id"].lower()), available[0]["id"])
                    self.model_name = best
                    logger.info(f"✨ Auto-selected model: {self.model_name}")
                else:
                    raise ValueError(f"No models available on {provider}")

            model = self.model_name
            logger.info(f"🚀 Calling {provider} with model: {model}")
            
            try:
                response = await client.aio.models.generate_content(
                    model=model,
                    contents=prompt
                )
            except Exception as e:
                if "404" in str(e) or "NOT_FOUND" in str(e):
                    logger.warning(f"⚠️ Model {model} not found (404) on {provider}. Re-discovering...")
                    available = await self.get_available_models(provider)
                    if available:
                        fallback_model = next((m["id"] for m in available if "flash" in m["id"].lower() and "preview" not in m["id"].lower() and m["id"] != model), available[0]["id"])
                        logger.info(f"🔄 Dynamic fallback found: {fallback_model}. Retrying...")
                        self.model_name = fallback_model # Update to valid model
                        response = await client.aio.models.generate_content(
                            model=fallback_model,
                            contents=prompt
                        )
                    else: raise e
                else: raise e

            usage = getattr(response, 'usage_metadata', None)
            total_tokens = usage.total_token_count if usage else len(response.text) // 2
            await self.limiter.record_usage(total_tokens)
            return response.text
        else:
            # Ollama — validate model_name (may be a Gemini/Vertex path when falling back)
            available = await self.get_available_models("ollama")
            if not available:
                raise ValueError("No Ollama models found. Please pull a model first (e.g. `ollama pull llama3.1`).")
            ollama_ids = {m["id"] for m in available}
            if not self.model_name or self.model_name not in ollama_ids:
                if self.model_name:
                    logger.warning(f"⚠️ model_name '{self.model_name}' is not an Ollama model. Auto-selecting.")
                self.model_name = available[0]["id"]

            async with httpx.AsyncClient(timeout=300.0) as client:
                resp = await client.post(
                    f"{self.ollama_host}/api/generate",
                    json={"model": self.model_name, "prompt": prompt, "stream": False,
                          "options": {"num_ctx": 16384}}
                )
                resp.raise_for_status()
                return resp.json().get("response", "")

    async def generate_structured_json(self, prompt: str, use_heavy_model: bool = False):
        active_provider = self.provider_type
        if self.is_fallback: active_provider = "ollama"
        try:
            return await self._call_provider_structured(active_provider, prompt, use_heavy_model)
        except Exception as e:
            logger.warning(f"Primary provider {active_provider} failed (Structured): {type(e).__name__}: {e}. Trying fallbacks...")
            for f in ["gemini", "vertexai", "ollama"]:
                if f == active_provider: continue
                if f in ("gemini", "vertexai") and f not in self.clients: continue
                try:
                    return await self._call_provider_structured(f, prompt, use_heavy_model)
                except Exception as fe:
                    logger.warning(f"  Fallback {f} (Structured) also failed: {type(fe).__name__}: {fe}")
                    continue
            raise e

    async def _call_provider_structured(self, provider: str, prompt: str, use_heavy_model: bool):
        if provider in ("gemini", "vertexai"):
            client = self.clients.get(provider)
            if not client: raise ValueError(f"Provider {provider} not ready")
            await self.limiter.wait_for_slot(len(prompt) // 2)
            
            # Dynamic selection if missing
            if not self.model_name:
                available = await self.get_available_models(provider)
                if available:
                    self.model_name = next((m["id"] for m in available if "flash" in m["id"].lower()), available[0]["id"])
                else: raise ValueError("No models found")

            model = self.model_name
            logger.info(f"🚀 Calling {provider} (Structured) with model: {model}")

            try:
                response = await client.aio.models.generate_content(
                    model=model,
                    contents=prompt,
                    config={'response_mime_type': 'application/json'}
                )
            except Exception as e:
                if "404" in str(e) or "NOT_FOUND" in str(e):
                    logger.warning(f"⚠️ Model {model} not found (404). Re-discovering...")
                    available = await self.get_available_models(provider)
                    if available:
                        fallback_model = next((m["id"] for m in available if "flash" in m["id"].lower() and m["id"] != model), available[0]["id"])
                        logger.info(f"🔄 Dynamic fallback: {fallback_model}")
                        self.model_name = fallback_model
                        response = await client.aio.models.generate_content(
                            model=fallback_model,
                            contents=prompt,
                            config={'response_mime_type': 'application/json'}
                        )
                    else: raise e
                else: raise e

            usage = getattr(response, 'usage_metadata', None)
            total_tokens = usage.total_token_count if usage else len(response.text) // 2
            await self.limiter.record_usage(total_tokens)
            return json.loads(response.text)
        else:
            import re
            # Fetch available Ollama models once for all validation below
            ollama_available = await self.get_available_models("ollama")
            if not ollama_available:
                raise ValueError("No Ollama models found. Please pull a model first (e.g. `ollama pull llama3.1`).")
            ollama_ids = {m["id"] for m in ollama_available}

            # Ollama dynamic heavy selection
            if use_heavy_model and (not self.heavy_model or self.heavy_model not in ollama_ids):
                self.heavy_model = next(
                    (m["id"] for m in ollama_available if "70b" in m["id"].lower() or "pro" in m["id"].lower()),
                    ollama_available[0]["id"]
                )

            # Validate model_name — may be a Gemini/Vertex path when falling back from another provider
            if not self.model_name or self.model_name not in ollama_ids:
                if self.model_name:
                    logger.warning(f"⚠️ model_name '{self.model_name}' is not an Ollama model. Auto-selecting from available Ollama models.")
                self.model_name = ollama_available[0]["id"]
                logger.info(f"🔄 Ollama fallback model selected: {self.model_name}")
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

    def for_request(self, provider_type: Optional[str] = None, model_name: Optional[str] = None) -> "AIProvider":
        """Return a lightweight copy of this provider with a different active provider/model.
        Reuses already-initialized clients — no new auth round-trips."""
        if not provider_type or provider_type == self.provider_type:
            if not model_name or model_name == self.model_name:
                return self  # nothing to override
        import copy
        clone = copy.copy(self)  # shallow copy — shares clients dict
        if provider_type:
            clone.provider_type = provider_type
            clone.is_fallback = provider_type in ("gemini", "vertexai") and provider_type not in self.clients
        if model_name:
            clone.model_name = model_name
        return clone

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
        """Fetch models from specific or all configured providers. 100% Dynamic."""
        models = []
        target = provider_type or self.provider_type
        
        # 1. Try Gemini (sync iterator — aio.models.list() returns a coroutine, not async iterator)
        if target == "gemini" and "gemini" in self.clients:
            try:
                for m in self.clients["gemini"].models.list():
                    name = m.name  # e.g. "models/gemini-2.0-flash"
                    label = name.replace("models/", "")
                    # Only include models that support generateContent and are not deprecated/experimental
                    supported = getattr(m, 'supported_actions', None) or getattr(m, 'supported_generation_methods', [])
                    if supported and 'generateContent' not in supported:
                        continue
                    if "gemini" in name and "embedding" not in name and "tts" not in name \
                            and "image" not in name and "audio" not in name:
                        # Use short name (without "models/" prefix) for API calls
                        models.append({"id": label, "label": label})
            except Exception as e:
                logger.error(f"Error fetching Gemini models: {e}")

        # 2. Try Vertex — model ID must be the full "publishers/google/models/..." path
        if target == "vertexai" and "vertexai" in self.clients:
            try:
                # Vertex models.list is synchronous in some SDK versions or uses different iterator
                for m in self.clients["vertexai"].models.list():
                    name = m.name  # e.g. "publishers/google/models/gemini-1.5-flash"
                    if "gemini" in name and "embedding" not in name and "tts" not in name \
                            and "image" not in name and "audio" not in name and "computer" not in name:
                        label = name.split("/")[-1]
                        models.append({"id": name, "label": label})
            except Exception as e:
                logger.error(f"Error fetching Vertex models: {e}")

        # 3. Try Ollama
        if target == "ollama":
            try:
                async with httpx.AsyncClient(timeout=3.0) as client:
                    resp = await client.get(f"{self.ollama_host}/api/tags")
                    if resp.status_code == 200:
                        for m in resp.json().get("models", []):
                            name = m["name"]
                            models.append({"id": name, "label": name})
            except Exception as e:
                logger.error(f"Error fetching Ollama models: {e}")

        return sorted(models, key=lambda x: x["label"])
