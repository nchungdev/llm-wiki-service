import os
import asyncio
import logging
import json
import hashlib
from datetime import datetime

logger = logging.getLogger(__name__)

class WatchRawFilesUseCase:
    def __init__(self, raw_dir: str, process_callback):
        self.raw_dir = raw_dir
        self.process_callback = process_callback

    async def execute(self):
        logger.info(f"👀 Starting file watcher on {self.raw_dir}")

        def _get_files():
            if not os.path.exists(self.raw_dir):
                return set()
            # scandir reuses a single OS handle + cached DirEntry stats — no per-file open()
            with os.scandir(self.raw_dir) as it:
                return {e.name for e in it if e.is_file(follow_symlinks=False)}

        processed_files = await asyncio.to_thread(_get_files)

        while True:
            try:
                current_files = await asyncio.to_thread(_get_files)
                new_files = current_files - processed_files
                for f in new_files:
                    logger.info(f"✨ New raw file detected: {f}")
                    await self.process_callback(f)
                    processed_files.add(f)
                # Prune deleted files so the set doesn't grow forever
                processed_files &= current_files
            except Exception as e:
                logger.error(f"❌ Error in watcher loop: {e}")
            await asyncio.sleep(30)  # 30s is plenty — cook loop runs every 5min anyway


class InboxWatcherUseCase:
    """
    Watch nhiều inbox folder cho .md file (raw/inbox + wiki/Clippings).
    Khi phát hiện file mới → chuyển thành raw JSON → đẩy qua cook pipeline.
    """
    def __init__(self, inbox_dirs: list, cook_use_case, crawl_raw_dir: str):
        if isinstance(inbox_dirs, str):
            inbox_dirs = [inbox_dirs]
        self.inbox_dirs = inbox_dirs
        self.cook_use_case = cook_use_case
        self.crawl_raw_dir = crawl_raw_dir
        for d in self.inbox_dirs:
            os.makedirs(d, exist_ok=True)

    async def execute(self):
        logger.info(f"📥 Inbox Watcher khởi động: {self.inbox_dirs}")

        def _get_md_files():
            result = {}
            for d in self.inbox_dirs:
                if not os.path.exists(d):
                    continue
                for f in os.listdir(d):
                    if f.endswith('.md'):
                        result[f] = d
            return result

        seen = set((await asyncio.to_thread(_get_md_files)).keys())

        while True:
            await asyncio.sleep(10)
            try:
                current = await asyncio.to_thread(_get_md_files)
                for fname, folder in current.items():
                    if fname not in seen:
                        await self._process_inbox_file(fname, folder)
                        seen.add(fname)
                # Dọn seen nếu file đã bị xóa
                seen &= set(current.keys())
            except Exception as e:
                logger.error(f"❌ Inbox watcher error: {e}")

    async def _process_inbox_file(self, fname: str, folder: str):
        import aiofiles
        fpath = os.path.join(folder, fname)

        # Chờ iCloud sync xong (file size ổn định)
        await asyncio.sleep(3)

        try:
            async with aiofiles.open(fpath, 'r', encoding='utf-8') as f:
                content = await f.read()
        except Exception as e:
            logger.error(f"❌ Không đọc được inbox file {fname}: {e}")
            return

        if len(content.strip()) < 100:
            logger.warning(f"⚠️ Inbox file quá ngắn, bỏ qua: {fname}")
            return

        title = fname.replace('.md', '').replace('_', ' ')
        item_id = hashlib.md5(fpath.encode()).hexdigest()
        raw_path = os.path.join(self.crawl_raw_dir, f"inbox_{item_id}.json")

        raw_data = {
            "source_name": "Obsidian Web Clipper",
            "source_category": "inbox",
            "title": title,
            "link": "",
            "summary": content[:500],
            "content": content,
            "fetched_at": datetime.now().isoformat(),
        }

        import aiofiles
        async with aiofiles.open(raw_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(raw_data, indent=2, ensure_ascii=False))

        logger.info(f"📥 Inbox → cook queue: {fname}")

        # Trigger cook ngay
        try:
            await self.cook_use_case.cook_files([f"inbox_{item_id}.json"])
        except Exception as e:
            logger.error(f"❌ Cook inbox file thất bại: {e}")
            return

        # Xóa file gốc khỏi inbox sau khi cook xong
        try:
            os.remove(fpath)
        except Exception:
            pass
