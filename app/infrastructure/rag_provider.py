import os
import chromadb
from chromadb.api.types import Documents, Embeddings, EmbeddingFunction
from google import genai
import logging

logger = logging.getLogger(__name__)


# Provider-specific default embedding models (used when discovery fails or returns empty)
_EMBED_DEFAULTS = {
    "gemini":   "models/text-embedding-004",
    "vertexai": "text-embedding-004",
}

class GeminiEmbeddingFunction(EmbeddingFunction):
    def __init__(self, api_key: str = None, provider_type: str = None, model_name: str = None,
                 gcp_project: str = None, gcp_location: str = None, gcp_key_file: str = None):

        self.provider_type = provider_type or os.getenv("AI_PROVIDER", "ollama")
        self.ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
        self.api_key = api_key
        self.gcp_project = gcp_project
        self.gcp_location = gcp_location
        self.gcp_key_file = gcp_key_file
        self.model_name = model_name

        # Per-provider model cache so discovery runs only once per session
        self._resolved_model: dict[str, str] = {}

        self.clients = {}
        self.is_fallback = False
        self._init_clients()

    def _init_clients(self):
        # 1. Gemini
        if self.api_key:
            try:
                self.clients["gemini"] = genai.Client(api_key=self.api_key)
            except: pass

        # 2. Vertex AI
        key_path = self.gcp_key_file or os.getenv("GCP_KEY_FILE")
        if key_path and os.path.exists(key_path):
            try:
                from google.oauth2 import service_account
                creds = service_account.Credentials.from_service_account_file(
                    key_path, scopes=["https://www.googleapis.com/auth/cloud-platform"]
                )
                proj = self.gcp_project or getattr(creds, 'project_id', None)
                if proj:
                    self.clients["vertexai"] = genai.Client(
                        vertexai=True, project=proj, 
                        location=self.gcp_location or "us-central1", 
                        credentials=creds
                    )
            except: pass

        # Validation
        if self.provider_type == "gemini" and "gemini" not in self.clients:
            self.is_fallback = True
        elif self.provider_type == "vertexai" and "vertexai" not in self.clients:
            self.is_fallback = True

    async def embed_async(self, input: Documents) -> Embeddings:
        active_provider = self.provider_type
        if self.is_fallback: active_provider = "ollama"

        try:
            return await self._call_embed(active_provider, input)
        except Exception as e:
            logger.warning(f"Primary embedding {active_provider} failed: {e}. Trying fallback...")
            for f in ["gemini", "vertexai", "ollama"]:
                if f == active_provider: continue
                if f in ("gemini", "vertexai") and f not in self.clients: continue
                try:
                    return await self._call_embed(f, input)
                except: continue
            
            # Last resort: zero embeddings to avoid crash
            logger.error("All embedding attempts failed. Returning zero vectors.")
            return [[0.0] * 768 for _ in range(len(input))]

    async def _resolve_embed_model(self, provider: str, client) -> str:
        """Return cached embed model, or discover once then cache it."""
        # Already resolved this session
        if provider in self._resolved_model:
            return self._resolved_model[provider]

        # Explicit model set by user config (skip if it's an Ollama-only model)
        if self.model_name and "nomic" not in self.model_name and "llama" not in self.model_name:
            self._resolved_model[provider] = self.model_name
            logger.info(f"📌 Using configured embed model for {provider}: {self.model_name}")
            return self.model_name

        logger.info(f"🔍 Discovering embed model for {provider}…")
        try:
            # Run sync list() in thread pool to avoid blocking the event loop
            import asyncio
            models_list = await asyncio.to_thread(lambda: list(client.models.list()))
            discovered = [
                m.name for m in models_list
                if hasattr(m, 'supported_generation_methods')
                and 'embedContent' in (m.supported_generation_methods or [])
            ]
            if discovered:
                # Prefer models with "embedding" in name
                model = next((m for m in discovered if "embedding" in m.lower()), discovered[0])
                logger.info(f"✅ Discovered embed model for {provider}: {model}")
                self._resolved_model[provider] = model
                return model
        except Exception as e:
            logger.warning(f"⚠️ Model discovery failed for {provider}: {e}")

        # Fall back to known-good defaults
        default = _EMBED_DEFAULTS.get(provider)
        if default:
            logger.info(f"⚡ Using default embed model for {provider}: {default}")
            self._resolved_model[provider] = default
            return default

        raise ValueError(f"Cannot determine embedding model for provider '{provider}'. "
                         f"Set embed_model in config or ensure the provider API is reachable.")

    async def _call_embed(self, provider: str, input: Documents):
        if provider in ("gemini", "vertexai"):
            client = self.clients.get(provider)
            if not client: raise ValueError(f"Client not ready for provider '{provider}'")

            model = await self._resolve_embed_model(provider, client)
            logger.debug(f"📊 Embedding via {provider} (model: {model}), {len(input)} docs")

            try:
                result = await client.aio.models.embed_content(
                    model=model,
                    contents=input,
                    config={'task_type': 'RETRIEVAL_DOCUMENT'}
                )
                return [e.values for e in result.embeddings]
            except Exception as e:
                # On 404 the cached model may be stale — clear cache and retry once
                if "404" in str(e):
                    logger.warning(f"⚠️ Embed model {model} returned 404. Clearing cache and retrying…")
                    self._resolved_model.pop(provider, None)
                    if self.model_name == model:
                        self.model_name = ''          # allow re-discovery
                    try:
                        model2 = await self._resolve_embed_model(provider, client)
                        if model2 != model:
                            result = await client.aio.models.embed_content(
                                model=model2,
                                contents=input,
                                config={'task_type': 'RETRIEVAL_DOCUMENT'}
                            )
                            return [e.values for e in result.embeddings]
                    except Exception as e2:
                        raise e2
                raise e
        else:
            # Ollama
            import httpx
            model = self.model_name
            # If model_name is a Google/Gemini model (not applicable to Ollama), discover via API
            if not model or "text-embedding" in model or "gemini" in model:
                try:
                    async with httpx.AsyncClient(timeout=5.0) as probe:
                        tags = (await probe.get(f"{self.ollama_host}/api/tags")).json()
                    all_models = [m["name"] for m in tags.get("models", [])]
                    # Prefer an explicit embed model; fall back to first available
                    embed_candidates = [m for m in all_models if "embed" in m.lower() or "nomic" in m.lower()]
                    model = embed_candidates[0] if embed_candidates else (all_models[0] if all_models else None)
                    if not model:
                        raise ValueError("No Ollama models found for embedding. Please pull an embed model (e.g. `ollama pull nomic-embed-text`).")
                    logger.info(f"✅ Auto-selected Ollama embed model: {model}")
                except ValueError:
                    raise
                except Exception as e:
                    raise ValueError(f"Could not discover Ollama embedding model: {e}")
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                embeddings = []
                for text in input:
                    resp = await client.post(
                        f"{self.ollama_host}/api/embeddings",
                        json={"model": model, "prompt": text}
                    )
                    resp.raise_for_status()
                    embeddings.append(resp.json().get("embedding", []))
                return embeddings

    def __call__(self, input: Documents) -> Embeddings:
        import asyncio
        try:
            try:
                asyncio.get_running_loop()
                return [[0.0] * 768 for _ in range(len(input))]
            except RuntimeError:
                return asyncio.run(self.embed_async(input))
        except:
            return [[0.0] * 768 for _ in range(len(input))]

