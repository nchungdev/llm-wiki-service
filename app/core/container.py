import os
import json
import logging
from typing import Optional
import keyring

from .config import load_config, save_config, AppConfig
from ..infrastructure.ai_provider import AIProvider
from ..infrastructure.rag_provider import RAGService
from ..infrastructure.source_provider import AppSourceProvider
from ..infrastructure.search_provider import WebSearchProvider
from ..infrastructure.parsers.web_scraper import UrlScraper
from ..infrastructure.repositories.file_wiki_repository import FileWikiRepository
from ..infrastructure.repositories.gemini_chat_repository import GeminiChatRepository

logger = logging.getLogger(__name__)

class Container:
    """
    Dependency Injection Container.
    Handles initialization and lifecycle of core services and repositories.
    """
    def __init__(self):
        self.config: AppConfig = load_config()
        self.ai_provider: Optional[AIProvider] = None
        self.rag_service: Optional[RAGService] = None
        self.search_provider: Optional[WebSearchProvider] = None
        self.url_scraper: Optional[UrlScraper] = None
        self.source_provider: Optional[AppSourceProvider] = None
        self.wiki_repo: Optional[FileWikiRepository] = None
        self.chat_repo: Optional[GeminiChatRepository] = None
        
        self._init_services()

    def _get_secure_gemini_key(self) -> Optional[str]:
        """Strictly retrieval from config or OS Keychain."""
        if self.config.gemini_api_key:
            return self.config.gemini_api_key
        try:
            val = keyring.get_password("llm-wiki", "GEMINI_API_KEY")
            if val:
                logger.info("🔐 Loaded Gemini API Key from Secure Storage")
                return val.strip()
        except Exception as e:
            logger.debug(f"Keyring access skipped or failed: {e}")
        return None

    def _init_services(self):
        """Standardized initialization of infrastructure layers."""
        conf = self.config
        
        # 1. Credentials
        gemini_key = self._get_secure_gemini_key()
        gcp_key_path = conf.gcp_key_file or os.path.join(conf.storage.system_dir, "gcp_key.json")
        if not os.path.exists(gcp_key_path):
            gcp_key_path = None

        # 2. Providers
        self.ai_provider = AIProvider(
            api_key=gemini_key,
            provider_type=conf.ai.provider,
            model_name=conf.ai.model,
            max_rpm=conf.ai.max_rpm,
            max_tpm=conf.ai.max_tpm,
            gcp_project=conf.gcp_project_id,
            gcp_location=conf.gcp_location,
            gcp_key_file=gcp_key_path
        )

        self.search_provider = WebSearchProvider(api_key=conf.tavily_api_key)
        self.url_scraper = UrlScraper()

        chroma_path = os.path.join(conf.storage.system_dir, "chroma_db")
        self.rag_service = RAGService(
            chroma_path,
            api_key=gemini_key,
            provider_type=conf.ai.provider,
            model_name=conf.ai.embed_model,
            gcp_project=conf.gcp_project_id,
            gcp_location=conf.gcp_location,
            gcp_key_file=gcp_key_path
        )

        # 3. Repositories
        self.source_provider = AppSourceProvider(conf.storage.system_dir)
        self.wiki_repo = FileWikiRepository(conf.storage.vault_dir)
        self.chat_repo = GeminiChatRepository(self.ai_provider, self.rag_service)

    def reload(self, new_config: Optional[AppConfig] = None):
        """Force re-initialization with new configuration."""
        if new_config:
            self.config = new_config
        self._init_services()
        logger.info("🔄 Container re-initialized with new configuration")

# Global singleton
container = Container()
