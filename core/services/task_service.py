"""
Task service — submit background tasks and track them in the database.
"""

import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.models.background_task import BackgroundTask

logger = logging.getLogger(__name__)


async def create_task_record(
    db: AsyncSession,
    celery_task_id: str,
    task_type: str,
    dataset_id: UUID,
    parameters: dict | None = None,
) -> BackgroundTask:
    """Create a BackgroundTask record to track a Celery job."""
    task = BackgroundTask(
        celery_task_id=celery_task_id,
        task_type=task_type,
        status="pending",
        progress=0.0,
        dataset_id=dataset_id,
        parameters=parameters or {},
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    logger.info(
        "Created task record %s (celery=%s, type=%s, dataset=%s)",
        task.id, celery_task_id, task_type, dataset_id,
    )
    return task


def update_task_progress(
    db_session,
    celery_task_id: str,
    progress: float,
    message: str = "",
    status: str = "progress",
):
    """Update task progress — called from within Celery tasks (sync)."""
    from sqlalchemy import update
    from core.models.background_task import BackgroundTask

    stmt = (
        update(BackgroundTask)
        .where(BackgroundTask.celery_task_id == celery_task_id)
        .values(progress=progress, progress_message=message, status=status)
    )
    db_session.execute(stmt)
    db_session.commit()


def complete_task(
    db_session,
    celery_task_id: str,
    result: dict | None = None,
    error: str | None = None,
):
    """Mark a task as completed or failed — called from Celery tasks (sync)."""
    from datetime import datetime
    from sqlalchemy import update
    from core.models.background_task import BackgroundTask

    values = {
        "completed_at": datetime.utcnow(),
        "progress": 1.0 if error is None else BackgroundTask.progress,
    }
    if error:
        values["status"] = "failed"
        values["error"] = error
    else:
        values["status"] = "completed"
        values["result"] = result or {}

    stmt = (
        update(BackgroundTask)
        .where(BackgroundTask.celery_task_id == celery_task_id)
        .values(**values)
    )
    db_session.execute(stmt)
    db_session.commit()
