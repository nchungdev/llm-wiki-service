from fastapi import APIRouter, HTTPException, UploadFile, File, Request
from pydantic import BaseModel
from typing import List, Optional
import logging
import platform
import json
import os
from datetime import datetime

from ...domain.models import ChatRequest, ChatResponse, Page, Source
from ...domain.use_cases.wiki_use_cases import ListWikiPagesUseCase, GetWikiPageUseCase, SaveWikiPageUseCase, DeleteWikiPageUseCase, PromoteWikiPageUseCase
from ...domain.use_cases.chat_use_cases import ChatWithAIUseCase, GetAvailableModelsUseCase
from ...domain.use_cases.discovery_use_cases import GetDiscoveryUseCase, RunDailyCrawlUseCase, RunCookUseCase
from ...domain.use_cases.manual_trigger_use_case import ManualTriggerCrawlUseCase
from ...domain.use_cases.pipeline_use_cases import WebToWikiPipeline

logger = logging.getLogger(__name__)

class PipelineRequest(BaseModel):
    urls: list[str]

class EbookRequest(BaseModel):
    file_path: str
    title: str
    author: str = ""
    language: str = "vi"
    tags: List[str] = []

def create_router(
    list_wiki_use_case: ListWikiPagesUseCase,
    get_wiki_use_case: GetWikiPageUseCase,
    save_wiki_use_case: SaveWikiPageUseCase,
    chat_use_case: ChatWithAIUseCase,
    get_models_use_case: GetAvailableModelsUseCase,
    get_discovery_use_case: GetDiscoveryUseCase,
    manual_trigger_use_case: ManualTriggerCrawlUseCase,
    pipeline_use_case: WebToWikiPipeline,
    delete_wiki_use_case: DeleteWikiPageUseCase,
    promote_wiki_use_case: PromoteWikiPageUseCase,
    source_provider,
    run_daily_crawl_use_case: RunDailyCrawlUseCase,
    run_cook_use_case: RunCookUseCase,
    process_ebook_use_case=None,
    history_file: str = None,
    vault_audit_use_case=None,
    vault_cleanup_use_case=None,
):
    router = APIRouter()

    # --- Wiki Library ---
    @router.get("/pages")
    async def list_pages():
        return {"pages": await list_wiki_use_case.execute()}

    @router.get("/pages/{filename}")
    async def get_page(filename: str):
        try:
            return await get_wiki_use_case.execute(filename)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Page not found")

    @router.post("/pages")
    async def save_page(page: Page):
        filename = await save_wiki_use_case.execute(page.title, page.content)
        return {"status": "success", "filename": filename}

    @router.delete("/pages/{filename}")
    async def delete_page(filename: str):
        try:
            await delete_wiki_use_case.execute(filename)
            return {"status": "success"}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Page not found")

    @router.post("/pages/{filename}/promote")
    async def promote_page(filename: str):
        return await promote_wiki_use_case.execute(filename)

    # --- Source Management ---
    @router.get("/sources")
    async def list_sources():
        return source_provider.get_all_sources()

    @router.post("/sources")
    async def add_source(source: Source):
        source_provider.add_source(source)
        return {"status": "success"}

    @router.patch("/sources/{source_id}")
    async def update_source(source_id: str, payload: dict):
        if source_provider.update_source(source_id, payload):
            return {"status": "success"}
        raise HTTPException(status_code=404, detail="Source not found")

    @router.delete("/sources/{source_id}")
    async def delete_source(source_id: str):
        source_provider.delete_source(source_id)
        return {"status": "success"}

    @router.post("/sources/reset")
    async def reset_sources():
        source_provider.reset_to_defaults()
        return {"status": "success"}

    # --- Pipeline & Sync ---
    @router.get("/pipeline/status")
    async def get_pipeline_status():
        return {
            "crawl": run_daily_crawl_use_case.status,
            "cook": run_cook_use_case.status
        }

    @router.post("/pipeline/run")
    async def trigger_sync(payload: Optional[dict] = None):
        source_id = payload.get("source_id") if payload else None
        return await manual_trigger_use_case.execute(source_id=source_id)
    
    @router.post("/pipeline/reindex")
    async def trigger_reindex():
        from app.domain.use_cases.wiki_use_cases import ReindexWikiUseCase
        from app.core.container import container
        use_case = ReindexWikiUseCase(container.wiki_repo, container.rag_service)
        # Run in background to not block API
        import asyncio
        asyncio.create_task(use_case.execute())
        return {"status": "success", "message": "Re-indexing started in background"}

    @router.get("/pipeline/history")
    async def get_pipeline_history():
        if not history_file or not os.path.exists(history_file):
            return []
        try:
            with open(history_file, 'r') as f:
                return json.load(f)
        except:
            return []

    # --- Data Management (Raw Inbox) ---
    @router.get("/raw/list")
    async def list_raw():
        return await run_cook_use_case.list_raw_files()

    @router.post("/raw/cook")
    async def cook_raw(payload: dict):
        filenames = payload.get("filenames", [])
        return await run_cook_use_case.cook_files(filenames)

    # --- Search & Discovery ---
    @router.get("/discovery")
    async def get_discovery_api():
        return await get_discovery_use_case.execute()

    @router.get("/admin/sources/search")
    async def search_discovery(q: str, type: str = "youtube"):
        if not q: return {"results": []}
        
        results = []
        try:
            import httpx
            import urllib.parse
            q_encoded = urllib.parse.quote(q)
            async with httpx.AsyncClient(timeout=10.0) as client:
                if type == "youtube":
                    from app.core.container import container
                    yt_key = container.config.youtube_api_key or os.getenv("YOUTUBE_API_KEY")
                    if yt_key:
                        api_url = f"https://www.googleapis.com/youtube/v3/search?part=snippet&q={q_encoded}&type=channel&maxResults=5&key={yt_key}"
                        resp = await client.get(api_url)
                        data = resp.json()
                        for item in data.get('items', []):
                            results.append({
                                "id": item['snippet']['channelId'],
                                "title": item['snippet']['title'],
                                "desc": item['snippet']['description'],
                                "thumb": item['snippet']['thumbnails']['default']['url'],
                                "type": "youtube"
                            })
                elif type == "wikipedia":
                    api_url = f"https://vi.wikipedia.org/w/api.php?action=opensearch&search={q_encoded}&limit=5&namespace=0&format=json"
                    resp = await client.get(api_url)
                    data = resp.json()
                    if len(data) >= 4:
                        for i in range(len(data[1])):
                            results.append({
                                "id": data[1][i],
                                "title": data[1][i],
                                "desc": data[2][i],
                                "url": data[3][i],
                                "type": "wikipedia"
                            })
            return {"results": results}
        except Exception as e:
            logger.error(f"Search error: {e}")
            return {"results": [], "error": str(e)}

    @router.post("/admin/sources/inspect")
    async def inspect_source(payload: dict):
        url = payload.get("url", "").strip()
        if not url: raise HTTPException(status_code=400, detail="URL is required")
        
        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
        try:
            import httpx, feedparser
            from bs4 import BeautifulSoup
            
            if "youtube.com" in url or "youtu.be" in url or url.startswith("@"):
                async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=10.0) as client:
                    resp = await client.get(url if url.startswith("http") else f"https://youtube.com/{url}")
                    soup = BeautifulSoup(resp.text, 'lxml')
                    link_tag = soup.find('link', rel='canonical')
                    channel_id = link_tag['href'].split('channel/')[1].split('/')[0] if link_tag and 'channel/' in link_tag['href'] else None
                    name = soup.find('meta', property='og:title')['content'] if soup.find('meta', property='og:title') else "YouTube Channel"
                    if channel_id:
                        return {"name": name, "url": channel_id, "type": "youtube", "category": "Subscription"}
            
            async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=10.0) as client:
                resp = await client.get(url)
                d = feedparser.parse(resp.text)
                if d.entries or d.feed:
                    return {"name": d.feed.get('title', 'RSS Source'), "url": url, "type": "rss", "category": "Tech"}
            
            return {"status": "error", "message": "Metadata not found"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # --- System Admin ---
    @router.post("/admin/browse-file")
    async def browse_file():
        if platform.system() != "Darwin":
            return {"status": "error", "message": "Only supported on macOS."}
        try:
            import asyncio
            cmd = "osascript -e 'POSIX path of (choose file with prompt \"Chọn file JSON chìa khóa\")'"
            proc = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            stdout, stderr = await proc.communicate()
            if proc.returncode == 0:
                return {"status": "success", "path": stdout.decode('utf-8').strip()}
            return {"status": "error", "message": "Cancelled"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @router.post("/admin/browse-folder")
    async def browse_folder():
        if platform.system() != "Darwin":
            return {"status": "error", "message": "Only supported on macOS."}
        try:
            import asyncio
            cmd = "osascript -e 'POSIX path of (choose folder with prompt \"Chọn thư mục\")'"
            proc = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            stdout, stderr = await proc.communicate()
            if proc.returncode == 0:
                # osascript returns path with trailing newline and trailing slash — strip both
                path = stdout.decode('utf-8').strip().rstrip('/')
                return {"status": "success", "path": path}
            return {"status": "error", "message": "Cancelled"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @router.post("/admin/inspect-vertex-key")
    async def inspect_vertex_key(payload: dict):
        key_path = payload.get("path")
        try:
            with open(key_path, 'r') as f:
                data = json.load(f)
            return {"project_id": data.get("project_id"), "client_email": data.get("client_email")}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.get("/admin/logs")
    async def get_admin_logs():
        from app.core.logging import mem_handler
        return {"logs": mem_handler.get_logs() if hasattr(mem_handler, 'get_logs') else []}

    @router.get("/admin/stats")
    async def get_admin_stats():
        pages = await list_wiki_use_case.execute()
        all_sources = source_provider.get_all_sources()
        return {
            "total_pages": len(pages),
            "total_sources": len(all_sources),
            "active_sources": len([s for s in all_sources if s.active]),
            "system": platform.system(),
            "uptime": "N/A" # Could track this if needed
        }

    # --- Vault Audit & Cleanup ---
    @router.get("/vault/audit")
    async def vault_audit():
        if not vault_audit_use_case:
            raise HTTPException(status_code=503, detail="Vault audit not configured")
        return await vault_audit_use_case.run()

    @router.post("/vault/cleanup")
    async def vault_cleanup(payload: dict):
        if not vault_cleanup_use_case:
            raise HTTPException(status_code=503, detail="Vault cleanup not configured")
        action = payload.get("action")
        if action == "delete_expired":
            return await vault_cleanup_use_case.delete_expired()
        elif action == "delete_low_score":
            threshold = int(payload.get("threshold", 3))
            return await vault_cleanup_use_case.delete_low_score(threshold)
        elif action == "migrate_old":
            return await vault_cleanup_use_case.migrate_old_structure()
        elif action == "rebuild_mocs":
            return await vault_cleanup_use_case.rebuild_mocs()
        elif action == "rescore":
            return await vault_cleanup_use_case.rescore_unscored()
        elif action == "delete_duplicates":
            return await vault_cleanup_use_case.delete_duplicates()
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    # --- AI & Chat ---
    @router.post("/chat", response_model=ChatResponse)
    async def chat(request: ChatRequest):
        try:
            return await chat_use_case.execute(request.message)
        except Exception as e:
            logger.error(f"Chat error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/research/deep")
    async def deep_research(request: ChatRequest):
        try:
            from app.core.container import container
            from app.domain.use_cases.deep_research_use_cases import DeepResearchUseCase
            
            use_case = DeepResearchUseCase(
                container.ai_provider,
                container.search_provider,
                container.url_scraper,
                system_dir=container.config.storage.system_dir
            )
            
            return await use_case.execute(request.message)
        except Exception as e:
            logger.error(f"Deep Research error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/research/history")
    async def get_research_history():
        from app.core.container import container
        history_file = os.path.join(container.config.storage.system_dir, "research_history.json")
        if not os.path.exists(history_file):
            return []
        try:
            with open(history_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return []

    @router.get("/ai/availability")
    async def get_ai_availability():
        try:
            from app.core.container import container
            return await container.ai_provider.check_availability()
        except Exception as e:
            logger.error(f"Failed to check AI availability: {e}")
            return {}

    @router.get("/ai/models")
    async def list_models(provider: Optional[str] = None):
        try:
            return {"models": await get_models_use_case.execute(provider=provider)}
        except Exception as e:
            logger.error(f"Failed to list models: {e}")
            return {"models": []}

    return router
