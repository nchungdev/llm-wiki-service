import os
import json
import asyncio
import logging
from dotenv import load_dotenv

# Load environment variables early
load_dotenv()

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

# Core & Infrastructure
from app.core.logging import setup_logging, mem_handler
from app.core.container import container
from app.core.config import AppConfig, save_config

# Use Cases
from app.domain.use_cases.wiki_use_cases import ListWikiPagesUseCase, GetWikiPageUseCase, SaveWikiPageUseCase, ReindexWikiUseCase, DeleteWikiPageUseCase, PromoteWikiPageUseCase
from app.domain.use_cases.chat_use_cases import ChatWithAIUseCase, GetAvailableModelsUseCase
from app.domain.use_cases.crawl import RunDailyCrawlUseCase
from app.domain.use_cases.cook import RunCookUseCase
from app.domain.use_cases.discovery_use_cases import GetDiscoveryUseCase, RunHourlyResearchUseCase
from app.domain.use_cases.storage_use_cases import CleanupStorageUseCase
from app.domain.use_cases.watcher_use_cases import WatchRawFilesUseCase, InboxWatcherUseCase
from app.domain.use_cases.manual_trigger_use_case import ManualTriggerCrawlUseCase
from app.domain.use_cases.pipeline_use_cases import WebToWikiPipeline
from app.domain.use_cases.ebook_use_cases import ProcessEbookUseCase
from app.domain.use_cases.cleanup_use_cases import CleanupUseCase
from app.domain.use_cases.vault_audit_use_cases import VaultAuditUseCase, VaultCleanupUseCase

# Presentation
from app.presentation.api.routes import create_router

# 1. Setup Logging
logger = setup_logging()

# 2. Extract Container Objects for ease of use
cfg = container.config
ai = container.ai_provider
rag = container.rag_service
sources = container.source_provider
wiki = container.wiki_repo
chat = container.chat_repo

# 3. Instantiate Use Cases
list_wiki = ListWikiPagesUseCase(wiki)
get_wiki = GetWikiPageUseCase(wiki)
save_wiki = SaveWikiPageUseCase(wiki)
reindex_wiki = ReindexWikiUseCase(wiki, rag)
delete_wiki = DeleteWikiPageUseCase(wiki, rag)
promote_wiki = PromoteWikiPageUseCase(wiki, rag)

chat_ai = ChatWithAIUseCase(chat, rag, system_dir=cfg.storage.system_dir)
get_models = GetAvailableModelsUseCase(chat)
get_discovery = GetDiscoveryUseCase(sources)

# Paths from config
RAW_DIR = os.path.join(cfg.storage.system_dir, "raw")
SCREENSHOTS_DIR = os.path.join(cfg.storage.system_dir, "screenshots")

HISTORY_FILE = os.path.join(cfg.storage.system_dir, "pipeline_history.json")

def save_pipeline_history(entry):
    try:
        history = []
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, 'r') as f:
                history = json.load(f)
        history.insert(0, entry)  # Newest first
        history = history[:50]    # Keep last 50
        with open(HISTORY_FILE, 'w') as f:
            json.dump(history, f, indent=4)
    except Exception as e:
        logger.error(f"Failed to save pipeline history: {e}")

run_daily_crawl = RunDailyCrawlUseCase(
    RAW_DIR, sources, 
    max_concurrent=cfg.pipeline.max_concurrent,
    on_finish=save_pipeline_history,
    youtube_api_key=cfg.youtube_api_key
)
run_cook = RunCookUseCase(RAW_DIR, wiki, ai, rag)
run_hourly = RunHourlyResearchUseCase(wiki, ai, sources)
manual_sync = ManualTriggerCrawlUseCase(run_daily_crawl, run_hourly)

cleanup_storage = CleanupStorageUseCase(SCREENSHOTS_DIR)
cleanup_feed = CleanupUseCase(cfg.storage.vault_dir)
vault_audit = VaultAuditUseCase(cfg.storage.vault_dir)
vault_cleanup = VaultCleanupUseCase(cfg.storage.vault_dir, ai_provider=ai)
watch_raw = WatchRawFilesUseCase(RAW_DIR, run_cook)
inbox_dirs = [os.path.join(RAW_DIR, "inbox"), os.path.join(cfg.storage.vault_dir, "Clippings")]
watch_inbox = InboxWatcherUseCase(inbox_dirs, run_cook, crawl_raw_dir=os.path.join(RAW_DIR, "crawl"))

# Tunnel Manager for Remote Access
from app.infrastructure.tunnel_manager import TunnelManager
tunnel_manager = TunnelManager(cfg.server.port)

