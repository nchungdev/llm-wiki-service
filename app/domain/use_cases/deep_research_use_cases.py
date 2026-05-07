import logging
import asyncio
import json
import os
import uuid
from datetime import datetime
from typing import List, Dict, Optional, Callable
from ...infrastructure.ai_provider import AIProvider
from ...infrastructure.search_provider import WebSearchProvider
from ...infrastructure.parsers.web_scraper import UrlScraper

logger = logging.getLogger(__name__)

class DeepResearchUseCase:
    def __init__(self, ai_provider: AIProvider, search_provider: WebSearchProvider, url_scraper: UrlScraper, system_dir: str = None):
        self.ai_provider = ai_provider
        self.search_provider = search_provider
        self.url_scraper = url_scraper
        self.system_dir = system_dir

    async def generate_plan(self, user_prompt: str) -> Dict:
        """Step 1: Just generate the plan and queries for user review."""
        queries = await self._plan_queries(user_prompt)
        return {
            "query": user_prompt,
            "search_queries": queries,
            "steps": [
                {"id": 1, "text": f"Tìm kiếm thông tin về: {q}", "type": "search"} for q in queries
            ] + [
                {"id": 99, "text": "Tổng hợp và viết báo cáo chuyên sâu", "type": "synthesize"}
            ]
        }

    async def execute(self, user_prompt: str, plan: Optional[Dict] = None, on_progress: Optional[Callable[[str], None]] = None):
        """
        Execute the Deep Research Agentic Workflow.
        If plan is provided, use its search_queries.
        """
        try:
            # --- STEP 1: QUERY PLANNER (or use provided plan) ---
            if plan and "search_queries" in plan:
                queries = plan["search_queries"]
                if on_progress: on_progress(f"🚀 Bắt đầu nghiên cứu dựa trên kế hoạch ({len(queries)} câu truy vấn)...")
            else:
                if on_progress: on_progress("🔍 Đang phân tích yêu cầu và lên kế hoạch tìm kiếm...")
                queries = await self._plan_queries(user_prompt)
            
            logger.info(f"Planned queries: {queries}")

            # --- STEP 2: SEARCH EXECUTION ---
            if on_progress: on_progress(f"🌐 Đang tìm kiếm trên Web cho {len(queries)} chủ đề...")
            search_results = await self.search_provider.search_multiple(queries, max_results_per_query=2)
            urls = [r["url"] for r in search_results]
            
            if not urls:
                return {"response": "Không tìm thấy kết quả tìm kiếm nào trên Web.", "sources": []}

            # --- STEP 3: DEEP CRAWLER ---
            if on_progress: on_progress(f"📄 Đang đọc và trích xuất nội dung từ {len(urls)} trang web...")
            crawled_data = await self.url_scraper.scrape_multiple(urls, max_concurrent=4)
            
            if not crawled_data:
                # Fallback to snippets if scraping failed
                crawled_data = [{"url": r["url"], "title": r["title"], "content": r["content"]} for r in search_results]

            # --- STEP 4: SYNTHESIZER ---
            if on_progress: on_progress("✍️ Đang tổng hợp dữ liệu và viết báo cáo chuyên sâu...")
            
            sources = []
            context_parts = []
            for i, data in enumerate(crawled_data):
                idx = i + 1
                sources.append({
                    "id": idx,
                    "url": data["url"],
                    "title": data["title"],
                    "content": data["content"][:2000] # Snippet for UI
                })
                context_parts.append(f"TÀI LIỆU [{idx}] (Nguồn: {data['url']}):\n{data['content'][:10000]}") # Limit per doc

            context = "\n\n---\n\n".join(context_parts)
            
            final_prompt = f"""
            Yêu cầu nghiên cứu: {user_prompt}
            
            Dưới đây là các tài liệu thu thập được từ Internet. 
            Nhiệm vụ của bạn là viết một bài báo cáo nghiên cứu chi tiết, khách quan và đầy đủ dựa trên các tài liệu này.
            
            QUY TẮC:
            1. Bạn PHẢI trích dẫn nguồn bằng số [1], [2]... trực tiếp sau mỗi thông tin lấy từ tài liệu tương ứng.
            2. Chỉ sử dụng thông tin từ tài liệu được cung cấp. Không bịa đặt.
            3. Trình bày bằng Tiếng Việt, sử dụng Markdown (Heading, Bullet points).
            4. Nếu có mâu thuẫn giữa các nguồn, hãy nêu rõ.
            
            TÀI LIỆU THU THẬP:
            {context}
            """
            
            response_text = await self.ai_provider.generate_content(final_prompt)
            
            result = {
                "response": response_text,
                "sources": sources,
                "mode": "deep_research"
            }

            # Save to history
            if self.system_dir:
                await self._save_history(user_prompt, response_text, sources, "deep")

            return result

        except Exception as e:
            logger.error(f"Deep Research failed: {e}")
            raise e

    async def _save_history(self, query: str, response: str, sources: List[dict], mode: str):
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
            
            history.insert(0, item) # Newest first
            history = history[:50] # Keep last 50
            
            with open(history_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=4, ensure_ascii=False)
            logger.info("Saved research task to history.")
        except Exception as e:
            logger.error(f"Failed to save research history: {e}")

    async def _plan_queries(self, user_prompt: str) -> List[str]:
        """Ask LLM to generate search queries."""
        prompt = f"""
        Bạn là một chuyên gia nghiên cứu. Nhiệm vụ của bạn là bẻ nhỏ yêu cầu của người dùng thành một danh sách các câu lệnh tìm kiếm Google tối ưu nhất để thu thập đầy đủ dữ liệu từ nhiều góc độ.
        
        Yêu cầu người dùng: "{user_prompt}"
        
        Trả về kết quả dưới dạng JSON STRICT với schema sau:
        {{
            "search_queries": ["query 1", "query 2", "query 3"]
        }}
        
        Lưu ý: Tạo ra từ 3 đến 5 câu lệnh tìm kiếm súc tích, bằng tiếng Anh (để có kết quả rộng hơn) hoặc tiếng Việt tùy ngữ cảnh.
        """
        
        try:
            res_json = await self.ai_provider.generate_structured_json(prompt)
            queries = res_json.get("search_queries", [user_prompt])
            return queries
        except:
            return [user_prompt]
