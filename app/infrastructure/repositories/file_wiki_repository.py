import os
import re
import json
import aiofiles
from datetime import datetime
from typing import List, Optional
from ...domain.repositories import IWikiRepository
from ...core.obsidian import ObsidianEngine

_FRONTMATTER_RE = re.compile(r'^---\s*\n(.*?)\n---\s*\n', re.DOTALL)

def _parse_frontmatter(content: str) -> dict:
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).splitlines():
        if ':' in line:
            k, _, v = line.partition(':')
            fm[k.strip()] = v.strip().strip('"')
    return fm

def _safe_filename(title: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]', '', title)
    name = re.sub(r'\s+', ' ', name).strip()
    return name[:120] + '.md'

class FileWikiRepository(IWikiRepository):
    def __init__(self, wiki_dir: str):
        self.wiki_dir = wiki_dir
        os.makedirs(self.wiki_dir, exist_ok=True)
        self._cache = {} # rel_path -> metadata_dict

    def _all_md_files(self) -> List[tuple[str, str]]:
        """Walk wiki_dir (including subfolders) and return (relative_path, abs_path) tuples."""
        results = []
        for root, dirs, files in os.walk(self.wiki_dir):
            # Skip hidden folders (.obsidian, .trash)
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if f.endswith('.md'):
                    abs_path = os.path.join(root, f)
                    rel_path = os.path.relpath(abs_path, self.wiki_dir)
                    results.append((rel_path, abs_path))
        return results

    async def list_pages(self) -> List[dict]:
        pages = []
        all_files = self._all_md_files()
        
        # 1. Parallel Stat Check
        for rel_path, abs_path in all_files:
            try:
                stats = os.stat(abs_path)
                mtime = stats.st_mtime
                size = stats.st_size
                
                # Check cache
                cached = self._cache.get(rel_path)
                if cached and cached.get('_mtime') == mtime and 'created_at' in cached:
                    # Only add to list if it's not uncategorized/hidden
                    if cached.get('category') and cached.get('category') != 'uncategorized':
                        pages.append(cached)
                    continue
                
                # 2. Cache Miss: Read file (limited for speed)
                async with aiofiles.open(abs_path, mode='r', encoding='utf-8') as f:
                    # Only read the first 1024 bytes for frontmatter to save IO
                    content_chunk = await f.read(1024)
                
                fm = _parse_frontmatter(content_chunk)
                category = fm.get('category', '')
                
                # Metadata to cache
                page_data = {
                    "filename": rel_path,
                    "title": fm.get('title') or rel_path.replace('.md', '').replace('_', ' '),
                    "category": category or 'uncategorized',
                    "tags": fm.get('tags', ''),
                    "has_graph": bool(fm.get('entities')),
                    "created_at": str(fm.get('created') or datetime.fromtimestamp(stats.st_ctime).isoformat()),
                    "size": size,
                    "_mtime": mtime 
                }
                self._cache[rel_path] = page_data

                if category and category != 'uncategorized':
                    pages.append(page_data)
            except Exception:
                continue
                
        # Use .get with fallback to avoid any possible KeyError during sorting
        return sorted(pages, key=lambda x: x.get('created_at', ''), reverse=True)

    async def get_page(self, filename: str) -> dict:
        file_path = os.path.join(self.wiki_dir, filename)
        async with aiofiles.open(file_path, mode='r', encoding='utf-8') as f:
            content = await f.read()
        stats = os.stat(file_path)
        fm = _parse_frontmatter(content)
        return {
            "title": fm.get('title', filename),
            "content": content,
            "metadata": fm,
            "created_at": fm.get('created') or datetime.fromtimestamp(stats.st_ctime).isoformat(),
            "size": stats.st_size,
        }

    async def save_page(self, title: str, content: str, metadata: dict = None) -> str:
        """Save to category subfolder derived from metadata or content. Returns relative path."""
        category = ''
        if metadata and metadata.get('category'):
            category = metadata['category']
        elif content.startswith('---'):
            fm = _parse_frontmatter(content)
            category = fm.get('category', '')

        filename = _safe_filename(title)
        return await self.save(filename, content, category=category)

    async def save(self, filename: str, content: str, category: str = '') -> str:
        """Save to category subfolder when category provided, else flat."""
        if category:
            folder = os.path.join(self.wiki_dir, category)
            os.makedirs(folder, exist_ok=True)
            file_path = os.path.join(folder, filename)
            rel_path = os.path.join(category, filename)
        else:
            file_path = os.path.join(self.wiki_dir, filename)
            rel_path = filename
        async with aiofiles.open(file_path, mode='w', encoding='utf-8') as f:
            await f.write(content)
        return rel_path

    async def delete_page(self, filename: str):
        file_path = os.path.join(self.wiki_dir, filename)
        if os.path.exists(file_path):
            os.remove(file_path)

    async def ensure_series_moc(self, series: str, series_type: str, folder_category: str):
        """Create Atlas/Series/{series}.md if it doesn't exist yet."""
        safe_name = re.sub(r'[<>:"/\\|?*]', '', series).strip()
        moc_dir = os.path.join(self.wiki_dir, "Atlas", "Series")
        os.makedirs(moc_dir, exist_ok=True)
        moc_path = os.path.join(moc_dir, f"{safe_name}.md")
        if not os.path.exists(moc_path):
            content = ObsidianEngine.generate_series_moc(series, series_type, folder_category)
            async with aiofiles.open(moc_path, mode='w', encoding='utf-8') as f:
                await f.write(content)
            import logging
            logging.getLogger(__name__).info(f"📚 Created series MOC: Atlas/Series/{safe_name}.md")
