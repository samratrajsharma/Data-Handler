"""
Annotation Export API — package image annotations into standard ML formats
(YOLO / COCO / Pascal VOC / folder classification) via a background task.
"""

import uuid as _uuid
from datetime import timedelta
from typing import Literal
from uuid import UUID

import core.paths  # noqa: F401

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models.annotation import ImageAnnotation
from core.models.background_task import BackgroundTask
from core.models.dataset import Dataset
from core.services.auth_service import User, get_current_user
from core.services.task_service import create_task_record

router = APIRouter(prefix="/api/v1/annotations", tags=["annotation-export"])


# ── Schemas ──────────────────────────────────────────────────────────────


class ImageExportRequest(BaseModel):
    format: Literal["yolo", "coco", "voc", "classification"]
    include_images: bool = True


class ExportTaskResponse(BaseModel):
    task_id: UUID
    celery_task_id: str
    message: str


# ── Helpers ──────────────────────────────────────────────────────────────


async def _validate_dataset(db: AsyncSession, dataset_id: UUID) -> Dataset:
    """Ensure the dataset exists, or raise a 404."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalars().first()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


# ── Routes ───────────────────────────────────────────────────────────────


@router.post(
    "/{dataset_id}/images/export",
    response_model=ExportTaskResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def export_images(
    dataset_id: UUID,
    payload: ImageExportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start an async export of the dataset's image annotations."""
    dataset = await _validate_dataset(db, dataset_id)

    count_stmt = (
        select(func.count())
        .select_from(ImageAnnotation)
        .where(ImageAnnotation.dataset_id == dataset_id)
    )
    annotation_count = (await db.execute(count_stmt)).scalar() or 0
    if annotation_count == 0:
        raise HTTPException(status_code=422, detail="No annotations to export")

    celery_task_id = str(_uuid.uuid4())

    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="annotation_export",
        dataset_id=dataset_id,
        parameters={
            "format": payload.format,
            "include_images": payload.include_images,
        },
    )

    # Commit so the row is visible to the Celery worker before dispatch
    await db.commit()

    from data_intelligence.tasks.annotation_tasks import export_image_annotations

    export_image_annotations.apply_async(
        kwargs={
            "dataset_id": str(dataset_id),
            "export_format": payload.format,
            "include_images": payload.include_images,
        },
        task_id=celery_task_id,
    )

    return ExportTaskResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"Annotation export ({payload.format}) started for dataset {dataset.name}",
    )


@router.get("/{dataset_id}/images/export/latest")
async def get_latest_export(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the latest completed annotation export with a download URL."""
    await _validate_dataset(db, dataset_id)

    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "annotation_export",
            BackgroundTask.status == "completed",
        )
        .order_by(BackgroundTask.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    task = result.scalars().first()

    if task is None:
        raise HTTPException(status_code=404, detail="No completed export found")

    task_result = task.result or {}
    export_path = task_result.get("export_path")
    download_url = None

    if export_path:
        try:
            from core.settings import settings
            from core.storage import get_minio_public_client

            client = get_minio_public_client()
            download_url = client.presigned_get_object(
                settings.MINIO_BUCKET_NAME,
                export_path,
                expires=timedelta(hours=1),
            )
        except Exception:
            download_url = None

    return {
        "status": task.status,
        "format": task_result.get("format"),
        "export_path": export_path,
        "download_url": download_url,
        "image_count": task_result.get("image_count"),
        "annotation_count": task_result.get("annotation_count"),
        "created_at": task.created_at.isoformat() if task.created_at else None,
    }
