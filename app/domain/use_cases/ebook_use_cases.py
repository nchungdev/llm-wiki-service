"""
Ebook → GraphRAG Pipeline
1. Parse: EPUB/PDF → List[Chapter]
2. Map: mỗi chapter → entity/relationship extraction (parallel, semaphore)
3. Reduce: merge local graphs → Entity Resolution → global graph
4. Store: Chroma (vector chunks) + Neo4j (graph)
"""
import asyncio
import logging
import os
import re
from dataclasses import dataclass, field
from typing import List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

CONCURRENCY = int(os.getenv("EBOOK_CONCURRENCY", "3"))


@dataclass
class EbookMetadata:
    title: str
    author: str = ""
    language: str = "vi"
    category: str = "permanent"
    tags: List[str] = field(default_factory=list)


# ─────────────────────────────────────────
# Map phase: per-chapter extraction
# ─────────────────────────────────────────

def _map_prompt(chapter_title: str, content: str) -> str:
    preview = content[:3000]
    return f"""Bạn là chuyên gia phân tích tri thức. Hãy trích xuất thực thể và quan hệ từ đoạn văn sau.

CHƯƠNG: {chapter_title}

NỘI DUNG:
{preview}

Trả về JSON với cấu trúc sau:
{{
  "entities": [
    {{"name": "tên thực thể", "type": "Khái niệm|Người|Tổ chức|Công nghệ|Địa điểm|Sự kiện", "description": "mô tả ngắn bằng tiếng Việt"}},
    ...
  ],
  "relationships": [
    {{"source": "thực thể nguồn", "target": "thực thể đích", "type": "liên quan|là loại|sử dụng|tạo ra|trái ngược|phụ thuộc", "description": "giải thích mối quan hệ"}},
    ...
  ],
  "summary": "tóm tắt chương bằng 2-3 câu tiếng Việt"
}}

CHỈ TRẢ VỀ JSON. KHÔNG GIẢI THÍCH."""


async def _map_chapter(ai_provider, chapter, semaphore) -> dict:
    async with semaphore:
        logger.info(f"  📖 Map chapter {chapter.index}: '{chapter.title[:50]}'")
        try:
            prompt = _map_prompt(chapter.title, chapter.content)
            result = await ai_provider.generate_structured_json(prompt, use_heavy_model=True)
            return {
                "chapter_index": chapter.index,
                "chapter_title": chapter.title,
                "entities": result.get("entities", []),
                "relationships": result.get("relationships", []),
                "summary": result.get("summary", ""),
                "word_count": chapter.word_count,
            }
        except Exception as e:
            logger.error(f"  ❌ Map error chapter {chapter.index}: {e}")
            return {
                "chapter_index": chapter.index,
                "chapter_title": chapter.title,
                "entities": [],
                "relationships": [],
                "summary": "",
                "word_count": chapter.word_count,
            }


# ─────────────────────────────────────────
# Reduce phase: merge + Entity Resolution
# ─────────────────────────────────────────

def _normalize(name: str) -> str:
    return re.sub(r'\s+', ' ', name.strip().lower())


def _are_similar(a: str, b: str) -> bool:
    """Simple fuzzy match: same after normalization OR one contains the other (min 4 chars)."""
    na, nb = _normalize(a), _normalize(b)
    if na == nb:
        return True
    if len(na) >= 4 and len(nb) >= 4:
        if na in nb or nb in na:
            return True
    return False


def _resolve_entities(all_entities: List[dict]) -> dict:
    """
    Entity Resolution: group similar entities, pick canonical name (longest non-abbrev).
    Returns {original_name: canonical_name} mapping.
    """
    groups: List[List[str]] = []
    name_to_group: dict = {}

    for ent in all_entities:
        name = ent.get("name", "").strip()
        if not name:
            continue
        matched = None
        for i, group in enumerate(groups):
            if any(_are_similar(name, g) for g in group):
                matched = i
                break
        if matched is not None:
            groups[matched].append(name)
            name_to_group[name] = matched
        else:
            idx = len(groups)
            groups.append([name])
            name_to_group[name] = idx

    # Pick canonical = longest name in group (prefer non-abbreviation)
    canonical_map = {}
    for group in groups:
        canonical = max(group, key=lambda x: len(x))
        for name in group:
            canonical_map[name] = canonical

    return canonical_map


