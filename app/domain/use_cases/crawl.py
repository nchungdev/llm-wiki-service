import os
import re
import asyncio
import logging
import json
import httpx
import feedparser
import hashlib
from datetime import datetime
from bs4 import BeautifulSoup
from markdownify import markdownify as md

logger = logging.getLogger(__name__)


def _extract_video_id(url: str) -> str | None:
    m = re.search(r'(?:v=|youtu\.be/|/v/|/embed/)([A-Za-z0-9_-]{11})', url)
    return m.group(1) if m else None


async def _fetch_youtube_transcript(video_id: str) -> str:
    """Fetch transcript via youtube-transcript-api (sync → run in executor)."""
    def _sync_fetch():
        from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled
        try:
            # Try Vietnamese first, then any available language
            try:
                segments = YouTubeTranscriptApi.get_transcript(video_id, languages=['vi', 'en'])
            except NoTranscriptFound:
                transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
                segments = transcript_list.find_transcript(
                    transcript_list._manually_created_transcripts or
                    list(transcript_list._generated_transcripts.keys())[:1]
                ).fetch()
            return ' '.join(s['text'] for s in segments)
        except TranscriptsDisabled:
            return ''
        except Exception as e:
            logger.debug(f"Transcript unavailable for {video_id}: {e}")
            return ''

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_fetch)


def _build_youtube_content(title: str, description: str, transcript: str) -> str:
    parts = [f"TITLE: {title}"]
    if description:
        parts.append(f"\nDESCRIPTION:\n{description[:800]}")
    if transcript:
        parts.append(f"\nTRANSCRIPT:\n{transcript[:20000]}")
    return '\n'.join(parts)


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

