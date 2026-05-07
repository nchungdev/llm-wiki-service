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
            # Basic cleaning based on common selectors
            for tag in soup(["nav", "footer", "script", "style", "aside", ".ads", ".cookie-banner"]):
                tag.decompose()
            
            # Find main content
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
            await self._fetch_trending_topics()
        
        return {
            "items": self._cached_items,
            "last_updated": datetime.fromtimestamp(self._last_fetch).strftime("%Y-%m-%d %H:%M:%S")
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

class RunDailyCrawlUseCase:
    """TASK 1: DATA EXTRACTION (ROUTING CRAWLER)"""
    def __init__(self, raw_dir: str, source_provider, max_concurrent=3, on_finish=None, youtube_api_key=None):
        self.raw_dir = os.path.join(raw_dir, "crawl")
        os.makedirs(self.raw_dir, exist_ok=True)
        self.source_provider = source_provider
        self.max_concurrent = max_concurrent
        self.on_finish = on_finish
        self.yt_key = youtube_api_key
        self.paused = False  # emergency stop flag
        self.status = {
            "running": False,
            "total": 0,
            "processed": 0,
            "items_found": 0,
            "tasks": {}
        }

    async def process_single_source(self, source, semaphore):
        source_id = source.id
        self.status["tasks"][source_id] = {"name": source.name, "progress": 0, "status": "Waiting...", "active": False}
        
        async with semaphore:
            self.status["tasks"][source_id]["active"] = True
            self.status["tasks"][source_id]["status"] = f"🔍 Đang kết nối {source.type}..."
            try:
                raw_items = []
                
                # BRANCH 1: YOUTUBE API
                if source.type == 'youtube':
                    self.status["tasks"][source_id]["status"] = "📺 Đang đọc metadata YouTube..."
                    video_id = source.url # ID stored in url field or extracted from link
                    if 'v=' in video_id: video_id = video_id.split('v=')[1].split('&')[0]
                    elif 'youtu.be/' in video_id: video_id = video_id.split('youtu.be/')[1].split('?')[0]
                    
                    if self.yt_key:
                        api_url = f"https://www.googleapis.com/youtube/v3/videos?part=snippet&id={video_id}&key={self.yt_key}"
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            resp = await client.get(api_url)
                            data = resp.json()
                            if data.get('items'):
                                snip = data['items'][0]['snippet']
                                raw_items.append({
                                    "source_name": source.name,
                                    "source_category": source.category,
                                    "source_type": "youtube",
                                    "title": snip['title'],
                                    "link": f"https://youtube.com/watch?v={video_id}",
                                    "content": f"TITLE: {snip['title']}\n\nDESCRIPTION:\n{snip['description']}",
                                    "summary": snip['description'][:500]
                                })
                
                # BRANCH 2: WIKIPEDIA API
                elif source.type == 'wikipedia':
                    self.status["tasks"][source_id]["status"] = "📖 Đang tải Wikipedia..."
                    title = source.url.split('/wiki/')[-1] if '/wiki/' in source.url else source.url
                    api_url = f"https://vi.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles={title}&format=json"
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        resp = await client.get(api_url)
                        data = resp.json()
                        pages = data.get('query', {}).get('pages', {})
                        page_id = list(pages.keys())[0]
                        if page_id != "-1":
                            pg = pages[page_id]
                            raw_items.append({
                                "source_name": source.name,
                                "source_category": source.category,
                                "source_type": "wikipedia",
                                "title": pg['title'],
                                "link": source.url if source.url.startswith('http') else f"https://vi.wikipedia.org/wiki/{title}",
                                "content": pg['extract'],
                                "summary": pg['extract'][:500]
                            })

                # BRANCH 3: WEB / RSS
                else:
                    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
                    async with httpx.AsyncClient(headers=headers, timeout=15.0, follow_redirects=True) as client:
                        self.status["tasks"][source_id]["status"] = "🌐 Đang tải dữ liệu..."
                        resp = await client.get(source.url)
                        # Detect if RSS or Web
                        if source.type == 'rss' or 'xml' in resp.headers.get('Content-Type', ''):
                            d = feedparser.parse(resp.text)
                            entries = d.entries[:5]
                            for i, entry in enumerate(entries):
                                self.status["tasks"][source_id]["status"] = f"📑 ({i+1}/{len(entries)}) {entry.title[:30]}..."
                                self.status["tasks"][source_id]["progress"] = ((i+1)/len(entries)) * 90
                                raw_items.append({
                                    "source_name": source.name,
                                    "source_category": source.category,
                                    "source_type": "rss",
                                    "title": entry.title,
                                    "link": entry.link,
                                    "summary": entry.get('summary', '') or entry.get('description', ''),
                                    "content": await _fetch_full_content(entry.link)
                                })
                        else:
                            # Direct Web Page
                            self.status["tasks"][source_id]["status"] = f"📄 Đang đọc: {source.name[:20]}..."
                            content = await _fetch_full_content(source.url)
                            raw_items.append({
                                "source_name": source.name,
                                "source_category": source.category,
                                "source_type": "web",
                                "title": source.name,
                                "link": source.url,
                                "content": content,
                                "summary": content[:500]
                            })

                # Save raw items to disk
                for item in raw_items:
                    item_id = hashlib.md5(item['link'].encode()).hexdigest()
                    file_path = os.path.join(self.raw_dir, f"{item_id}.json")
                    if not os.path.exists(file_path):
                        item['fetched_at'] = datetime.now().isoformat()
                        with open(file_path, 'w', encoding='utf-8') as f:
                            json.dump(item, f, indent=4, ensure_ascii=False)
                        self.status["items_found"] += 1

                self.status["tasks"][source_id]["progress"] = 100
                self.status["tasks"][source_id]["status"] = "Success"
                self.status["processed"] += 1
            except Exception as e:
                logger.error(f"Extraction error {source.name}: {e}")
                self.status["tasks"][source_id]["status"] = "Failed"
                self.status["processed"] += 1

    async def run_once(self, source_id: str = None):
        if self.paused:
            logger.info("⏸️ Crawl loop paused (emergency stop active)")
            return
        if not _has_network():
            logger.warning("⚠️ No network — skipping crawl cycle")
            return
        if self.status["running"]: return
        start_time = datetime.now()
        self.status["running"] = True
        self.status["processed"] = 0
        self.status["items_found"] = 0
        self.status["tasks"] = {}
        
        all_active = [s for s in self.source_provider.get_all_sources() if s.active]
        if source_id:
            active_sources = [s for s in all_active if s.id == source_id]
        else:
            active_sources = all_active
            
        self.status["total"] = len(active_sources)
        
        if not active_sources:
            self.status["running"] = False
            return

        semaphore = asyncio.Semaphore(self.max_concurrent)
        tasks = [self.process_single_source(s, semaphore) for s in active_sources]
        await asyncio.gather(*tasks)
        
        self.status["running"] = False
        if self.on_finish:
            self.on_finish({
                "id": str(int(start_time.timestamp())),
                "start_time": start_time.strftime("%Y-%m-%d %H:%M:%S"),
                "end_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "status": "success",
                "sources_processed": self.status["processed"],
                "items_found": self.status["items_found"],
                "errors": []
            })
        logger.info(f"✅ Extraction Phase Complete. Found {self.status['items_found']} new raw items.")

    async def execute(self):
        while True:
            await self.run_once()
            await asyncio.sleep(86400)

class RunCookUseCase:
    """TASK 2: AI PROCESSING (TRANSFORMER)"""
    def __init__(self, raw_dir: str, wiki_repo: IWikiRepository, ai_provider: AIProvider, rag_service=None, neo4j_repo=None):
        self.raw_dir = os.path.join(raw_dir, "crawl")
        self.wiki_repo = wiki_repo
        self.ai_provider = ai_provider
        self.rag_service = rag_service
        self.neo4j_repo = neo4j_repo
        self.status = {"running": False, "processed": 0, "total": 0, "status": "Idle"}
        self.paused = False  # emergency stop flag

    async def list_raw_files(self):
        if not os.path.exists(self.raw_dir): return {"files": []}
        files = [f for f in os.listdir(self.raw_dir) if f.endswith(".json")]
        results = []
        for f in files:
            try:
                with open(os.path.join(self.raw_dir, f), 'r', encoding='utf-8') as jf:
                    data = json.load(jf)
                    results.append({
                        "filename": f,
                        "title": data.get("title", "Untitled"),
                        "source": data.get("source_name", "Unknown"),
                        "fetched_at": data.get("fetched_at", ""),
                        "url": data.get("link", "")
                    })
            except: pass
        return {"files": sorted(results, key=lambda x: x['fetched_at'], reverse=True)}

    async def cook_files(self, filenames: list[str]):
        if self.status["running"]: return {"status": "error", "message": "Chef is busy."}
        self.status["running"] = True
        self.status["total"] = len(filenames)
        self.status["processed"] = 0
        
        cooked_list = []
        for f in filenames:
            success = await self._process_file(os.path.join(self.raw_dir, f))
            if success:
                cooked_list.append(f)
                self.status["processed"] += 1
        
        self.status["running"] = False
        return {"status": "success", "processed": self.status["processed"], "files": cooked_list}

    async def _process_file(self, file_path: str):
        if not os.path.exists(file_path): return False
        import aiofiles
        async with aiofiles.open(file_path, 'r', encoding='utf-8') as f:
            item = json.loads(await f.read())
        
        self.status["status"] = f"🍳 Đang xử lý: {item.get('title', 'Unknown')[:30]}..."

        raw_content = item.get('content') or item.get('summary', '')
        
        # 1. TRIAGE
        triage_prompt = f"""Bạn là bộ lọc tri thức. GIỮ LẠI (keep) kiến thức có ích, bài học, sự kiện công nghệ/khoa học. BỎ QUA (skip) rác.
Tiêu đề: {item['title']}
Trả về JSON: {{"action": "skip"|"keep"}}"""
        
        try:
            self.status["status"] = "⚖️ AI đang lọc nội dung..."
            triage = await self.ai_provider.generate_structured_json(triage_prompt)
            if triage.get('action') == 'skip':
                self.status["status"] = "🗑️ Đã bỏ qua nội dung rác."
                os.remove(file_path)
                return True
        except: pass

        # 2. TRANSFORM (TASK 2 SPECS)
        self.status["status"] = "✍️ AI đang soạn bài Wiki..."
        prompt = f"""Bạn là hệ thống Knowledge Management. Tái cấu trúc nội dung sau thành bài Wiki chuẩn.
Tuyệt đối không tự suy diễn.

Category: {item['source_category']}
Title: {item['title']}
Content: {raw_content[:5000]}

Yêu cầu trả về JSON Schema:
{{
  "tags": ["..."],
  "summary": "...",
  "key_takeaways": ["..."],
  "wiki_body_markdown": "...",
  "graph": {{"entities": [], "relationships": []}}
}}"""
        
        try:
            result = await self.ai_provider.generate_structured_json(prompt)
            
            final_content = f"""---
title: "{item['title']}"
source: "{item['source_name']}"
tags: {json.dumps(result.get('tags', []))}
---
# {item['title']}
> [!summary] Tóm tắt
> {result.get('summary', '')}

## Key Takeaways
{chr(10).join([f"- {t}" for t in result.get('key_takeaways', [])])}

---

{result.get('wiki_body_markdown', '')}

---
[Nguồn gốc]({item['link']})
"""
            # 3. SAVE & SINK (TASK 3 SPECS)
            self.status["status"] = "💾 Đang lưu vào Vault..."
            now_date = datetime.now().strftime('%Y-%m-%d')
            subfolder = f"10-Knowledge/{item['source_category']}/{now_date}"
            saved_path = await self.wiki_repo.save(f"{item['title'][:50]}.md", final_content, category=subfolder)
            
            # Indexing
            if self.rag_service:
                self.status["status"] = "🧠 Đang nạp vào Vector DB..."
                await self.rag_service.add_document(saved_path, final_content, {"source": item['source_name']})
            
            if self.neo4j_repo and 'graph' in result:
                self.status["status"] = "🕸️ Đang cập nhật Knowledge Graph..."
                await self.neo4j_repo.upsert_entities_and_relationships(
                    result['graph'].get('entities', []), 
                    result['graph'].get('relationships', []),
                    source_title=item['title']
                )

            os.remove(file_path)
            return True
        except Exception as e:
            logger.error(f"Cook error: {e}")
            return False

    async def run_once(self):
        if self.paused:
            logger.info("⏸️ Cook loop paused (emergency stop active)")
            return
        if self.status["running"] or not self.ai_provider: return
        if not _has_network():
            logger.warning("⚠️ No network — skipping cook cycle to avoid burning retries")
            return
        with os.scandir(self.raw_dir) as it:
            raw_files = [e.name for e in it if e.is_file() and e.name.endswith(".json")]
        if not raw_files: return
        await self.cook_files(raw_files)

    async def execute(self):
        while True:
            await self.run_once()
            await asyncio.sleep(300)

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
            # 1. Get trending topics
            discovery = GetDiscoveryUseCase(self.source_provider)
            data = await discovery.execute()
            items = data.get("items", [])
            
            if not items:
                logger.info("🔬 AI Researcher: No trending items found, skipping.")
                self.status["running"] = False
                return

            # 2. Pick a high-value item (prefer Tech tags or random)
            import random
            target = random.choice(items[:5]) # Top 5
            logger.info(f"🔬 AI Researcher: Deep-diving into: {target['title']}")

            # 3. Fetch full content
            content = await _fetch_full_content(target['url'])
            if not content or len(content) < 500:
                logger.warning("🔬 AI Researcher: Content too short for deep research.")
                self.status["running"] = False
                return

            # 4. Generate Research Report
            prompt = f"""Bạn là chuyên gia Phân tích Tri thức. Hãy thực hiện NGHIÊN CỨU CHUYÊN SÂU về chủ đề sau.
Chủ đề: {target['title']}
Nguồn: {target['site']}
Nội dung thô: {content[:10000]}

Yêu cầu:
1. Viết báo cáo Markdown chuyên nghiệp (Title, Abstract, Context, Technical Insights, Impact, Related Concepts).
2. TRẢ VỀ KẾT QUẢ TRONG JSON THEO ĐÚNG CẤU TRÚC SAU.
3. QUAN TRỌNG: Đảm bảo các ký tự xuống dòng và nháy kép trong Markdown được escape đúng chuẩn JSON.

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
            # 5. Save to Permanent Wiki
            now_date = datetime.now().strftime('%Y-%m-%d')
            filename = f"RESEARCH_{hashlib.md5(target['title'].encode()).hexdigest()[:8]}.md"
            await self.wiki_repo.save(filename, final_md, category=f"10-Knowledge/Research/{now_date}")
            
            logger.info(f"✅ AI Researcher: Deep-dive report saved: {filename}")

        except Exception as e:
            logger.error(f"❌ AI Researcher error: {e}")
        
        self.status["running"] = False

    async def execute(self):
        # Wait 10 min after startup to not overload
        await asyncio.sleep(600) 
        while True:
            await self.run_once()
            await asyncio.sleep(3600)