def _reduce_graph(chapter_results: List[dict]) -> dict:
    """Merge all per-chapter graphs, resolve entities, deduplicate relationships."""
    all_entities_raw = []
    all_relationships_raw = []

    for cr in chapter_results:
        all_entities_raw.extend(cr.get("entities", []))
        all_relationships_raw.extend(cr.get("relationships", []))

    canonical_map = _resolve_entities(all_entities_raw)

    # Merge entity descriptions
    merged_entities: dict = {}
    for ent in all_entities_raw:
        name = ent.get("name", "").strip()
        if not name:
            continue
        canon = canonical_map.get(name, name)
        if canon not in merged_entities:
            merged_entities[canon] = {
                "name": canon,
                "type": ent.get("type", "Khái niệm"),
                "description": ent.get("description", ""),
                "aliases": set(),
            }
        if name != canon:
            merged_entities[canon]["aliases"].add(name)
        # Append extra descriptions
        existing_desc = merged_entities[canon]["description"]
        new_desc = ent.get("description", "")
        if new_desc and new_desc not in existing_desc:
            merged_entities[canon]["description"] = (existing_desc + " " + new_desc).strip()

    # Convert aliases set to list
    for ent in merged_entities.values():
        ent["aliases"] = list(ent["aliases"])

    # Merge relationships with canonical names, deduplicate
    seen_rels = set()
    merged_relationships = []
    for rel in all_relationships_raw:
        src = canonical_map.get(rel.get("source", "").strip(), rel.get("source", "").strip())
        tgt = canonical_map.get(rel.get("target", "").strip(), rel.get("target", "").strip())
        rel_type = rel.get("type", "liên quan")
        key = (src, tgt, rel_type)
        if key not in seen_rels and src and tgt:
            seen_rels.add(key)
            merged_relationships.append({
                "source": src,
                "target": tgt,
                "type": rel_type,
                "description": rel.get("description", ""),
            })

    return {
        "entities": list(merged_entities.values()),
        "relationships": merged_relationships,
    }


# ─────────────────────────────────────────
# LLM-assisted global summary
# ─────────────────────────────────────────

def _global_summary_prompt(metadata: EbookMetadata, chapter_summaries: List[str]) -> str:
    summaries_text = "\n".join(f"- {s}" for s in chapter_summaries if s)[:4000]
    return f"""Bạn là chuyên gia tóm tắt sách. Dựa vào các tóm tắt chương dưới đây, hãy viết một bản tóm tắt tổng quát cho cuốn sách.

SÁCH: "{metadata.title}" — {metadata.author}

TÓM TẮT CÁC CHƯƠNG:
{summaries_text}

Trả về JSON:
{{
  "overview": "tóm tắt tổng quát 3-5 câu tiếng Việt",
  "key_concepts": ["khái niệm chính 1", "khái niệm chính 2", "..."],
  "target_audience": "độc giả mục tiêu",
  "main_takeaway": "bài học/insight quan trọng nhất"
}}

CHỈ TRẢ VỀ JSON."""


# ─────────────────────────────────────────
# Main Pipeline Use Case
# ─────────────────────────────────────────

