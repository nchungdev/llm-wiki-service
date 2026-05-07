import os
import time
import asyncio
import logging

logger = logging.getLogger(__name__)

class CleanupStorageUseCase:
    def __init__(self, screenshots_dir: str, raw_dir: str = None, wiki_dir: str = None):
        self.screenshots_dir = screenshots_dir
        self.raw_dir = raw_dir
        self.wiki_dir = wiki_dir

    async def execute(self):
        logger.info(f"🧹 Cleanup worker started (Screenshots 24h, Raw Cooked 7d, ILM 7d)")
        while True:
            try:
                now = time.time()
                
                def _cleanup_all():
                    removed_count = 0
                    
                    # 1. Cleanup Screenshots (24h)
                    if self.screenshots_dir and os.path.exists(self.screenshots_dir):
                        for f in os.listdir(self.screenshots_dir):
                            path = os.path.join(self.screenshots_dir, f)
                            if os.path.isfile(path) and (now - os.path.getmtime(path)) > (24 * 3600):
                                os.remove(path)
                                removed_count += 1
                    
                    # 2. Cleanup Raw Cooked (7 days)
                    if self.raw_dir:
                        cooked_dir = os.path.join(self.raw_dir, "cooked")
                        if os.path.exists(cooked_dir):
                            for f in os.listdir(cooked_dir):
                                path = os.path.join(cooked_dir, f)
                                if os.path.isfile(path) and (now - os.path.getmtime(path)) > (7 * 24 * 3600):
                                    os.remove(path)
                                    removed_count += 1
                                    
                    # 3. Cleanup Wiki ILM (Temporary pages > 7 days)
                    if self.wiki_dir:
                        import json
                        for f in os.listdir(self.wiki_dir):
                            if f.endswith(".md"):
                                meta_path = os.path.join(self.wiki_dir, f.replace(".md", ".json"))
                                if os.path.exists(meta_path):
                                    try:
                                        with open(meta_path, "r") as mf:
                                            meta = json.load(mf)
                                        if meta.get("category") == "Temporary":
                                            file_path = os.path.join(self.wiki_dir, f)
                                            # If older than 7 days
                                            if (now - os.path.getmtime(file_path)) > (7 * 24 * 3600):
                                                os.remove(file_path)
                                                if os.path.exists(meta_path):
                                                    os.remove(meta_path)
                                                removed_count += 1
                                    except: pass
                    
                    return removed_count

                count = await asyncio.to_thread(_cleanup_all)
                if count > 0:
                    logger.info(f"🧹 Storage Maintenance: Removed {count} expired items.")
            except Exception as e:
                logger.error(f"❌ Cleanup error: {e}")
            
            await asyncio.sleep(3600) # Run every hour
