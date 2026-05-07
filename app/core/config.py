import os
import json
import logging
from pydantic import BaseModel, Field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

class StorageConfig(BaseModel):
    vault_dir: str = Field(default_factory=lambda: str(Path.home() / "Documents" / "SecondBrain"))
    system_dir: str = Field(default_factory=lambda: str(Path.home() / "Library" / "Application Support" / "LLMWiki"))

class AIConfig(BaseModel):
    provider: str = "ollama"
    model: str = ""          # empty = auto-discover on first call
    embed_model: str = ""    # empty = auto-discover on first call
    max_rpm: int = 15
    max_tpm: int = 30000

class PipelineConfig(BaseModel):
    max_concurrent: int = 3
    cook_interval_sec: int = 300
    auto_start: bool = False
    auto_cook: bool = True       # cook automatically when raw files arrive
    crawl_enabled: bool = False  # run scheduled crawl daily
    crawl_time: str = "06:00"    # HH:MM local time for daily crawl

class ServerConfig(BaseModel):
    port: int = 3030
    remote_access: bool = False

class AppConfig(BaseModel):
    storage: StorageConfig = Field(default_factory=StorageConfig)
    ai: AIConfig = Field(default_factory=AIConfig)
    pipeline: PipelineConfig = Field(default_factory=PipelineConfig)
    server: ServerConfig = Field(default_factory=ServerConfig)
    
    # Secure keys / System paths (Not persisted in config.json directly by default)
    gemini_api_key: Optional[str] = None
    youtube_api_key: Optional[str] = None
    tavily_api_key: Optional[str] = None
    gcp_project_id: Optional[str] = None
    gcp_location: str = "us-central1"
    gcp_key_file: Optional[str] = None

def get_config_path() -> str:
    """Resolve the configuration file path based on environment."""
    # 1. Environment Variable Override
    if os.getenv("LLM_WIKI_CONFIG"):
        return os.getenv("LLM_WIKI_CONFIG")
    
    # 2. Local Dev (Check dev/ folder first, then root)
    dev_path = os.path.join("dev", "config.json")
    if os.path.exists(dev_path):
        return dev_path
    
    local_path = "config.json"
    if os.path.exists(local_path):
        return local_path
        
    # 3. System Data Directory (Standard for Apps/DMG)
    system_data_dir = str(Path.home() / "Library" / "Application Support" / "LLMWiki")
    os.makedirs(system_data_dir, exist_ok=True)
    return os.path.join(system_data_dir, "config.json")

CONFIG_FILE = get_config_path()

def sanitize_path(path_str: str) -> str:
    """Migrate hardcoded /Users/xxx paths to current user if they don't exist."""
    if not path_str or not path_str.startswith("/Users/"):
        return path_str
    
    parts = path_str.split("/")
    if len(parts) < 3: return path_str
    
    current_home = str(Path.home())
    # If original path doesn't exist, try to replace /Users/old_user with current_home
    if not os.path.exists(path_str):
        # parts[0] is '', parts[1] is 'Users', parts[2] is the old username
        new_path = os.path.join(current_home, *parts[3:])
        if os.path.exists(os.path.dirname(new_path)) or "/Library/Application Support/" in path_str:
            logger.info(f"🔄 Migrated path: {path_str} -> {new_path}")
            return new_path
            
    return path_str

def load_config() -> AppConfig:
    """Load configuration strictly from JSON with template fallback."""
    # 1. Template Fallback
    template_path = os.path.join("templates", "config.json.template")
    if not os.path.exists(CONFIG_FILE) and os.path.exists(template_path):
        logger.info(f"📝 Initializing {CONFIG_FILE} from template...")
        import shutil
        shutil.copy(template_path, CONFIG_FILE)

    config = AppConfig()
    
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                data = json.load(f)
                
                # Sanitize storage paths before validation
                if "storage" in data:
                    data["storage"]["vault_dir"] = sanitize_path(data["storage"].get("vault_dir", ""))
                    data["storage"]["system_dir"] = sanitize_path(data["storage"].get("system_dir", ""))
                
                # Strict loading using Pydantic validation
                config = AppConfig(**data)
        except Exception as e:
            logger.error(f"Failed to parse {CONFIG_FILE}. Using defaults. Error: {e}")

    # Environment variables overrides (for Docker/Dev ease)
    if os.getenv("GEMINI_API_KEY"): config.gemini_api_key = os.getenv("GEMINI_API_KEY")
    if os.getenv("YOUTUBE_API_KEY"): config.youtube_api_key = os.getenv("YOUTUBE_API_KEY")
    if os.getenv("TAVILY_API_KEY"): config.tavily_api_key = os.getenv("TAVILY_API_KEY")
    
    # Critical: Ensure system directories exist immediately
    try:
        for p in [config.storage.system_dir, config.storage.vault_dir]:
            if p and "/path/to/your" not in p:
                os.makedirs(p, exist_ok=True)
    except Exception as e:
        logger.warning(f"⚠️ Could not create directories: {e}")
    
    return config

def save_config(config: AppConfig):
    """Persist current configuration to disk."""
    try:
        # We exclude API keys from the general config file for security
        data = config.dict(exclude={"gemini_api_key", "youtube_api_key", "tavily_api_key"})
        with open(CONFIG_FILE, 'w') as f:
            json.dump(data, f, indent=4)
        logger.info(f"💾 Configuration persisted to {CONFIG_FILE}")
    except Exception as e:
        logger.error(f"Failed to save configuration to {CONFIG_FILE}: {e}")
