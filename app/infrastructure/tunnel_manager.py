import asyncio
import logging
import subprocess
import os
import platform
import re

logger = logging.getLogger(__name__)

class TunnelManager:
    def __init__(self, port: int):
        self.port = port
        self.process = None
        self.url = None
        self._running = False

    async def start(self):
        if self._running: return
        
        logger.info(f"🌐 Starting Cloudflare Tunnel for port {self.port}...")
        try:
            # Try to use cloudflared if installed
            cmd = ["cloudflared", "tunnel", "--url", f"http://localhost:{self.port}"]
            
            # Use subprocess to catch the URL from stdout/stderr
            self.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            self._running = True
            
            # Start a background task to capture the URL
            asyncio.create_task(self._capture_url())
            
        except FileNotFoundError:
            logger.error("❌ cloudflared not found in PATH. Please install it to use remote access.")
        except Exception as e:
            logger.error(f"❌ Failed to start tunnel: {e}")

    async def _capture_url(self):
        """Monitor stderr to find the assigned trycloudflare.com URL"""
        while self._running and self.process:
            line = await self.process.stderr.readline()
            if not line: break
            
            decoded = line.decode().strip()
            # Look for: https://xxx.trycloudflare.com
            match = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', decoded)
            if match:
                self.url = match.group(0)
                logger.info(f"✅ REMOTE ACCESS READY: {self.url}")
                # We can stop capturing or keep reading logs
                
    async def stop(self):
        if self.process:
            logger.info("🛑 Stopping tunnel...")
            self.process.terminate()
            await self.process.wait()
            self.process = None
            self.url = None
            self._running = False

    @property
    def status(self):
        return {
            "running": self._running,
            "url": self.url
        }
