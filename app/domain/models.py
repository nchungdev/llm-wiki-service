from pydantic import BaseModel
from typing import List, Optional

class PageMetadata(BaseModel):
    filename: str
    title: str
    source: Optional[str] = "General"
    category: Optional[str] = "Uncategorized"

class Page(BaseModel):
    title: str
    content: str
    source: Optional[str] = None
    category: Optional[str] = None

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[dict]] = []
    agent_type: Optional[str] = "general"
    provider: Optional[str] = None
    model: Optional[str] = None
    search_in: Optional[str] = "all"  # all, wiki, web

class ChatResponse(BaseModel):
    response: str
    sources: List[dict] = []

class ResearchHistoryItem(BaseModel):
    id: str
    query: str
    response: str
    sources: List[dict] = []
    timestamp: str
    mode: str # 'local' or 'deep'

class ConfigRequest(BaseModel):
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    retention_hours: Optional[int] = None

class DiscoveryItem(BaseModel):
    title: str
    site: str
    url: Optional[str] = None
    tag: Optional[str] = None

class Source(BaseModel):
    id: Optional[str] = None
    name: str
    url: str
    category: str
    type: str = "rss"  # rss, url
    active: bool = True

class PipelineHistory(BaseModel):
    id: str
    start_time: str
    end_time: Optional[str] = None
    status: str  # running, success, failed
    sources_processed: int = 0
    items_found: int = 0
    errors: List[str] = []
