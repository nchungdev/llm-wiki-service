import logging
import asyncio
import time
from .discovery_use_cases import RunDailyCrawlUseCase, RunHourlyResearchUseCase

logger = logging.getLogger(__name__)

class ManualTriggerCrawlUseCase:
    def __init__(self, daily_crawl_use_case: RunDailyCrawlUseCase, hourly_research_use_case: RunHourlyResearchUseCase):
        self.daily_crawl = daily_crawl_use_case
        self.hourly_research = hourly_research_use_case
        self._lock = asyncio.Lock()
        self._last_manual_crawl = 0
        self._cooldown = 10  # Reduced cooldown for better UX with progress tracking

    async def execute(self, source_id: str = None):
        now = time.time()
        if now - self._last_manual_crawl < self._cooldown:
            return {"status": "cooldown", "message": "Vui lòng đợi giây lát."}

        if self._lock.locked() or self.daily_crawl.status["running"]:
            return {"status": "busy", "message": "Hệ thống đang bận xử lý dữ liệu."}

        async with self._lock:
            self._last_manual_crawl = now
            logger.info(f"🚀 [MANUAL TRIGGER] Starting crawl (source_id={source_id})...")
            
            # Use task to not block the response
            asyncio.create_task(self.daily_crawl.run_once(source_id=source_id))
            if not source_id: # Only run research if full sync
                asyncio.create_task(self.hourly_research.run_once())
            
            return {"status": "success", "message": "Quá trình đồng bộ đã bắt đầu."}

    def get_status(self):
        return self.daily_crawl.status
