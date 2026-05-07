import os
import logging
from ...domain.repositories import IWikiRepository
from ...infrastructure.rag_provider import RAGService

logger = logging.getLogger(__name__)

class ListWikiPagesUseCase:
    def __init__(self, wiki_repo: IWikiRepository):
        self.wiki_repo = wiki_repo
    
    async def execute(self):
        return await self.wiki_repo.list_pages()

class GetWikiPageUseCase:
    def __init__(self, wiki_repo: IWikiRepository):
        self.wiki_repo = wiki_repo
    
    async def execute(self, filename: str):
        return await self.wiki_repo.get_page(filename)

class SaveWikiPageUseCase:
    def __init__(self, wiki_repo: IWikiRepository):
        self.wiki_repo = wiki_repo
    
    async def execute(self, title: str, content: str):
        return await self.wiki_repo.save_page(title, content)

class ReindexWikiUseCase:
    def __init__(self, wiki_repo: IWikiRepository, rag_service: RAGService):
        self.wiki_repo = wiki_repo
        self.rag_service = rag_service

    async def execute(self):
        if not self.rag_service:
            return
        
        logger.info("🔍 Re-indexing all wiki pages...")
        pages = await self.wiki_repo.list_pages()
        for p in pages:
            filename = p['filename']
            if filename != "index.md":
                try:
                    page_data = await self.wiki_repo.get_page(filename)
                    await self.rag_service.add_document(filename, page_data['content'], {"filename": filename})
                except Exception as e:
                    logger.error(f"Error re-indexing {filename}: {e}")
        logger.info("✅ Re-indexing complete.")

class DeleteWikiPageUseCase:
    def __init__(self, wiki_repo: IWikiRepository, rag_service: RAGService = None):
        self.wiki_repo = wiki_repo
        self.rag_service = rag_service
    
    async def execute(self, filename: str):
        # 1. Delete from RAG index if exists
        if self.rag_service:
            try:
                # Assuming filename is the ID in Chroma
                self.rag_service.collection.delete(ids=[filename])
            except Exception as e:
                logger.warning(f"⚠️ Failed to remove {filename} from RAG index: {e}")

        # 2. Delete from file system
        return await self.wiki_repo.delete_page(filename)

class PromoteWikiPageUseCase:
    def __init__(self, wiki_repo: IWikiRepository, rag_service=None, neo4j_repo=None):
        self.wiki_repo = wiki_repo
        self.rag_service = rag_service
        self.neo4j_repo = neo4j_repo

    async def execute(self, filename: str):
        """Promote a read_later or temporary page to permanent, then re-index."""
        page = await self.wiki_repo.get_page(filename)
        if not page:
            return {"status": "error", "message": "Page not found"}

        # Strip prefixes like [TEMPORARY] or [READ_LATER]
        title = page.get('title', filename)
        new_title = title.replace("[TEMPORARY] ", "").replace("[READ_LATER] ", "")

        # Update metadata
        metadata = page.get('metadata', {})
        metadata['category'] = 'permanent'
        metadata['ttl_days'] = 0

        new_filename = await self.wiki_repo.save_page(new_title, page['content'], metadata=metadata)

        # Delete old file if title changed
        if new_title != title:
            await self.wiki_repo.delete_page(filename)

        # Re-index in Chroma with permanent category
        if self.rag_service:
            try:
                index_meta = {**metadata, "filename": new_filename or new_title}
                await self.rag_service.add_document(
                    new_filename or new_title,
                    page['content'],
                    index_meta
                )
            except Exception as e:
                logger.warning(f"⚠️ Chroma re-index thất bại khi promote '{new_title}': {e}")

        # Push graph to Neo4j if available
        graph_data = metadata.get('graph_data', {})
        if self.neo4j_repo and graph_data:
            try:
                await self.neo4j_repo.upsert_entities_and_relationships(
                    graph_data.get('entities', []),
                    graph_data.get('relationships', []),
                    new_title
                )
            except Exception as e:
                logger.warning(f"⚠️ Neo4j upsert thất bại khi promote '{new_title}': {e}")

        logger.info(f"🚀 Page promoted to Permanent: {new_title}")
        return {"status": "success", "new_title": new_title}
