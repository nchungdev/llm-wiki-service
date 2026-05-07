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
    def __init__(self, capacity=100):
        super().__init__()
        self.capacity = capacity
        self.buffer: List[Dict] = []

    def emit(self, record):
        self.buffer.append({
            "time": datetime.fromtimestamp(record.created).strftime('%H:%M:%S'),
            "message": record.getMessage(),
            "level": record.levelname,
            "name": record.name
        })
        if len(self.buffer) > self.capacity:
            self.buffer.pop(0)

    def clear(self):
        self.buffer = []

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
mem_handler = MemoryHandler()

def setup_logging(level=logging.INFO):
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(ColoredFormatter())
    
    # Suppression filter for noisy polling endpoints
    suppress_filter = EndpointFilter(["/api/pipeline/status", "/api/raw/list", "/api/pipeline/history"])

    logging.basicConfig(
        level=level,
        handlers=[console_handler, mem_handler],
        force=True # Ensure our config overrides everything
    )
    
    # Apply filter to uvicorn access logs
    logging.getLogger("uvicorn.access").addFilter(suppress_filter)
    
    return logging.getLogger("app")
