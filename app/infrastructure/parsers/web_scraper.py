import httpx
import logging
from bs4 import BeautifulSoup
from markdownify import markdownify as md
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

class UrlScraper:
    def __init__(self, timeout: float = 10.0):
        self.timeout = timeout
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

    async def scrape(self, url: str) -> Optional[Dict]:
        """
        Scrape a single URL and return content as Markdown.
        Result: {"url": "...", "title": "...", "content": "..."}
        """
        try:
            async with httpx.AsyncClient(headers=self.headers, follow_redirects=True, timeout=self.timeout) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    logger.warning(f"Failed to scrape {url}: {resp.status_code}")
                    return None
                
                soup = BeautifulSoup(resp.text, 'html.parser')
                
                # Extract title
                title = soup.title.string if soup.title else "Untitled"
                
                # Cleanup
                for tag in soup(['nav', 'footer', 'script', 'style', 'aside', '.ads', '.sidebar', 'header']):
                    try:
                        tag.decompose()
                    except:
                        pass
                
                # Find main content
                main_content = soup.find('main') or soup.find('article') or soup.find('body')
                if not main_content:
                    return None
                
                # Convert to Markdown
                content_md = md(str(main_content), heading_style="ATX").strip()
                
                # Basic length check to avoid empty/junk pages
                if len(content_md) < 200:
                    logger.debug(f"Content too short for {url}, skipping.")
                    return None

                return {
                    "url": url,
                    "title": title.strip() if title else "Untitled",
                    "content": content_md
                }
        except Exception as e:
            logger.error(f"Error scraping {url}: {e}")
            return None

    async def scrape_multiple(self, urls: List[str], max_concurrent: int = 3) -> List[Dict]:
        """Scrape multiple URLs with concurrency control."""
        import asyncio
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def sem_scrape(url):
            async with semaphore:
                return await self.scrape(url)
        
        tasks = [sem_scrape(url) for url in urls]
        results = await asyncio.gather(*tasks)
        
        # Filter out failed scrapes
        return [r for r in results if r is not None]
