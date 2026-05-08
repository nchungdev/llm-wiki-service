import logging
import sys
from datetime import datetime
from typing import List, Dict

class ColoredFormatter(logging.Formatter):
    """Custom formatter to add ANSI colors based on log level"""
    grey = "\x1b[38;20m"
    blue = "\x1b[34;20m"
    yellow = "\x1b[33;20m"
    red = "\x1b[31;20m"
    bold_red = "\x1b[31;1m"
    reset = "\x1b[0m"
    format_str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    FORMATS = {
        logging.DEBUG: grey + format_str + reset,
        logging.INFO: blue + format_str + reset,
        logging.WARNING: yellow + format_str + reset,
        logging.ERROR: red + format_str + reset,
        logging.CRITICAL: bold_red + format_str + reset
    }

    def format(self, record):
        log_fmt = self.FORMATS.get(record.levelno)
        formatter = logging.Formatter(log_fmt, datefmt='%H:%M:%S')
        return formatter.format(record)

class MemoryHandler(logging.Handler):
    """Buffers last N logs for Admin UI polling"""
    _shared_buffer: List[Dict] = []
    
    def __init__(self, capacity=100):
        super().__init__()
        self.capacity = capacity

    @property
    def buffer(self):
        return self._shared_buffer

    def emit(self, record):
        self._shared_buffer.append({
            "time": datetime.fromtimestamp(record.created).strftime('%H:%M:%S'),
            "message": record.getMessage(),
            "level": record.levelname,
            "name": record.name
        })
        if len(self._shared_buffer) > self.capacity:
            self._shared_buffer.pop(0)

    def clear(self):
        self._shared_buffer.clear()

class EndpointFilter(logging.Filter):
    """Filter out noisy health/polling checks from access logs"""
    def __init__(self, paths: List[str]):
        super().__init__()
        self.paths = paths

    def filter(self, record: logging.LogRecord) -> bool:
        # uvicorn.access logs have the request in the message: '127.0.0.1:53241 - "GET /api/... HTTP/1.1" 200 OK'
        msg = record.getMessage()
        return not any(path in msg for path in self.paths)

# Global instances
mem_handler = MemoryHandler(capacity=200)

def setup_logging(level=logging.INFO):
    # 1. Console handler with colors
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(ColoredFormatter())
    
    # 2. Setup root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    
    # Clean existing handlers to avoid duplicates
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
        
    root_logger.addHandler(console_handler)
    root_logger.addHandler(mem_handler)
    
    # 3. Explicitly attach to uvicorn and other libraries
    for name in ["uvicorn", "uvicorn.error", "uvicorn.access", "fastapi", "httpx"]:
        l = logging.getLogger(name)
        l.addHandler(mem_handler)
        l.propagate = True
    
    # 4. Suppress noisy polling logs
    suppress_filter = EndpointFilter(["/api/pipeline/status", "/api/admin/stats", "/api/admin/logs"])
    logging.getLogger("uvicorn.access").addFilter(suppress_filter)
    
    # 4. Return app logger
    app_logger = logging.getLogger("app")
    app_logger.info("📡 Logging system initialized with Memory Buffer (capacity=200)")
    return app_logger
