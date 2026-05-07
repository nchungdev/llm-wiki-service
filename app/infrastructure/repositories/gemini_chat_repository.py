from typing import List
from ...domain.repositories import IChatRepository
from ..ai_provider import AIProvider
from ..rag_provider import RAGService

class GeminiChatRepository(IChatRepository):
    def __init__(self, ai_provider: AIProvider, rag_service: RAGService):
        self.ai_provider = ai_provider
        self.rag_service = rag_service

    async def generate_response(self, prompt: str, context: str) -> str:
        full_prompt = f"Context:\n{context}\n\nUser: {prompt}"
        return await self.ai_provider.generate_content(full_prompt)

    async def get_available_models(self, provider: str = None) -> List[dict]:
        return await self.ai_provider.get_available_models(provider_type=provider)
