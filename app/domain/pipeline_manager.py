import logging
import asyncio
from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class TaskType(str, Enum):
    RAW_FILE = "raw_file"
    VAULT_NOTE = "vault_note"

class TaskStatus(str, Enum):
    QUEUED = "queued"
    ANALYZING = "analyzing"
    TRIAGING = "triaging"
    WRITING = "writing"
    INDEXING = "indexing"
    DONE = "done"
    ERROR = "error"
    SKIPPED = "skipped"

class PipelineTask(BaseModel):
    id: str           # filename or path
    type: TaskType
    title: str
    status: TaskStatus = TaskStatus.QUEUED
    progress: int = 0 # 0-100
    message: str = ""
    error: Optional[str] = None
    updated_at: float = 0

class PipelineChef:
    """
    CENTRAL PIPELINE HUB
    Unified task manager for all AI processing activities.
    Both SyncView and VaultHealth subscribe to this state.
    """
    def __init__(self):
        self.tasks: Dict[str, PipelineTask] = {}
        self._lock = asyncio.Lock()

    async def register_task(self, task_id: str, task_type: TaskType, title: str):
        import time
        async with self._lock:
            self.tasks[task_id] = PipelineTask(
                id=task_id,
                type=task_type,
                title=title,
                updated_at=time.time()
            )
            logger.debug(f"🍴 PipelineChef: Registered {task_type} -> {task_id}")

    async def update_task(self, task_id: str, status: TaskStatus = None, progress: int = None, message: str = None, error: str = None):
        import time
        async with self._lock:
            if task_id not in self.tasks:
                return
            
            task = self.tasks[task_id]
            if status: task.status = status
            if progress is not None: task.progress = progress
            if message is not None: task.message = message
            if error is not None: task.error = error
            task.updated_at = time.time()

    async def get_active_tasks(self) -> List[PipelineTask]:
        """Returns all non-done/non-error tasks plus recently finished ones."""
        import time
        now = time.time()
        async with self._lock:
            # Keep finished tasks for 5 minutes in memory for UI polling
            results = []
            to_remove = []
            for tid, t in self.tasks.items():
                if t.status in (TaskStatus.DONE, TaskStatus.ERROR, TaskStatus.SKIPPED):
                    if now - t.updated_at < 300: # 5 mins
                        results.append(t)
                    else:
                        to_remove.append(tid)
                else:
                    results.append(t)
            
            for tid in to_remove:
                del self.tasks[tid]
                
            return results

    def get_status_summary(self):
        """Standard summary for existing UI components."""
        active = [t for t in self.tasks.values() if t.status not in (TaskStatus.DONE, TaskStatus.ERROR, TaskStatus.SKIPPED)]
        return {
            "running": len(active) > 0,
            "total": len(self.tasks),
            "processed": len([t for t in self.tasks.values() if t.status == TaskStatus.DONE]),
            "active_count": len(active),
            "tasks": {t.id: t.dict() for t in self.tasks.values()}
        }

# Global Instance
chef = PipelineChef()
