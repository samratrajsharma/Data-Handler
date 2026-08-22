"""
Background task API — submit, monitor, and list async tasks.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models.background_task import BackgroundTask
from core.services.auth_service import User, get_current_user

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


# ── Schemas ──────────────────────────────────────────────────────────────


class TaskResponse(BaseModel):
    id: UUID
    celery_task_id: str
    task_type: str
    status: str
    progress: float
    progress_message: Optional[str] = None
    dataset_id: Optional[UUID] = None
    created_by: Optional[UUID] = None
    parameters: dict = {}
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class TaskListResponse(BaseModel):
    tasks: list[TaskResponse]
    total: int


# ── Routes ───────────────────────────────────────────────────────────────


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    dataset_id: Optional[UUID] = Query(None),
    task_type: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List background tasks with optional filters."""
    base = select(BackgroundTask)
    count_base = select(func.count(BackgroundTask.id))

    if dataset_id:
        base = base.where(BackgroundTask.dataset_id == dataset_id)
        count_base = count_base.where(BackgroundTask.dataset_id == dataset_id)
    if task_type:
        base = base.where(BackgroundTask.task_type == task_type)
        count_base = count_base.where(BackgroundTask.task_type == task_type)
    if status_filter:
        base = base.where(BackgroundTask.status == status_filter)
        count_base = count_base.where(BackgroundTask.status == status_filter)

    total_result = await db.execute(count_base)
    total = total_result.scalar() or 0

    stmt = base.order_by(BackgroundTask.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    tasks = list(result.scalars().all())

    return TaskListResponse(
        tasks=[TaskResponse.model_validate(t) for t in tasks],
        total=total,
    )


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific background task by ID."""
    result = await db.execute(
        select(BackgroundTask).where(BackgroundTask.id == task_id)
    )
    task = result.scalars().first()
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )
    return TaskResponse.model_validate(task)


@router.get("/celery/{celery_task_id}", response_model=TaskResponse)
async def get_task_by_celery_id(
    celery_task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a background task by its Celery task ID."""
    result = await db.execute(
        select(BackgroundTask).where(BackgroundTask.celery_task_id == celery_task_id)
    )
    task = result.scalars().first()
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Celery task {celery_task_id} not found",
        )
    return TaskResponse.model_validate(task)
