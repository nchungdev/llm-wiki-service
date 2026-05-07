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
        self.gcp_project = gcp_project
        self.gcp_location = gcp_location
        self.gcp_key_file = gcp_key_file

        # Per-provider model registry — each provider keeps its own model name
        # Keys: "gemini", "vertexai", "ollama", "ollama_heavy"
        self._models: dict[str, str] = {}
        if model_name:
            self._models[self.provider_type] = model_name

        self.limiter = AsyncRateLimiter(max_rpm, max_tpm)
        self.clients: dict = {}
        self.is_fallback = False
        self._init_clients()

        if not self._models.get(self.provider_type):
            logger.info(f"ℹ️ No model configured for '{self.provider_type}'. Will discover on first call.")

    # ── Backward-compat property used by update_config / external callers ──────
    @property
    def model_name(self) -> Optional[str]:
        return self._models.get(self.provider_type)

    @model_name.setter
    def model_name(self, value: Optional[str]):
        if value:
            self._models[self.provider_type] = value
        else:
            self._models.pop(self.provider_type, None)

    @property
    def heavy_model(self) -> Optional[str]:
        return self._models.get("ollama_heavy")

    @heavy_model.setter
    def heavy_model(self, value: Optional[str]):
        if value:
            self._models["ollama_heavy"] = value
        else:
            self._models.pop("ollama_heavy", None)

    def _get_model(self, provider: str) -> Optional[str]:
        return self._models.get(provider)

    def _set_model(self, provider: str, model: str):
        self._models[provider] = model
        logger.info(f"📌 Model set for {provider}: {model}")

    def _init_clients(self):
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
                    key_path, scopes=["https://www.googleapis.com/auth/cloud-platform"]
                )
                proj = self.gcp_project or getattr(creds, 'project_id', None) or os.getenv("GCP_PROJECT_ID")
                loc = self.gcp_location or os.getenv("GCP_LOCATION", "us-central1")
                if proj:
                    self.clients["vertexai"] = genai.Client(
                        vertexai=True, project=proj, location=loc, credentials=creds
                    )
                    logger.debug(f"✅ Vertex AI client initialized (project={proj})")
            except Exception as e:
                logger.error(f"Failed to init Vertex AI client: {e}")

        if self.provider_type == "gemini" and "gemini" not in self.clients:
            logger.warning("⚠️ Gemini selected but no API key. Fallback enabled.")
            self.is_fallback = True
        elif self.provider_type == "vertexai" and "vertexai" not in self.clients:
            logger.warning("⚠️ VertexAI selected but not configured. Fallback enabled.")
            self.is_fallback = True

    # ── Public generation methods ───────────────────────────────────────────────

    async def generate_content(self, prompt: str):
        active = self.provider_type if not self.is_fallback else "ollama"
        try:
            return await self._call_provider(active, prompt)
        except Exception as e:
            logger.warning(f"Primary provider {active} failed: {type(e).__name__}: {e}. Trying fallbacks...")
            for fb in ["gemini", "vertexai", "ollama"]:
                if fb == active: continue
                if fb in ("gemini", "vertexai") and fb not in self.clients: continue
                try:
                    res = await self._call_provider(fb, prompt)
                    logger.info(f"✅ Fallback successful using {fb}")
                    return res
                except Exception as fe:
                    logger.warning(f"  Fallback {fb} also failed: {type(fe).__name__}: {fe}")
            raise e

    async def generate_structured_json(self, prompt: str, use_heavy_model: bool = False):
        active = self.provider_type if not self.is_fallback else "ollama"
        try:
            return await self._call_provider_structured(active, prompt, use_heavy_model)
        except Exception as e:
            logger.warning(f"Primary provider {active} failed (Structured): {type(e).__name__}: {e}. Trying fallbacks...")
            for fb in ["gemini", "vertexai", "ollama"]:
                if fb == active: continue
                if fb in ("gemini", "vertexai") and fb not in self.clients: continue
                try:
                    return await self._call_provider_structured(fb, prompt, use_heavy_model)
                except Exception as fe:
                    logger.warning(f"  Fallback {fb} (Structured) also failed: {type(fe).__name__}: {fe}")
            raise e

    # ── Internal call helpers ───────────────────────────────────────────────────

    async def _resolve_google_model(self, provider: str) -> str:
        """Resolve and cache the best available model for a Google provider (gemini/vertexai)."""
        cached = self._get_model(provider)
        if cached:
            return cached

        logger.info(f"🔍 Discovering models for {provider}...")
        available = await self.get_available_models(provider)
        if not available:
            raise ValueError(f"No models available on {provider}")
        best = next(
            (m["id"] for m in available if "flash" in m["id"].lower() and "preview" not in m["id"].lower()),
            available[0]["id"]
        )
        self._set_model(provider, best)
        return best

    async def _call_provider(self, provider: str, prompt: str):
        if provider in ("gemini", "vertexai"):
            client = self.clients.get(provider)
            if not client:
                raise ValueError(f"Provider {provider} not ready")
            await self.limiter.wait_for_slot(len(prompt) // 2)

            model = await self._resolve_google_model(provider)
            logger.info(f"🚀 Calling {provider} with model: {model}")

            try:
                response = await client.aio.models.generate_content(model=model, contents=prompt)
            except Exception as e:
                if "404" in str(e) or "NOT_FOUND" in str(e):
                    logger.warning(f"⚠️ Model {model} not found on {provider}. Re-discovering...")
                    self._models.pop(provider, None)  # clear cache
                    available = await self.get_available_models(provider)
                    if available:
                        new_model = next(
                            (m["id"] for m in available if "flash" in m["id"].lower()
                             and "preview" not in m["id"].lower() and m["id"] != model),
                            available[0]["id"]
                        )
                        self._set_model(provider, new_model)
                        response = await client.aio.models.generate_content(model=new_model, contents=prompt)
                    else:
                        raise e
                else:
                    raise e

            usage = getattr(response, 'usage_metadata', None)
            await self.limiter.record_usage(usage.total_token_count if usage else len(response.text) // 2)
            return response.text

        else:
            # Ollama — always resolve against live model list
            model = await self._resolve_ollama_model("ollama")
            async with httpx.AsyncClient(timeout=300.0) as client:
                resp = await client.post(
                    f"{self.ollama_host}/api/generate",
                    json={"model": model, "prompt": prompt, "stream": False,
                          "options": {"num_ctx": 16384}}
                )
                resp.raise_for_status()
                return resp.json().get("response", "")

    async def _call_provider_structured(self, provider: str, prompt: str, use_heavy_model: bool):
        if provider in ("gemini", "vertexai"):
            client = self.clients.get(provider)
            if not client:
                raise ValueError(f"Provider {provider} not ready")
            await self.limiter.wait_for_slot(len(prompt) // 2)

            model = await self._resolve_google_model(provider)
            logger.info(f"🚀 Calling {provider} (Structured) with model: {model}")

            try:
                response = await client.aio.models.generate_content(
                    model=model, contents=prompt,
                    config={'response_mime_type': 'application/json'}
                )
            except Exception as e:
                if "404" in str(e) or "NOT_FOUND" in str(e):
                    logger.warning(f"⚠️ Model {model} not found on {provider}. Re-discovering...")
                    self._models.pop(provider, None)
                    available = await self.get_available_models(provider)
                    if available:
                        new_model = next(
                            (m["id"] for m in available if "flash" in m["id"].lower() and m["id"] != model),
                            available[0]["id"]
                        )
                        self._set_model(provider, new_model)
                        response = await client.aio.models.generate_content(
                            model=new_model, contents=prompt,
                            config={'response_mime_type': 'application/json'}
                        )
                    else:
                        raise e
                else:
                    raise e

            usage = getattr(response, 'usage_metadata', None)
            await self.limiter.record_usage(usage.total_token_count if usage else len(response.text) // 2)
            return json.loads(response.text)

        else:
            import re
            # Resolve light and heavy Ollama models
            light = await self._resolve_ollama_model("ollama")
            if use_heavy_model:
                heavy = await self._resolve_ollama_model("ollama_heavy")
                model = heavy
                keep_alive = "0"
            else:
                model = light
                keep_alive = "5m"

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
                raw = resp.json().get("response", "{}").strip()
                try:
                    return json.loads(raw)
                except json.JSONDecodeError:
                    match = re.search(r'(\{.*\})', raw, re.DOTALL)
                    if match:
                        clean = match.group(1)
                        clean = re.sub(r'"((?:\\.|[^"\\])*)"', lambda m: m.group(0).replace('\n', '\\n'), clean)
                        try:
                            return json.loads(clean)
                        except:
                            pass
                    raise

    async def _resolve_ollama_model(self, slot: str) -> str:
        """Return a valid Ollama model for the given slot ("ollama" or "ollama_heavy").
        Always validates against the live model list."""
        available = await self.get_available_models("ollama")
        if not available:
            raise ValueError("No Ollama models found. Please pull a model first (e.g. `ollama pull llama3.1`).")
        ids = {m["id"] for m in available}

        cached = self._models.get(slot)
        if cached and cached in ids:
            return cached

        if slot == "ollama_heavy":
            chosen = next(
                (m["id"] for m in available if "70b" in m["id"].lower() or "pro" in m["id"].lower()),
                available[0]["id"]
            )
        else:
            # Prefer text generation models, not embed-only
            chosen = next(
                (m["id"] for m in available if "embed" not in m["id"].lower()),
                available[0]["id"]
            )

        self._models[slot] = chosen
        logger.info(f"🔄 Ollama model selected for slot '{slot}': {chosen}")
        return chosen

    # ── Utility methods ─────────────────────────────────────────────────────────

    def for_request(self, provider_type: Optional[str] = None, model_name: Optional[str] = None) -> "AIProvider":
        """Shallow copy with overridden provider/model for a single request."""
        if (not provider_type or provider_type == self.provider_type) and not model_name:
            return self
        import copy
        clone = copy.copy(self)
        clone._models = dict(self._models)  # own copy so writes don't bleed back
        if provider_type:
            clone.provider_type = provider_type
            clone.is_fallback = provider_type in ("gemini", "vertexai") and provider_type not in self.clients
        if model_name and provider_type:
            clone._models[provider_type] = model_name
        return clone

    def update_config(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        if api_key:
            self.api_key = api_key
        if model_name:
            self._models[self.provider_type] = model_name
        self._init_clients()
        logger.info(f"🔄 AIProvider updated: provider={self.provider_type}, model={self._models.get(self.provider_type)}")

    async def check_availability(self):
        status = {
            "ollama": {"available": False, "message": "Not found"},
            "gemini": {"available": False, "message": "Missing API Key"},
            "vertexai": {"available": False, "message": "Missing GCP Key"}
        }
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"{self.ollama_host}/api/tags")
                if resp.status_code == 200:
                    status["ollama"] = {"available": True, "message": "Ready"}
        except:
            pass
        if "gemini" in self.clients:
            status["gemini"] = {"available": True, "message": "Ready"}
        if "vertexai" in self.clients:
            status["vertexai"] = {"available": True, "message": "Ready"}
        return status

    async def get_available_models(self, provider_type: Optional[str] = None):
        """Fetch available models from the specified provider."""
        models = []
        target = provider_type or self.provider_type

        if target == "gemini" and "gemini" in self.clients:
            try:
                for m in self.clients["gemini"].models.list():
                    name = m.name  # "models/gemini-2.0-flash"
                    label = name.replace("models/", "")
                    supported = getattr(m, 'supported_actions', None) or getattr(m, 'supported_generation_methods', [])
                    if supported and 'generateContent' not in supported:
                        continue
                    if "gemini" in name and not any(x in name for x in ("embedding", "tts", "image", "audio")):
                        models.append({"id": label, "label": label})
            except Exception as e:
                logger.error(f"Error fetching Gemini models: {e}")

        if target == "vertexai" and "vertexai" in self.clients:
            try:
                for m in self.clients["vertexai"].models.list():
                    name = m.name  # "publishers/google/models/gemini-1.5-flash"
                    if "gemini" in name and not any(x in name for x in ("embedding", "tts", "image", "audio", "computer")):
                        label = name.split("/")[-1]
                        models.append({"id": name, "label": label})
            except Exception as e:
                logger.error(f"Error fetching Vertex models: {e}")

        if target == "ollama":
            try:
                async with httpx.AsyncClient(timeout=3.0) as client:
                    resp = await client.get(f"{self.ollama_host}/api/tags")
                    if resp.status_code == 200:
                        for m in resp.json().get("models", []):
                            models.append({"id": m["name"], "label": m["name"]})
            except Exception as e:
                logger.error(f"Error fetching Ollama models: {e}")

        return sorted(models, key=lambda x: x["label"])
