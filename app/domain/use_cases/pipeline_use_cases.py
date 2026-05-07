import logging
import httpx
import json
import os
from bs4 import BeautifulSoup
from markdownify import markdownify as md
from datetime import datetime
from ..repositories import IWikiRepository
from ...infrastructure.ai_provider import AIProvider

logger = logging.getLogger(__name__)

class WebToWikiPipeline:
    def __init__(self, wiki_repo: IWikiRepository, ai_provider: AIProvider):
        self.wiki_repo = wiki_repo
        self.ai_provider = ai_provider

    async def run(self, urls: list[str]):
        results = []
        for url in urls:
            try:
                # --- TASK 1: DATA EXTRACTION (CRAWLER) ---
                logger.info(f"🌐 Step 1: Crawling data from {url}")
                raw_data = await self._step_1_crawl_data(url)
                
                # --- TASK 2: AI PROCESSING (TRANSFORMER) ---
                logger.info(f"🤖 Step 2: AI Processing for {url}")
                processed_data = await self._step_2_ai_process(raw_data)
                
                # --- TASK 3: DATA SINK (LOADER) ---
                logger.info(f"💾 Step 3: Saving wiki for {url}")
                saved_path = await self._step_3_save_wiki(processed_data, raw_data['metadata'])
                
                results.append({"url": url, "status": "success", "path": saved_path})
            except Exception as e:
                logger.error(f"❌ Pipeline failed for {url}: {e}")
                results.append({"url": url, "status": "failed", "error": str(e)})
        
        return results

    async def _step_1_crawl_data(self, url: str):
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            if response.status_code != 200:
                raise Exception(f"Failed to fetch URL: {response.status_code}")
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Remove clutter
            for tag in soup(['nav', 'footer', 'script', 'style', 'aside', '.ads', '.sidebar']):
                tag.decompose()
            
            # Target content (simple heuristic if selectors not provided)
            main_content = soup.find('main') or soup.find('article') or soup.find('body')
            
            title = soup.title.string if soup.title else "Untitled"
            raw_markdown = md(str(main_content), heading_style="ATX")
            
            return {
                "raw_content": raw_markdown,
                "metadata": {
                    "title": title,
                    "source_url": url,
                    "source_domain": url.split('//')[-1].split('/')[0]
                }
            }

        async def _step_1_crawl_data_from_source(self, source: dict):
            """
            Crawl a source object that may include render_js and category.
            source: { url, category, render_js }
            """
            url = source.get('url')
            render_js = bool(source.get('render_js', False))

            if render_js:
                try:
                    from playwright.async_api import async_playwright
                    async with async_playwright() as p:
                        browser = await p.chromium.launch(headless=True)
                        page = await browser.new_page()
                        await page.goto(url, timeout=30000)
                        content = await page.content()
                        await browser.close()
                        soup = BeautifulSoup(content, 'html.parser')
                except Exception as e:
                    logger.warning(f"Playwright render failed for {url}: {e} — falling back to httpx")
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        response = await client.get(url)
                        if response.status_code != 200:
                            raise Exception(f"Failed to fetch URL: {response.status_code}")
                        soup = BeautifulSoup(response.text, 'html.parser')
            else:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.get(url)
                    if response.status_code != 200:
                        raise Exception(f"Failed to fetch URL: {response.status_code}")
                    soup = BeautifulSoup(response.text, 'html.parser')

            # Remove clutter
            for tag in soup(['nav', 'footer', 'script', 'style', 'aside']):
                try:
                    tag.decompose()
                except Exception:
                    pass

            main_content = soup.find('main') or soup.find('article') or soup.find('body')
            title = (soup.title.string if soup.title else source.get('title')) or 'Untitled'
            raw_markdown = md(str(main_content), heading_style="ATX")

            return {
                'raw_content': raw_markdown,
                'metadata': {
                    'title': title,
                    'source_url': url,
                    'source_category': source.get('category')
                }
            }

        async def _step_2_ai_process_with_retries(self, crawl_output: dict, max_retries: int = 2):
            raw_content = crawl_output['raw_content']
            metadata = crawl_output['metadata']
            attempt = 0
            last_err = None
            while attempt <= max_retries:
                try:
                    prompt = f"""
    You are a Knowledge Management formatter. Receive raw content and return a STRICT JSON object only with this schema:
    {{
      "tags": ["tag1"],
      "summary": "...",
      "key_takeaways": ["..."],
      "wiki_body_markdown": "..."
    }}

    Title: {metadata.get('title')}
    Category: {metadata.get('source_category')}

    Content:
    {raw_content[:12000]}
    """
                    response_text = await self.ai_provider.generate_content(prompt)
                    if "```json" in response_text:
                        response_text = response_text.split("```json")[1].split("```")[0].strip()
                    elif "```" in response_text:
                        response_text = response_text.split("```")[1].split("```")[0].strip()
                    parsed = json.loads(response_text)
                    return parsed
                except Exception as e:
                    logger.warning(f"LLM JSON parse failed (attempt {attempt}): {e}")
                    last_err = e
                    attempt += 1
                    if attempt <= max_retries:
                        # Send a short instruction to the model before retrying (best-effort)
                        try:
                            await self.ai_provider.generate_content("Respond with valid JSON only. No explanations.")
                        except Exception:
                            pass
            raise last_err

        async def run_dynamic(self, sources: list[dict]):
            results = []
            for src in sources:
                url = src.get('url')
                try:
                    raw = await self._step_1_crawl_data_from_source(src)
                    processed = await self._step_2_ai_process_with_retries(raw)
                    saved = await self._step_3_save_wiki(processed, raw['metadata'])
                    results.append({'url': url, 'status': 'success', 'path': saved})
                except Exception as e:
                    logger.error(f"Dynamic pipeline failed for {url}: {e}")
                    results.append({'url': url, 'status': 'failed', 'error': str(e)})
            return results

    async def _step_2_ai_process(self, crawl_output: dict):
        raw_content = crawl_output['raw_content']
        metadata = crawl_output['metadata']
        
        prompt = f"""
        Bạn là một hệ thống Knowledge Management chuyên nghiệp. Nhiệm vụ của bạn là nhận dữ liệu thô, 
        lọc bỏ thông tin nhiễu và tái cấu trúc thành một bài Wiki chuẩn.
        
        Xử lý nội dung sau và trả về đúng định dạng JSON.
        Title: {metadata['title']}
        Content: {raw_content[:8000]} # Limit to avoid token overflow
        
        Yêu cầu JSON format:
        {{
          "tags": ["tag1", "tag2"],
          "summary": "Tóm tắt ngắn gọn",
          "key_takeaways": ["điểm 1", "điểm 2"],
          "wiki_body_markdown": "Nội dung đã được format với Heading, Bullet points bằng tiếng Việt"
        }}
        """
        
        response_json_str = await self.ai_provider.generate_content(prompt)
        # Clean up JSON if LLM added markdown blocks
        if "```json" in response_json_str:
            response_json_str = response_json_str.split("```json")[1].split("```")[0].strip()
        elif "```" in response_json_str:
            response_json_str = response_json_str.split("```")[1].split("```")[0].strip()
            
        return json.loads(response_json_str)

    async def _step_3_save_wiki(self, processed_data: dict, metadata: dict):
        date_str = datetime.now().strftime("%Y%m%d")
        title_slug = metadata['title'].replace(' ', '_').lower()
        # Ensure title_slug is clean
        title_slug = "".join([c for c in title_slug if c.isalnum() or c == '_'])[:50]
        
        # Action: format_final_markdown
        wiki_body = f"""---
title: {metadata['title']}
source: {metadata['source_url']}
date: {date_str}
tags: {', '.join(processed_data.get('tags', []))}
---

# {metadata['title']}

## Tóm tắt
{processed_data.get('summary', '')}

## Điểm chính
{chr(10).join(['- ' + t for t in processed_data.get('key_takeaways', [])])}

---

{processed_data.get('wiki_body_markdown', '')}

---
*Bản tin này được tạo tự động bởi WebToWiki Pipeline.*
"""
        # Action: write_to_storage
        filename = f"Wiki_{date_str}_{title_slug}.md"
        await self.wiki_repo.save_page(metadata['title'], wiki_body)
        return filename