class RunDailyCrawlUseCase:
    """TASK 1: DATA EXTRACTION (ROUTING CRAWLER)"""
    def __init__(self, raw_dir: str, source_provider, max_concurrent=3, on_finish=None, youtube_api_key=None):
        self.raw_dir = os.path.join(raw_dir, "crawl")
        os.makedirs(self.raw_dir, exist_ok=True)
        self.source_provider = source_provider
        self.max_concurrent = max_concurrent
        self.on_finish = on_finish
        self.yt_key = youtube_api_key
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
            self.status["tasks"][source_id]["status"] = f"Extracting ({source.type})..."
            try:
                raw_items = []
                
                # BRANCH 1: YOUTUBE (type=youtube, url=channel_id or video_url)
                if source.type == 'youtube':
                    if source.url.startswith('UC') and len(source.url) == 24:
                        self.status["tasks"][source_id]["status"] = "Đang đọc kênh YouTube..."
                        feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={source.url}"
                        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
                        async with httpx.AsyncClient(headers=headers, timeout=15.0, follow_redirects=True) as client:
                            resp = await client.get(feed_url)
                            if resp.status_code == 200:
                                d = feedparser.parse(resp.text)
                                for entry in d.entries[:5]:
                                    vid = _extract_video_id(entry.link)
                                    self.status["tasks"][source_id]["status"] = f"Transcript: {entry.title[:35]}..."
                                    transcript = await _fetch_youtube_transcript(vid) if vid else ''
                                    description = entry.get('summary', '')
                                    content = _build_youtube_content(entry.title, description, transcript)
                                    raw_items.append({
                                        "source_name": source.name,
                                        "source_category": source.category,
                                        "source_type": "youtube",
                                        "title": entry.title,
                                        "link": entry.link,
                                        "content": content,
                                        "summary": (transcript or description)[:500]
                                    })
                    else:
                        video_id = _extract_video_id(source.url) or source.url
                        self.status["tasks"][source_id]["status"] = f"Transcript: {source.name[:35]}..."
                        transcript = await _fetch_youtube_transcript(video_id)
                        title, description = source.name, ''
                        if self.yt_key:
                            api_url = f"https://www.googleapis.com/youtube/v3/videos?part=snippet&id={video_id}&key={self.yt_key}"
                            async with httpx.AsyncClient(timeout=10.0) as client:
                                resp = await client.get(api_url)
                                data = resp.json()
                                if data.get('items'):
                                    snip = data['items'][0]['snippet']
                                    title, description = snip['title'], snip['description']
                        raw_items.append({
                            "source_name": source.name,
                            "source_category": source.category,
                            "source_type": "youtube",
                            "title": title,
                            "link": f"https://youtube.com/watch?v={video_id}",
                            "content": _build_youtube_content(title, description, transcript),
                            "summary": (transcript or description)[:500]
                        })
                
                # BRANCH 2: WIKIPEDIA API
                elif source.type == 'wikipedia':
                    title = source.url.split('/wiki/')[-1] if '/wiki/' in source.url else source.url
                    self.status["tasks"][source_id]["status"] = f"Đang lấy trang: {title[:40]}..."
                    api_url = f"https://vi.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles={title}&format=json"
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        resp = await client.get(api_url)
                        data = resp.json()
                        pages = data.get('query', {}).get('pages', {})
                        page_id = list(pages.keys())[0]
                        if page_id != "-1":
                            pg = pages[page_id]
                            self.status["tasks"][source_id]["status"] = f"Wiki: {pg['title'][:40]}..."
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
                    self.status["tasks"][source_id]["status"] = f"Đang kết nối URL..."
                    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
                    async with httpx.AsyncClient(headers=headers, timeout=15.0, follow_redirects=True) as client:
                        resp = await client.get(source.url)
                        if source.type == 'rss' or 'xml' in resp.headers.get('Content-Type', ''):
                            d = feedparser.parse(resp.text)
                            for entry in d.entries[:5]:
                                self.status["tasks"][source_id]["status"] = f"Đọc: {entry.title[:40]}..."
                                vid = _extract_video_id(entry.link)
                                if vid:
                                    # YouTube RSS entry → fetch transcript
                                    self.status["tasks"][source_id]["status"] = f"Transcript: {entry.title[:35]}..."
                                    transcript = await _fetch_youtube_transcript(vid)
                                    description = entry.get('summary', '') or entry.get('description', '')
                                    content = _build_youtube_content(entry.title, description, transcript)
                                    summary = (transcript or description)[:500]
                                    source_type = "youtube"
                                else:
                                    content = await _fetch_full_content(entry.link)
                                    summary = entry.get('summary', '') or entry.get('description', '')
                                    source_type = "rss"
                                raw_items.append({
                                    "source_name": source.name,
                                    "source_category": source.category,
                                    "source_type": source_type,
                                    "title": entry.title,
                                    "link": entry.link,
                                    "summary": summary,
                                    "content": content
                                })
                        else:
                            self.status["tasks"][source_id]["status"] = f"Đang bóc tách HTML..."
                            content = await _fetch_full_content(source.url)
                            self.status["tasks"][source_id]["status"] = f"Hoàn thành: {source.name[:40]}..."
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
        if self.status["running"]: return
        start_time = datetime.now()
        self.status["running"] = True
        self.status["processed"] = 0
        self.status["items_found"] = 0
        self.status["tasks"] = {}
        
        all_sources = self.source_provider.get_all_sources()
        if source_id:
            active_sources = [s for s in all_sources if s.id == source_id]
        else:
            active_sources = [s for s in all_sources if s.active]
            
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

    async def execute(self, crawl_time: str = "06:00"):
        """Run daily at crawl_time (HH:MM local). Sleeps until next occurrence."""
        import datetime as dt
        while True:
            now = dt.datetime.now()
            try:
                h, m = (int(x) for x in crawl_time.split(":"))
            except Exception:
                h, m = 6, 0
            target = now.replace(hour=h, minute=m, second=0, microsecond=0)
            if target <= now:
                target += dt.timedelta(days=1)
            secs = (target - now).total_seconds()
            logger.info(f"⏰ Next crawl scheduled at {target.strftime('%Y-%m-%d %H:%M')}")
            await asyncio.sleep(secs)
            await self.run_once()
