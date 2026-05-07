import asyncio
import time
import logging
from collections import deque

logger = logging.getLogger(__name__)

class AsyncRateLimiter:
    """
    A robust async rate limiter for Requests and Tokens.
    Ensures compliance with Cloud AI quotas (RPM/TPM).
    """
    def __init__(self, max_requests_per_minute: int = 15, max_tokens_per_minute: int = 30000):
        self.max_rpm = max_requests_per_minute
        self.max_tpm = max_tokens_per_minute
        
        # Deque of timestamps for requests and (timestamp, tokens) for tokens
        self.requests = deque()
        self.tokens = deque()
        
        self.lock = asyncio.Lock()

    async def wait_for_slot(self, estimated_tokens: int = 1000):
        """Pauses execution until both RPM and TPM limits are satisfied."""
        async with self.lock:
            while True:
                now = time.time()
                
                # 1. Clean up old records (> 60s)
                while self.requests and now - self.requests[0] > 60:
                    self.requests.popleft()
                while self.tokens and now - self.tokens[0][0] > 60:
                    self.tokens.popleft()
                
                # 2. Check RPM
                if len(self.requests) >= self.max_rpm:
                    wait_time = 60 - (now - self.requests[0]) + 0.1
                    logger.debug(f"⏳ RPM Limit reached. Waiting {wait_time:.1f}s...")
                    await asyncio.sleep(wait_time)
                    continue
                
                # 3. Check TPM
                current_tpm = sum(t[1] for t in self.tokens)
                if current_tpm + estimated_tokens > self.max_tpm:
                    wait_time = 60 - (now - self.tokens[0][0]) + 0.1
                    logger.debug(f"⏳ TPM Limit reached ({current_tpm}/{self.max_tpm}). Waiting {wait_time:.1f}s...")
                    await asyncio.sleep(wait_time)
                    continue
                
                # 4. Slots available!
                break

    async def record_usage(self, token_count: int):
        """Records a successful request and its token consumption."""
        async with self.lock:
            now = time.time()
            self.requests.append(now)
            self.tokens.append((now, token_count))
            
            current_tpm = sum(t[1] for t in self.tokens)
            logger.debug(f"📊 Usage Recorded: RPM={len(self.requests)}, TPM={current_tpm}")