class RAGService:
    def __init__(self, db_path, api_key: str = None, provider_type: str = None, model_name: str = None,
                 gcp_project: str = None, gcp_location: str = None, gcp_key_file: str = None):
        self.api_key = api_key
        self.db_path = db_path
        self.client = chromadb.PersistentClient(path=db_path)
        self.embedding_fn = GeminiEmbeddingFunction(
            api_key, provider_type, model_name, 
            gcp_project, gcp_location, gcp_key_file
        )
        
        try:
            self.collection = self.client.get_or_create_collection(
                name="wiki_rag",
                embedding_function=self.embedding_fn
            )
        except Exception as e:
            if "dimension" in str(e).lower():
                self.client.delete_collection("wiki_rag")
                self.collection = self.client.create_collection(
                    name="wiki_rag",
                    embedding_function=self.embedding_fn
                )
            else:
                raise e
        logger.info(f"RAG Service initialized at {db_path}")

    async def add_document(self, doc_id, text, metadata=None):
        try:
            embeddings = await self.embedding_fn.embed_async([text])
            def _upsert():
                self.collection.upsert(ids=[doc_id], documents=[text], embeddings=embeddings, metadatas=[metadata] if metadata else None)
            import asyncio
            await asyncio.to_thread(_upsert)
            logger.info(f"Indexed document: {doc_id}")
        except Exception as e:
            logger.error(f"Failed to index document {doc_id}: {e}")

    async def query(self, query_text, n_results=5):
        try:
            query_embeddings = await self.embedding_fn.embed_async([query_text])
            def _query():
                return self.collection.query(query_embeddings=query_embeddings, n_results=n_results)
            import asyncio
            results = await asyncio.to_thread(_query)
            formatted = []
            if results['documents'] and len(results['documents']) > 0:
                docs = results['documents'][0]
                metas = results['metadatas'][0] if results['metadatas'] else [{} for _ in docs]
                ids = results['ids'][0]
                for i in range(len(docs)):
                    formatted.append({"id": ids[i], "text": docs[i], "metadata": metas[i]})
            return formatted
        except Exception as e:
            logger.error(f"Query error: {e}")
            return []

    def clear_all(self):
        try: self.client.delete_collection("wiki_rag")
        except: pass
        self.collection = self.client.create_collection(name="wiki_rag", embedding_function=self.embedding_fn)
        logger.info("RAG index cleared.")
