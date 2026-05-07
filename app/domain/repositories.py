from abc import ABC, abstractmethod
from typing import List, Optional
from .models import PageMetadata, Page

class IWikiRepository(ABC):
    @abstractmethod
    async def list_pages(self) -> List[dict]:
        pass

    @abstractmethod
    async def get_page(self, filename: str) -> dict:
        pass

    @abstractmethod
    async def save_page(self, title: str, content: str, metadata: dict = None) -> str:
        pass

class IChatRepository(ABC):
    @abstractmethod
    async def generate_response(self, prompt: str, context: str) -> str:
        pass

    @abstractmethod
    async def get_available_models(self) -> List[dict]:
        pass
