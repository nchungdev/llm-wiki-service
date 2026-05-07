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

    # Background task registry (for cancel/stop support)
    import asyncio as _asyncio
    _bg_tasks: list[_asyncio.Task] = []

    def _register_bg_task(task: _asyncio.Task):
        _bg_tasks.append(task)
        # Auto-clean completed tasks to avoid memory leak
        task.add_done_callback(lambda t: _bg_tasks.remove(t) if t in _bg_tasks else None)

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
        import asyncio
        task = asyncio.create_task(use_case.execute())
        _register_bg_task(task)
        return {"status": "success", "message": "Re-indexing started in background"}

    @router.post("/pipeline/stop")
    async def pipeline_stop():
        """Cancel all tracked background tasks and reset pipeline running state."""
        import asyncio
        cancelled = 0
        for task in list(_bg_tasks):
            if not task.done():
                task.cancel()
                cancelled += 1
        _bg_tasks.clear()

        # Also reset pipeline running flag via container if possible
        try:
            from app.core.container import container
            if hasattr(container, 'pipeline_status'):
                container.pipeline_status['crawl']['running'] = False
                container.pipeline_status['cook']['running'] = False
        except Exception:
            pass

        return {"status": "stopped", "cancelled": cancelled}

    @router.get("/system/health")
    async def system_health():
        """Single endpoint returning health snapshot for all subsystems."""
        from app.core.container import container
        result: dict = {}

        # --- Pipeline ---
        try:
            result['pipeline'] = {
                'crawl_running': pipeline_use_case.crawl_status.get('running', False) if pipeline_use_case else False,
                'cook_running': run_cook_use_case.status.get('running', False) if run_cook_use_case else False,
            }
        except Exception as e:
            result['pipeline'] = {'crawl_running': False, 'cook_running': False, 'error': str(e)}

        # --- RAG ---
        try:
            rag = container.rag_service
            if rag:
                all_pages = await container.wiki_repo.list_all_pages()
                vault_total = len(all_pages)
                indexed = rag.collection.count()
                coverage = round(indexed / vault_total * 100, 1) if vault_total > 0 else 0
                ef = rag.embedding_fn
                result['rag'] = {
                    'available': True,
                    'indexed': indexed,
                    'vault_total': vault_total,
                    'coverage_pct': coverage,
                    'embed_provider': ef.provider_type if not ef.is_fallback else 'ollama (fallback)',
                }
            else:
                result['rag'] = {'available': False, 'reason': 'RAG not initialized'}
        except Exception as e:
            result['rag'] = {'available': False, 'reason': str(e)}

        # --- Inbox ---
        try:
            from app.domain.use_cases.vault_audit_use_cases import VaultInboxUseCase
            uc = VaultInboxUseCase(container.config.storage.vault_dir)
            inbox = await uc.get_inbox()
            result['inbox'] = {'count': len(inbox)}
        except Exception as e:
            result['inbox'] = {'count': 0, 'error': str(e)}

        # --- Vault ---
        try:
            if vault_audit_use_case:
                report = await vault_audit_use_case.run()
                counts = report.get('counts', {})
                critical = (counts.get('no_score', 0) + counts.get('low_score', 0)
                            + counts.get('broken_links', 0) + counts.get('old_structure', 0))
                result['vault'] = {
                    'total': report.get('total', 0),
                    'critical_issues': critical,
                    'counts': counts,
                }
            else:
                result['vault'] = {'error': 'Vault audit not configured'}
        except Exception as e:
            result['vault'] = {'error': str(e)}

        return result

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
        elif action == "fix_broken_links":
            return await vault_cleanup_use_case.fix_broken_links()
        elif action == "delete_unsafe_orphans":
            threshold = int(payload.get("threshold", 4))
            return await vault_cleanup_use_case.delete_unsafe_orphans(threshold)
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    @router.get("/vault/library")
    async def vault_library():
        """Return all vault notes with extended metadata for the library browser."""
        from app.core.container import container
        pages = await container.wiki_repo.list_all_pages()
        return {"pages": pages, "total": len(pages)}

    # --- Vault Inbox ---
    @router.get("/vault/inbox")
    async def vault_inbox():
        """Return all unprocessed notes (manually added, missing AI metadata)."""
        from app.core.container import container
        from app.domain.use_cases.vault_audit_use_cases import VaultInboxUseCase
        uc = VaultInboxUseCase(
            container.config.storage.vault_dir,
            ai_provider=container.ai_provider,
            rag_service=container.rag_service,
        )
        items = await uc.get_inbox()
        return {"items": items, "total": len(items)}

    @router.post("/vault/inbox/process")
    async def vault_inbox_process(payload: dict):
        """Start background batch processing. Returns task_id for polling."""
        import uuid
        from app.core.container import container
        from app.domain.use_cases.vault_audit_use_cases import VaultInboxUseCase

        uc = VaultInboxUseCase(
            container.config.storage.vault_dir,
            ai_provider=container.ai_provider,
            rag_service=container.rag_service,
        )
        paths = payload.get("paths")   # None = process all inbox
        task_id = str(uuid.uuid4())[:8]

        import asyncio
        task = asyncio.create_task(uc.process_batch(task_id, paths))
        _register_bg_task(task)

        # Store reference so status endpoint can reach it
        if not hasattr(vault_inbox_process, '_tasks'):
            vault_inbox_process._tasks = {}
        vault_inbox_process._tasks[task_id] = uc

        return {"task_id": task_id, "status": "started"}

    @router.get("/vault/inbox/status/{task_id}")
    async def vault_inbox_status(task_id: str):
        """Poll progress of a running or completed batch."""
        tasks = getattr(vault_inbox_process, '_tasks', {})
        uc = tasks.get(task_id)
        if not uc:
            raise HTTPException(status_code=404, detail="Task not found")
        progress = uc.get_progress(task_id)
        if not progress:
            raise HTTPException(status_code=404, detail="Task not started yet")
        return progress

    @router.post("/vault/inbox/apply")
    async def vault_inbox_apply(payload: dict):
        """Apply a single previewed plan that was pending user review."""
        from app.core.container import container
        from app.domain.use_cases.vault_audit_use_cases import VaultInboxUseCase

        plan = payload.get("plan")
        if not plan:
            raise HTTPException(status_code=400, detail="plan required")

        uc = VaultInboxUseCase(
            container.config.storage.vault_dir,
            ai_provider=container.ai_provider,
            rag_service=container.rag_service,
        )
        result = await uc.apply_plan(plan)
        return result

    @router.post("/vault/bulk-delete")
    async def vault_bulk_delete(payload: dict):
        """Delete multiple notes by filename list."""
        from app.core.container import container
        filenames = payload.get("filenames", [])
        if not filenames:
            return {"deleted": 0, "errors": []}
        result = await container.wiki_repo.bulk_delete(filenames)
        return result

    # --- RAG Status ---
    @router.get("/rag/status")
    async def rag_status():
        """Return RAG index health: indexed count, vault total, coverage %, embed provider."""
        from app.core.container import container
        try:
            # Total vault notes
            all_pages = await container.wiki_repo.list_all_pages()
            vault_total = len(all_pages)

            # RAG index count
            rag = container.rag_service
            if rag is None:
                return {
                    "available": False,
                    "reason": "RAG service not initialized",
                    "indexed": 0,
                    "vault_total": vault_total,
                    "coverage_pct": 0,
                    "embed_provider": None,
                    "embed_model": None,
                }

            indexed = rag.collection.count()
            coverage = round(indexed / vault_total * 100, 1) if vault_total > 0 else 0

            # Embed provider info
            ef = rag.embedding_fn
            embed_provider = ef.provider_type if not ef.is_fallback else "ollama (fallback)"
            embed_model = ef.model_name or "auto-discover"

            return {
                "available": True,
                "indexed": indexed,
                "vault_total": vault_total,
                "coverage_pct": coverage,
                "embed_provider": embed_provider,
                "embed_model": embed_model,
                "db_path": rag.db_path,
            }
        except Exception as e:
            logger.error(f"RAG status error: {e}")
            return {"available": False, "reason": str(e), "indexed": 0, "vault_total": 0, "coverage_pct": 0}

    # --- AI & Chat ---
    @router.post("/chat", response_model=ChatResponse)
    async def chat(request: ChatRequest):
        try:
            return await chat_use_case.execute(request.message)
        except Exception as e:
            logger.error(f"Chat error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/research/deep")
    async def deep_research(request: Request):
        try:
            payload = await request.json()
            message = payload.get("message")
            plan = payload.get("plan")
            req_provider = payload.get("provider")
            req_model = payload.get("model")

            from app.core.container import container
            from app.domain.use_cases.deep_research_use_cases import DeepResearchUseCase

            ai = container.ai_provider.for_request(req_provider, req_model)
            use_case = DeepResearchUseCase(
                ai,
                container.search_provider,
                container.url_scraper,
                system_dir=container.config.storage.system_dir
            )

            return await use_case.execute(message, plan=plan)
        except Exception as e:
            logger.error(f"Deep Research error: {type(e).__name__}: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")

    @router.post("/research/deep/plan")
    async def deep_research_plan(request: Request):
        try:
            payload = await request.json()
            message = payload.get("message")
            req_provider = payload.get("provider")
            req_model = payload.get("model")

            from app.core.container import container
            from app.domain.use_cases.deep_research_use_cases import DeepResearchUseCase

            ai = container.ai_provider.for_request(req_provider, req_model)
            use_case = DeepResearchUseCase(
                ai,
                container.search_provider,
                container.url_scraper,
                system_dir=container.config.storage.system_dir
            )

            return await use_case.generate_plan(message)
        except Exception as e:
            logger.error(f"Plan generation error: {type(e).__name__}: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")

    @router.post("/research/extract")
    async def research_extract(payload: dict):
        url = payload.get("url")
        if not url: raise HTTPException(status_code=400, detail="URL is required")
        try:
            results = await pipeline_use_case.run([url])
            return results[0]
        except Exception as e:
            logger.error(f"Extract error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/research/crawl")
    async def research_crawl(payload: dict):
        url = payload.get("url")
        if not url: raise HTTPException(status_code=400, detail="URL is required")
        try:
            # 1. Call local function directly
            info = await inspect_source({"url": url})
            if info.get("status") == "error":
                info = {"name": url.split("//")[-1][:30], "url": url, "type": "web", "category": "General"}
            
            # 2. Add to sources
            from app.domain.models import Source
            new_src = Source(
                id=f"quick_{int(datetime.now().timestamp())}",
                name=info.get("name"),
                url=info.get("url"),
                type=info.get("type"),
                category=info.get("category", "General")
            )
            source_provider.add_source(new_src)
            
            # 3. Trigger crawl
            await manual_trigger_use_case.execute(source_id=new_src.id)
            return {"status": "success", "source": new_src}
        except Exception as e:
            logger.error(f"Quick crawl error: {e}")
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