# 4. Lifespan Management
from contextlib import asynccontextmanager
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Essential startup (Non-AI tasks)
    asyncio.create_task(cleanup_storage.execute())
    asyncio.create_task(cleanup_feed.execute())
    
    # AI-Heavy tasks: Only if auto_start is enabled
    if cfg.pipeline.auto_start:
        logger.info("⚡ Auto-start enabled: Initializing RAG and Watchers...")
        asyncio.create_task(reindex_wiki.execute())
        if cfg.pipeline.auto_cook:
            asyncio.create_task(watch_raw.execute())
            asyncio.create_task(watch_inbox.execute())
            logger.info("🍳 Auto-cook ON: raw files will be cooked automatically.")
        else:
            logger.info("⏸️ Auto-cook OFF: raw files will queue in Raw Inbox for manual cooking.")
    else:
        logger.info("⏸️ Auto-start disabled: AI tasks (RAG, Indexing, Cooking) waiting for manual trigger.")

    # Scheduled crawl
    if cfg.pipeline.crawl_enabled:
        logger.info(f"📅 Scheduled crawl enabled at {cfg.pipeline.crawl_time} daily.")
        asyncio.create_task(run_daily_crawl.execute(cfg.pipeline.crawl_time))
    else:
        logger.info("📅 Scheduled crawl disabled.")
    
    # Remote Access Tunnel
    if cfg.server.remote_access:
        asyncio.create_task(tunnel_manager.start())
    
    logger.info("🚀 AI Librarian Backend Ready.")
    yield
    # Cleanup
    await tunnel_manager.stop()
    logger.info("🛑 Shutting down...")

# 5. FastAPI App
app = FastAPI(title="AI Librarian", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# 6. Routes
api_router = create_router(
    list_wiki, get_wiki, save_wiki, chat_ai, get_models,
    get_discovery, manual_sync, WebToWikiPipeline(wiki, ai),
    delete_wiki, promote_wiki, sources, run_daily_crawl, 
    run_cook, ProcessEbookUseCase(wiki, ai, rag),
    history_file=HISTORY_FILE,
    vault_audit_use_case=vault_audit,
    vault_cleanup_use_case=vault_cleanup,
)

# Extension Endpoints
@api_router.get("/setup/info")
async def get_info():
    info = container.config.dict(exclude={"gemini_api_key", "youtube_api_key"})
    # Add active status from provider
    if container.ai_provider:
        info["ai"]["active_provider"] = container.ai_provider.provider_type
        info["ai"]["is_fallback"] = getattr(container.ai_provider, 'is_fallback', False)
    return info

@api_router.post("/config")
async def update_config(new_cfg: AppConfig):
    container.reload(new_cfg)
    # Persist via centralized helper
    from app.core.config import save_config
    save_config(new_cfg)
    return {"status": "success"}

@api_router.get("/admin/stats")
async def get_stats():
    import psutil
    from pathlib import Path
    
    # Use cached list from repository instead of re-scanning disk
    pages = await list_wiki.execute()
    wiki_count = len(pages)
    total_size = sum(p.get('size', 0) for p in pages) / (1024 * 1024) # MB
    
    # Raw count (only one level, relatively fast)
    raw_path = os.path.join(RAW_DIR, "crawl")
    raw_count = len([f for f in os.listdir(raw_path) if f.endswith('.json')]) if os.path.exists(raw_path) else 0
    
    # System info
    cpu = psutil.cpu_percent()
    ram = psutil.virtual_memory().percent
    disk = psutil.disk_usage(cfg.storage.system_dir).percent
    
    return {
        "wiki_count": wiki_count,
        "raw_count": raw_count,
        "storage_size_mb": round(total_size, 1),
        "ai_chef": run_cook.status,
        "ai_researcher": run_hourly.status,
        "tunnel": tunnel_manager.status,
        "system": {
            "cpu": cpu,
            "ram": ram,
            "disk": disk
        }
    }

@api_router.get("/admin/tunnel")
async def get_tunnel_status():
    return tunnel_manager.status

@api_router.post("/config/gcp-key")
async def import_gcp_key(payload: dict):
    json_content = payload.get("json_content")
    if not json_content:
        raise HTTPException(status_code=400, detail="Missing JSON content")
    
    try:
        # Validate JSON
        data = json.loads(json_content)
        if "project_id" not in data:
            raise ValueError("Invalid Service Account JSON: Missing project_id")
        
        # Save to SYSTEM_DIR/gcp_key.json
        key_path = os.path.join(cfg.storage.system_dir, "gcp_key.json")
        os.makedirs(os.path.dirname(key_path), exist_ok=True)
        with open(key_path, 'w') as f:
            f.write(json_content)
        
        # Update current config to point here
        cfg.gcp_project_id = data.get("project_id")
        cfg.gcp_key_file = key_path
        save_config(cfg)
        
        # Reload container to apply new key
        container.reload(cfg)
        
        return {"status": "success", "project_id": cfg.gcp_project_id}
    except Exception as e:
        logger.error(f"Failed to import GCP key: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@api_router.get("/config/gcp-key/status")
async def get_gcp_key_status():
    key_path = os.path.join(cfg.storage.system_dir, "gcp_key.json")
    if os.path.exists(key_path):
        try:
            with open(key_path, 'r') as f:
                data = json.load(f)
            return {
                "configured": True, 
                "project_id": data.get("project_id"),
                "client_email": data.get("client_email")
            }
        except:
            pass
    return {"configured": False}

app.include_router(api_router, prefix="/api")

# Static UI
if os.path.exists("static"):
    app.mount("/", StaticFiles(directory="static", html=True), name="static")

@app.get("/")
async def index():
    return FileResponse("static/index.html") if os.path.exists("static/index.html") else {"error": "UI Not Built"}

if __name__ == "__main__":
    import uvicorn
    # Nodemon handles reload now, so we run uvicorn simply
    uvicorn.run(
        "main:app", 
        host="0.0.0.0", 
        port=cfg.server.port, 
        reload=False
    )
