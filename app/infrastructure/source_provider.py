import json
import os
import logging
from typing import List, Dict
from ..domain.models import Source
import uuid

logger = logging.getLogger(__name__)

# Path to the read-only default config (project root)
_HERE = os.path.dirname(__file__)
_ROOT = os.path.normpath(os.path.join(_HERE, "..", ".."))

def _get_default_sources_path() -> str:
    dev_path = os.path.join(_ROOT, "dev", "default_sources.json")
    if os.path.exists(dev_path):
        return dev_path
    return os.path.join(_ROOT, "default_sources.json")

DEFAULT_SOURCES_FILE = _get_default_sources_path()


def _load_default_sources() -> List[dict]:
    try:
        # Template Fallback
        root_dir = os.path.normpath(os.path.join(_HERE, "..", ".."))
        template_path = os.path.join(root_dir, "templates", "default_sources.json.template")
        
        if not os.path.exists(DEFAULT_SOURCES_FILE) and os.path.exists(template_path):
            logger.info(f"📝 Initializing {DEFAULT_SOURCES_FILE} from template...")
            import shutil
            shutil.copy(template_path, DEFAULT_SOURCES_FILE)

        with open(DEFAULT_SOURCES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning(f"default_sources.json not found at {DEFAULT_SOURCES_FILE}")
        return []
    except Exception as e:
        logger.error(f"Failed to read default_sources.json: {e}")
        return []


class AppSourceProvider:
    def __init__(self, storage_path: str):
        self.user_storage_path = os.path.join(storage_path, "sources.json")
        self.sources: List[Source] = []
        self._load_sources()

    def _load_sources(self):
        if os.path.exists(self.user_storage_path):
            try:
                with open(self.user_storage_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.sources = [Source(**s) for s in data]
                logger.info(f"📂 Loaded {len(self.sources)} sources from user data.")
            except Exception as e:
                logger.error(f"Failed to load user sources: {e}")
                self._bootstrap_from_defaults()
        else:
            # First run: clone defaults into user data so future edits never touch the config file
            self._bootstrap_from_defaults()

    def _bootstrap_from_defaults(self):
        defaults = _load_default_sources()
        self.sources = [
            Source(id=str(uuid.uuid4()), **d) for d in defaults
        ]
        if defaults:
            self.save_sources()
            logger.info(f"✅ Bootstrapped {len(self.sources)} sources from default_sources.json → saved to user data.")
        else:
            logger.warning("No default sources loaded — starting with empty list.")

    def save_sources(self):
        try:
            with open(self.user_storage_path, "w", encoding="utf-8") as f:
                json.dump([s.model_dump() for s in self.sources], f, indent=4, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to save sources: {e}")

    def get_all_sources(self) -> List[Source]:
        return self.sources

    def add_source(self, source: Source):
        if not source.id:
            source.id = str(uuid.uuid4())
        self.sources.append(source)
        self.save_sources()

    def update_source(self, source_id: str, updated_data: Dict):
        for s in self.sources:
            if s.id == source_id:
                for k, v in updated_data.items():
                    if hasattr(s, k):
                        setattr(s, k, v)
                self.save_sources()
                return True
        return False

    def delete_source(self, source_id: str):
        self.sources = [s for s in self.sources if s.id != source_id]
        self.save_sources()

    def reset_to_defaults(self):
        """Delete user data and re-bootstrap from default_sources.json."""
        if os.path.exists(self.user_storage_path):
            os.remove(self.user_storage_path)
        self._bootstrap_from_defaults()
        logger.info("🔄 Sources reset to defaults.")

    def get_active_feeds(self) -> List[str]:
        return [s.url for s in self.sources if s.active and s.type == "rss"]
