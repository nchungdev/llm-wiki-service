import os
import re
import asyncio
import logging
from datetime import date

logger = logging.getLogger(__name__)

_FRONTMATTER_RE = re.compile(r'^---\s*\n(.*?)\n---\s*\n', re.DOTALL)

def _get_expires(content: str):
    """Parse expires field from frontmatter. Returns date string or None."""
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return None
    for line in m.group(1).splitlines():
        if line.startswith('expires:'):
            val = line.split(':', 1)[1].strip().strip("'\"")
            return val or None
    return None


class CleanupUseCase:
    """Deletes Feed/ notes whose frontmatter `expires` date has passed."""

    def __init__(self, wiki_dir: str):
        self.feed_dir = os.path.join(wiki_dir, "Feed")

    async def run_once(self):
        if not os.path.exists(self.feed_dir):
            return
        today = date.today()
        deleted = 0
        for root, dirs, files in os.walk(self.feed_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for fname in files:
                if not fname.endswith('.md'):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        content = f.read(512)
                    expires_str = _get_expires(content)
                    if not expires_str:
                        continue
                    expires = date.fromisoformat(expires_str)
                    if expires < today:
                        os.remove(fpath)
                        deleted += 1
                        logger.info(f"🗑️ Expired: {os.path.relpath(fpath, self.feed_dir)}")
                except Exception as e:
                    logger.warning(f"Cleanup skip {fname}: {e}")

        if deleted:
            logger.info(f"✅ Cleanup: removed {deleted} expired notes")

    async def execute(self):
        """Run daily at midnight."""
        while True:
            now = __import__('datetime').datetime.now()
            # Sleep until next midnight
            seconds_until_midnight = (
                86400 - now.hour * 3600 - now.minute * 60 - now.second
            )
            await asyncio.sleep(seconds_until_midnight)
            await self.run_once()
