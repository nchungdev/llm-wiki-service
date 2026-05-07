import os
import chromadb
from chromadb.api.types import Documents, Embeddings, EmbeddingFunction
from google import genai
import logging

logger = logging.getLogger(__name__)

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

    async def _call_embed(self, provider: str, input: Documents):
        if provider in ("gemini", "vertexai"):
            client = self.clients.get(provider)
            if not client: raise ValueError("Client not ready")
            
            # 1. Clean model name
            model = self.model_name or "text-embedding-004"
            if "nomic" in model or "llama" in model:
                model = "text-embedding-004"
            
            logger.info(f"📊 Requesting embedding from {provider} (model: {model})...")

            try:
                result = await client.aio.models.embed_content(
                    model=model,
                    contents=input,
                    config={'task_type': 'RETRIEVAL_DOCUMENT'}
                )
                return [e.values for e in result.embeddings]
            except Exception as e:
                # If 404, attempt dynamic discovery
                if "404" in str(e):
                    logger.warning(f"⚠️ Embedding model {model} not found (404). Discovering available models...")
                    try:
                        available = []
                        async for m in client.aio.models.list():
                            if 'embedContent' in m.supported_generation_methods:
                                available.append(m.name)
                        
                        if available:
                            fallback = next((m for m in available if "embedding" in m.lower()), available[0])
                            logger.info(f"🔄 Dynamic fallback embedding: {fallback}")
                            result = await client.aio.models.embed_content(
                                model=fallback,
                                contents=input,
                                config={'task_type': 'RETRIEVAL_DOCUMENT'}
                            )
                            return [e.values for e in result.embeddings]
                        else: raise e
                    except: raise e
                raise e
        else:
            # Ollama
            import httpx
            model = self.model_name
            # If model_name is a Google model, override for Ollama
            if not model or "text-embedding" in model or "gemini" in model:
                model = "nomic-embed-text"
            
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