class ProcessEbookUseCase:
    def __init__(self, wiki_repo, ai_provider, rag_service=None, neo4j_repo=None):
        self.wiki_repo = wiki_repo
        self.ai_provider = ai_provider
        self.rag_service = rag_service
        self.neo4j_repo = neo4j_repo
        self.status = {"running": False, "progress": "", "done": 0, "total": 0}

    async def execute(self, file_path: str, metadata: EbookMetadata) -> dict:
        self.status = {"running": True, "progress": "Đang phân tích file...", "done": 0, "total": 0}
        try:
            return await self._run(file_path, metadata)
        except Exception as e:
            logger.error(f"❌ Ebook pipeline error: {e}")
            self.status["running"] = False
            self.status["progress"] = f"Lỗi: {e}"
            raise
        finally:
            self.status["running"] = False

    async def _run(self, file_path: str, metadata: EbookMetadata) -> dict:
        ext = os.path.splitext(file_path)[1].lower()

        # ── 1. Parse ──────────────────────────────────
        self.status["progress"] = "Đang đọc và phân tích nội dung sách..."
        if ext == ".epub":
            from app.infrastructure.parsers.epub_parser import parse_epub
            chapters = parse_epub(file_path)
        elif ext == ".pdf":
            from app.infrastructure.parsers.pdf_parser import parse_pdf
            chapters = parse_pdf(file_path)
        else:
            raise ValueError(f"Định dạng không hỗ trợ: {ext}")

        if not chapters:
            return {"status": "error", "message": "Không trích xuất được nội dung từ file."}

        logger.info(f"📚 Ebook '{metadata.title}': {len(chapters)} chương")
        self.status["total"] = len(chapters)

        # ── 2. Map ────────────────────────────────────
        self.status["progress"] = f"Đang phân tích {len(chapters)} chương (Map phase)..."
        semaphore = asyncio.Semaphore(CONCURRENCY)
        tasks = [_map_chapter(self.ai_provider, ch, semaphore) for ch in chapters]

        chapter_results = []
        for coro in asyncio.as_completed(tasks):
            result = await coro
            chapter_results.append(result)
            self.status["done"] += 1
            self.status["progress"] = f"Đã xử lý {self.status['done']}/{len(chapters)} chương..."

        # Sort back by chapter index
        chapter_results.sort(key=lambda x: x["chapter_index"])

        # ── 3. Reduce + Entity Resolution ─────────────
        self.status["progress"] = "Đang hợp nhất đồ thị tri thức (Reduce + Entity Resolution)..."
        global_graph = _reduce_graph(chapter_results)
        logger.info(
            f"🔗 Graph: {len(global_graph['entities'])} entities, "
            f"{len(global_graph['relationships'])} relationships"
        )

        # ── 4. Global summary via LLM ─────────────────
        self.status["progress"] = "Đang tạo tóm tắt tổng quát..."
        chapter_summaries = [r["summary"] for r in chapter_results if r["summary"]]
        try:
            summary_prompt = _global_summary_prompt(metadata, chapter_summaries)
            book_summary = await self.ai_provider.generate_structured_json(
                summary_prompt, use_heavy_model=True
            )
        except Exception as e:
            logger.warning(f"⚠️ Global summary failed: {e}")
            book_summary = {"overview": "", "key_concepts": [], "target_audience": "", "main_takeaway": ""}

        # ── 5. Build wiki page ─────────────────────────
        self.status["progress"] = "Đang lưu vào thư viện wiki..."
        wiki_content = self._build_wiki_page(metadata, book_summary, chapter_results, global_graph)
        safe_title = re.sub(r'[<>:"/\\|?*]', '', metadata.title).strip()[:100]
        filename = safe_title.replace(' ', '_') + '.md'
        saved_path = await self.wiki_repo.save(filename, wiki_content, category='10-Knowledge/Library')
        logger.info(f"💾 Wiki saved: {saved_path}")

        # ── 6. Index to Chroma ────────────────────────
        if self.rag_service:
            self.status["progress"] = "Đang lập chỉ mục vector (Chroma)..."
            index_meta = {
                "category": "permanent",
                "source": "ebook",
                "title": metadata.title,
                "author": metadata.author,
                "tags": ",".join(metadata.tags),
            }
            await self.rag_service.add_document(saved_path, wiki_content, index_meta)
            for cr in chapter_results:
                if cr["summary"]:
                    chunk_id = f"{safe_title}_ch{cr['chapter_index']}.md"
                    chunk_meta = {**index_meta, "chapter": cr["chapter_title"]}
                    await self.rag_service.add_document(chunk_id, cr["summary"], chunk_meta)
            logger.info("✅ Chroma indexed")

        # ── 7. Push to Neo4j ──────────────────────────
        if self.neo4j_repo:
            self.status["progress"] = "Đang lưu đồ thị vào Neo4j..."
            try:
                await self.neo4j_repo.upsert_entities_and_relationships(
                    global_graph["entities"],
                    global_graph["relationships"],
                    source_title=metadata.title,
                )
                logger.info("✅ Neo4j graph persisted")
            except Exception as e:
                logger.warning(f"⚠️ Neo4j push failed: {e}")

        return {
            "status": "success",
            "title": metadata.title,
            "chapters_processed": len(chapters),
            "entities": len(global_graph["entities"]),
            "relationships": len(global_graph["relationships"]),
            "wiki_file": saved_path,
            "overview": book_summary.get("overview", ""),
        }

    def _build_wiki_page(
        self,
        metadata: EbookMetadata,
        book_summary: dict,
        chapter_results: List[dict],
        global_graph: dict,
    ) -> str:
        now = datetime.now().strftime("%Y-%m-%d")

        # Frontmatter chuẩn Obsidian / Dataview
        tags_lines = "\n  - ebook\n  - permanent"
        for t in metadata.tags:
            tags_lines += f"\n  - {t}"
        aliases = [metadata.author] if metadata.author else []
        aliases_str = ", ".join(f'"{a}"' for a in aliases)

        key_concepts = "\n".join(
            f"- [[{c}]]" for c in book_summary.get("key_concepts", [])
        )

        # Entity list với [[wiki-links]]
        entity_list = "\n".join(
            f"- [[{e['name']}]] ({e.get('type', '')}): {e.get('description', '')[:120]}"
            for e in global_graph["entities"][:30]
        )

        # Relationship list với [[wiki-links]]
        rel_list = "\n".join(
            f"- [[{r['source']}]] → **{r.get('type', 'liên quan')}** → [[{r['target']}]]"
            for r in global_graph["relationships"][:20]
        )

        chapter_section = ""
        for cr in chapter_results:
            if cr["summary"]:
                chapter_section += (
                    f"\n### Chương {cr['chapter_index'] + 1}: {cr['chapter_title']}\n"
                    f"{cr['summary']}\n"
                )

        return f"""---
title: "{metadata.title}"
author: "{metadata.author}"
category: permanent
source: ebook
language: {metadata.language}
tags:{tags_lines}
aliases: [{aliases_str}]
created: {now}
modified: {now}
entities: {len(global_graph['entities'])}
relationships: {len(global_graph['relationships'])}
---

# {metadata.title}

**Tác giả:** {metadata.author}

## Tổng quan

{book_summary.get('overview', '_Chưa có tóm tắt._')}

**Độc giả mục tiêu:** {book_summary.get('target_audience', '')}

**Bài học quan trọng nhất:** {book_summary.get('main_takeaway', '')}

## Khái niệm chính

{key_concepts or '_Chưa trích xuất._'}

## Tóm tắt từng chương

{chapter_section.strip() or '_Chưa có tóm tắt chương._'}

## Đồ thị tri thức

### Thực thể ({len(global_graph['entities'])} tổng cộng)

{entity_list or '_Không có thực thể._'}

### Liên kết ({len(global_graph['relationships'])} tổng cộng)

{rel_list or '_Không có liên kết._'}
"""
