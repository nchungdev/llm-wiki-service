import httpx
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

class WebSearchProvider:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self.tavily_url = "https://api.tavily.com/search"

    async def search(self, query: str, max_results: int = 5) -> List[Dict]:
        """
        Search the web for a query and return a list of results.
        Result format: [{"title": "...", "url": "...", "content": "..."}]
        """
        if not self.api_key:
            logger.warning("⚠️ No Tavily API Key provided. Falling back to Mock/No-op search.")
            return []

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    self.tavily_url,
                    json={
                        "api_key": self.api_key,
                        "query": query,
                        "search_depth": "basic",
                        "max_results": max_results,
                        "include_answer": False,
                        "include_raw_content": False
                    }
                )
                resp.raise_for_status()
                data = resp.json()
                
                results = []
                for r in data.get("results", []):
                    results.append({
                        "title": r.get("title", "Untitled"),
                        "url": r.get("url"),
                        "content": r.get("content", "") # Snippet
                    })
                return results
        except Exception as e:
            logger.error(f"Search failed for '{query}': {e}")
            return []

    async def search_multiple(self, queries: List[str], max_results_per_query: int = 2) -> List[Dict]:
        """Execute multiple searches and deduplicate URLs."""
        all_results = []
        seen_urls = set()
        
        import asyncio
        tasks = [self.search(q, max_results_per_query) for q in queries]
        batch_results = await asyncio.gather(*tasks)
        
        for results in batch_results:
            for r in results:
                if r["url"] not in seen_urls:
                    all_results.append(r)
                    seen_urls.add(r["url"])
                    
        return all_results
