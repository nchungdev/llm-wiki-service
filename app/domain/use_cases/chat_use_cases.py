import os
import json
import uuid
from datetime import datetime
import logging
from ..repositories import IChatRepository
from ...infrastructure.rag_provider import RAGService

logger = logging.getLogger(__name__)

class ChatWithAIUseCase:
    def __init__(self, chat_repo: IChatRepository, rag_service: RAGService, system_dir: str = None):
        self.chat_repo = chat_repo
        self.rag_service = rag_service
        self.system_dir = system_dir
    
    async def _save_history(self, query: str, response: str, sources: list, mode: str):
        if not self.system_dir: return
        history_file = os.path.join(self.system_dir, "research_history.json")
        item = {
            "id": str(uuid.uuid4()),
            "query": query,
            "response": response,
            "sources": sources,
            "timestamp": datetime.now().isoformat(),
            "mode": mode
        }
        try:
            history = []
            if os.path.exists(history_file):
                with open(history_file, 'r', encoding='utf-8') as f:
                    history = json.load(f)
            history.insert(0, item)
            history = history[:50]
            with open(history_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=4, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to save local research history: {e}")

    async def execute(self, message: str):
        context = ""
        sources = []
        if self.rag_service:
            # Lấy nhiều hơn để bù cho những kết quả bị lọc
            results = await self.rag_service.query(message, n_results=6)
            # Loại bỏ tài liệu temporary khỏi context RAG
            results = [
                r for r in results
                if r.get('metadata', {}).get('category') != 'temporary'
            ][:4]
            
            if results:
                context_parts = []
                for i, r in enumerate(results):
                    idx = i + 1
                    sources.append({
                        "id": idx,
                        "filename": r.get('metadata', {}).get('filename', 'Unknown'),
                        "title": r.get('metadata', {}).get('title', 'Unknown'),
                        "content": r['text']
                    })
                    context_parts.append(f"TÀI LIỆU [{idx}]:\n{r['text']}")
                
                context = "\n\n---\n\n".join(context_parts)
                # Thêm hướng dẫn trích dẫn vào prompt
                message = f"{message}\n\nQUAN TRỌNG: Bạn PHẢI trích dẫn nguồn bằng cách dùng số [1], [2]... trực tiếp trong câu trả lời tương ứng với danh sách TÀI LIỆU ở trên. Chỉ dùng thông tin từ tài liệu được cung cấp."

        response = await self.chat_repo.generate_response(message, context)
        
        await self._save_history(message, response, sources, "local")
        
        return {"response": response, "sources": sources}

class GetAvailableModelsUseCase:
    def __init__(self, chat_repo: IChatRepository):
        self.chat_repo = chat_repo
    
    async def execute(self, provider: str = None):
        return await self.chat_repo.get_available_models(provider=provider)
