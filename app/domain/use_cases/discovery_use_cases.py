import logging
import asyncio
import httpx
import feedparser
import json
import os
import hashlib
import socket
from datetime import datetime
from ..repositories import IWikiRepository
from ...infrastructure.ai_provider import AIProvider
from bs4 import BeautifulSoup
from markdownify import markdownify as md

logger = logging.getLogger(__name__)

def _has_network() -> bool:
    try:
        socket.setdefaulttimeout(3)
        socket.getaddrinfo("dns.google", 443)
        return True
    except OSError:
        return False

async def _fetch_full_content(url: str) -> str:
    """Standard web scraper to Markdown"""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
        async with httpx.AsyncClient(headers=headers, timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            
            soup = BeautifulSoup(resp.text, 'lxml')
            for tag in soup(["nav", "footer", "script", "style", "aside", ".ads", ".cookie-banner"]):
                tag.decompose()
            
            main = soup.find("article") or soup.find("main") or soup.find(class_=lambda x: x and ("content" in x or "entry" in x)) or soup.body
            if main:
                return md(str(main), heading_style="ATX").strip()
            return ""
    except Exception as e:
        logger.warning(f"Fetch failed for {url}: {e}")
        return ""

class GetDiscoveryUseCase:
    def __init__(self, source_provider):
        self.source_provider = source_provider
        self._cached_items = []
        self._last_fetch = 0

    async def execute(self):
        now = datetime.now().timestamp()
        if not self._cached_items or (now - self._last_fetch > 3600):
            asyncio.create_task(self._fetch_trending_topics())
        
        return {
            "items": self._cached_items,
            "last_updated": datetime.fromtimestamp(self._last_fetch).strftime("%Y-%m-%d %H:%M:%S") if self._last_fetch > 0 else "Chưa có dữ liệu"
        }

    async def _fetch_trending_topics(self):
        logger.info("🌐 Fetching trending topics...")
        new_items = []
        feeds = self.source_provider.get_active_feeds()[:10]
        
        try:
            for feed_url in feeds:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(feed_url)
                    d = feedparser.parse(resp.text)
                    for entry in d.entries[:2]:
                        new_items.append({
                            "title": entry.title,
                            "site": d.feed.get('title', 'RSS Source'),
                            "url": entry.link,
                            "tag": "Trending"
                        })
            
            if new_items:
                self._cached_items = new_items
                self._last_fetch = datetime.now().timestamp()
        except Exception as e:
            logger.error(f"❌ Discovery error: {e}")

class RunHourlyResearchUseCase:
    def __init__(self, wiki_repo: IWikiRepository, ai_provider: AIProvider, source_provider):
        self.wiki_repo = wiki_repo
        self.ai_provider = ai_provider
        self.source_provider = source_provider
        self.paused = False
        self.status = {"running": False}

    async def run_once(self):
        if self.paused: return
        if not _has_network(): return
        
        self.status["running"] = True
        logger.info("🔬 AI Researcher: Starting Hourly Research Pulse...")
        
        try:
            discovery = GetDiscoveryUseCase(self.source_provider)
            data = await discovery.execute()
            items = data.get("items", [])
            
            if not items:
                self.status["running"] = False
                return

            import random
            target = random.choice(items[:5])
            content = await _fetch_full_content(target['url'])
            if not content or len(content) < 500:
                self.status["running"] = False
                return

            prompt = f"""Bạn là chuyên gia Phân tích Tri thức. Hãy thực hiện NGHIÊN CỨU CHUYÊN SÂU về chủ đề sau.
Chủ đề: {target['title']}
Nguồn: {target['site']}
Nội dung thô: {content[:10000]}

Yêu cầu:
1. Viết báo cáo Markdown chuyên nghiệp (Title, Abstract, Context, Technical Insights, Impact, Related Concepts).
2. TRẢ VỀ KẾT QUẢ TRONG JSON.
JSON Schema:
{{
  "title": "Tiêu đề nghiên cứu",
  "report_md": "nội dung markdown...",
  "tags": ["..."],
  "entities": ["..."]
}}"""

            result = await self.ai_provider.generate_structured_json(prompt, use_heavy_model=True)
            
            final_md = f"""---
title: "{result.get('title')}"
type: research
source: "{target['site']}"
url: "{target['url']}"
tags: {json.dumps(result.get('tags', []))}
processed_at: "{datetime.now().isoformat()}"
---

{result.get('report_md')}

---
*Nghiên cứu được thực hiện tự động bởi Hourly Research Engine.*
"""
            now_date = datetime.now().strftime('%Y-%m-%d')
            filename = f"RESEARCH_{hashlib.md5(target['title'].encode()).hexdigest()[:8]}.md"
            await self.wiki_repo.save(filename, final_md, category=f"10-Knowledge/Research/{now_date}")
            
        except Exception as e:
            logger.error(f"❌ AI Researcher error: {e}")
        
        self.status["running"] = False

    async def execute(self):
        await asyncio.sleep(600) 
        while True:
            await self.run_once()
            await asyncio.sleep(3600)
