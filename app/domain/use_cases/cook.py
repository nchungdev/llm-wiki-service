import os
import re
import asyncio
import logging
import json
from datetime import datetime, date, timedelta
from ...infrastructure.ai_provider import AIProvider
from ...infrastructure.rag_provider import RAGService
from ...domain.repositories import IWikiRepository
from ...core.obsidian import ObsidianEngine
from ...domain.pipeline_manager import chef, TaskType, TaskStatus

logger = logging.getLogger(__name__)

SCORE_TTL = {
    # score: days until expiry (None = no expiry)
    1: 0, 2: 0, 3: 0,
    4: 7, 5: 7,
    6: 30, 7: 30,
    8: None, 9: None, 10: None,
}

FOLDER_CATEGORIES = ['Tech', 'AI-ML', 'Science', 'Entertainment', 'True-Crime', 'Business', 'Collectibles', 'Books']

class RunCookUseCase:
    """TASK 2: AI PROCESSING (TRANSFORMER)"""
    def __init__(self, raw_dir: str, wiki_repo: IWikiRepository, ai_provider: AIProvider,
                 rag_service: RAGService = None, neo4j_repo=None):
        self.raw_dir = os.path.join(raw_dir, "crawl")
        self.wiki_repo = wiki_repo
        self.ai_provider = ai_provider
        self.rag_service = rag_service
        self.neo4j_repo = neo4j_repo
        self.status = {"running": False, "processed": 0, "total": 0, "current": None, "queue": []}

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
        self.status["queue"] = list(filenames)
        self.status["current"] = None

        cooked_list = []
        for f in filenames:
            # Load metadata for title
            item_title = f
            try:
                with open(os.path.join(self.raw_dir, f), 'r', encoding='utf-8') as jf:
                    data = json.load(jf)
                    item_title = data.get('title', f)
            except: pass

            await chef.register_task(f, TaskType.RAW_FILE, item_title)
            
            self.status["current"] = f
            self.status["queue"] = [x for x in self.status["queue"] if x != f]
            success = await self._process_file(os.path.join(self.raw_dir, f), f)
            if success:
                cooked_list.append(f)
                self.status["processed"] += 1
                await chef.update_task(f, status=TaskStatus.DONE, progress=100)
            else:
                await chef.update_task(f, status=TaskStatus.ERROR, message="Lỗi xử lý")

        self.status["running"] = False
        self.status["current"] = None
        self.status["queue"] = []
        return {"status": "success", "processed": self.status["processed"], "files": cooked_list}

    async def _process_file(self, file_path: str, task_id: str) -> bool:
        if not os.path.exists(file_path): return False
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                item = json.load(f)

            raw_content = item.get('content') or item.get('summary', '')
            title = item.get('title', '')
            source_name = item.get('source_name', 'Unknown')
            source_url = item.get('link', '')

            # ── BƯỚC 0: KEYWORD PRE-FILTER ──────────────────────
            junk_keywords = ['vụ án', 'hình sự', 'tai nạn', 'tử vong', 'scandal', 'showbiz']
            if any(kw in title.lower() for kw in junk_keywords):
                logger.info(f"  🗑️ Pre-filter: '{title}'")
                await chef.update_task(task_id, status=TaskStatus.SKIPPED, message="Lọc rác")
                os.remove(file_path)
                return True

            # ── BƯỚC 1: CLASSIFICATION (score + series + folder) ─
            await chef.update_task(task_id, status=TaskStatus.ANALYZING, progress=20, message="Đang phân tích...")
            classification = await self._classify(title, source_name, raw_content)
            score = classification.get('knowledge_score', 5)
            folder_category = classification.get('folder_category', 'Tech')
            knowledge_type = classification.get('knowledge_type', 'feed')
            series = classification.get('series')
            series_part = classification.get('series_part')
            series_type = classification.get('series_type')
            score_reason = classification.get('score_reason', '')

            # Delete immediately if score 1-3
            if score <= 3:
                logger.info(f"  ⏭️ Score {score} (too low): '{title}'")
                await chef.update_task(task_id, status=TaskStatus.SKIPPED, message=f"Điểm thấp ({score})")
                os.remove(file_path)
                return True

            # Compute expiry
            ttl_days = SCORE_TTL.get(score)
            expires = None
            if ttl_days is not None and ttl_days > 0:
                expires = (date.today() + timedelta(days=ttl_days)).isoformat()

            # Score 10 → auto-promote to Knowledge
            if score == 10:
                knowledge_type = 'knowledge'

            # ── BƯỚC 2: TRIAGE ─────────────────────────────────
            await chef.update_task(task_id, status=TaskStatus.TRIAGING, progress=40, message="AI đang lọc...")
            triage_prompt = f"""Phân loại nội dung tri thức:
- skip: BỎ QUA rác, tin xã hội thuần túy, gossip.
- keep: GIỮ LẠI kiến thức có ích, hướng dẫn, bài học.
Tiêu đề: {title}
Trả về JSON: {{"action": "skip"|"keep"}}"""
            triage = await self.ai_provider.generate_structured_json(triage_prompt)
            if triage.get('action') == 'skip':
                await chef.update_task(task_id, status=TaskStatus.SKIPPED, message="AI bỏ qua")
                os.remove(file_path)
                return True

            # ── BƯỚC 3: TRANSFORM ──────────────────────────────
            await chef.update_task(task_id, status=TaskStatus.WRITING, progress=60, message="AI đang viết Wiki...")
            prompt = f"""Tái cấu trúc bài viết sau thành Wiki Obsidian chuẩn (ưu tiên trình bày bằng tiếng Việt).
Category: {folder_category}
Title: {title}
Content: {raw_content[:12000]}

Rules:
- Nếu Category là 'Books', hãy tóm tắt nội dung cốt lõi của cuốn sách, các mục tiêu học tập chính và giá trị tri thức mà cuốn sách mang lại.
- Trình bày Summary và Key Takeaways bằng tiếng Việt súc tích, chuyên nghiệp.
- Giữ nguyên các thuật ngữ chuyên môn tiếng Anh nếu cần thiết.

Trả về JSON:
{{
  "tags": ["..."],
  "summary": "Tóm tắt súc tích bằng tiếng Việt...",
  "key_takeaways": ["Điểm cốt lõi 1 bằng tiếng Việt...", "Điểm cốt lõi 2..."],
  "wiki_body_markdown": "Nội dung chi tiết định dạng Markdown...",
  "graph": {{"entities": [], "relationships": []}}
}}"""
            result = await self.ai_provider.generate_structured_json(prompt)

            # ── BƯỚC 4: OBSIDIAN ENGINE ─────────────────────────
            final_content = ObsidianEngine.generate_page(
                title=title,
                content=result.get('wiki_body_markdown', ''),
                source_name=source_name,
                source_url=source_url,
                category=folder_category,
                tags=result.get('tags', []),
                knowledge_type=knowledge_type,
                folder_category=folder_category,
                series=series,
                series_part=series_part,
                series_type=series_type,
                score=score,
                score_reason=score_reason,
                status='active',
                expires=expires,
                metadata={
                    "link": source_url,
                    "key_takeaways": result.get('key_takeaways', []),
                    "summary_ai": result.get('summary', '')
                }
            )

            # ── BƯỚC 5: DATA SINK ───────────────────────────────
            await chef.update_task(task_id, status=TaskStatus.INDEXING, progress=80, message="Đang lưu & Index...")
            prefix = "Knowledge" if knowledge_type == "knowledge" else "Feed"
            subfolder = f"{prefix}/{folder_category}"
            safe_title = re.sub(r'[<>:"/\\|?*]', '', title)[:100]
            saved_path = await self.wiki_repo.save(f"{safe_title}.md", final_content, category=subfolder)

            # ── BƯỚC 6: SERIES MOC ──────────────────────────────
            if series:
                await self.wiki_repo.ensure_series_moc(series, series_type or 'series', folder_category)

            # ── BƯỚC 7: INDEXING ────────────────────────────────
            if self.rag_service:
                await self.rag_service.add_document(saved_path, final_content, {"source": source_name})
            if self.neo4j_repo and 'graph' in result:
                await self.neo4j_repo.upsert_entities_and_relationships(
                    result['graph'].get('entities', []),
                    result['graph'].get('relationships', []),
                    source_title=title
                )

            os.remove(file_path)
            logger.info(f"✅ Cooked → {subfolder}: {title} (score={score})")
            return True

        except Exception as e:
            logger.error(f"Cook error: {e}")
            await chef.update_task(task_id, status=TaskStatus.ERROR, message=str(e))
            return False

    async def _classify(self, title: str, source_name: str, content: str) -> dict:
        """Call AI to classify content: score, folder, series detection."""
        prompt = f"""You are organizing a personal knowledge base for a Vietnamese Android Software Engineer.
Analyze this article and return classification metadata.

Title: {title}
Source: {source_name}
Content excerpt: {content[:2000]}

Return JSON only:
{{
  "knowledge_score": 7,
  "score_reason": "brief reason in Vietnamese",
  "folder_category": "Tech",
  "knowledge_type": "feed",
  "series": null,
  "series_part": null,
  "series_type": null
}}

Rules:
- knowledge_score 1-10: how valuable is this for long-term knowledge? (10=evergreen concepts, 1=ephemeral news/gossip)
- folder_category: one of Tech | AI-ML | Science | Entertainment | True-Crime | Business | Collectibles | Books
- knowledge_type: "feed" for automated content, "knowledge" only for deeply educational evergreen content
- series: name of the series if this is part of one (manga chapters, weekly updates, book series, crime cases), else null
- series_part: chapter/episode/volume number if applicable, else null
- series_type: manga | tech-updates | book-series | case | null

Score guidance:
- 1-3: news, gossip, product announcements with no depth
- 4-5: mildly interesting but not very reusable
- 6-7: useful reference, worth keeping temporarily
- 8-9: high-value knowledge, worth keeping long-term
- 10: evergreen concepts, fundamental knowledge
"""
        try:
            result = await self.ai_provider.generate_structured_json(prompt)
            # Validate folder_category
            if result.get('folder_category') not in FOLDER_CATEGORIES:
                result['folder_category'] = 'Tech'
            result['knowledge_score'] = max(1, min(10, int(result.get('knowledge_score', 5))))
            return result
        except Exception as e:
            logger.warning(f"Classification failed, using defaults: {e}")
            return {"knowledge_score": 5, "folder_category": "Tech", "knowledge_type": "feed"}

    async def run_once(self):
        if self.status["running"] or not self.ai_provider: return
        raw_files = [f for f in os.listdir(self.raw_dir) if f.endswith(".json")]
        if not raw_files: return
        await self.cook_files(raw_files)

    async def execute(self):
        while True:
            await self.run_once()
            await asyncio.sleep(300)
