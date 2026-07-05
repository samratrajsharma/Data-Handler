"""
Review & Export API — dataset quality evaluation, review actions,
status management, and export to common ML formats.
"""

import json
from typing import Optional
from uuid import UUID

import core.paths  # noqa: F401

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models.background_task import BackgroundTask
from core.models.dataset import Dataset, DatasetMetadata
from core.services.auth_service import User, get_current_user
from core.services.task_service import create_task_record
from core.services.dataset_access_service import assert_dataset_access

router = APIRouter(prefix="/api/v1/review", tags=["review"])


# ── Schemas ──────────────────────────────────────────────────────────────


class QualityEvalRequest(BaseModel):
    dataset_id: UUID
    expected_labels: Optional[list[str]] = None


class QualityEvalResponse(BaseModel):
    task_id: UUID
    celery_task_id: str
    message: str


class ReviewAction(BaseModel):
    item_id: str
    action: str = Field(..., pattern="^(approve|reject|relabel)$")
    new_label: Optional[str] = None


class BulkReviewRequest(BaseModel):
    dataset_id: UUID
    actions: list[ReviewAction]


class ExportRequest(BaseModel):
    dataset_id: UUID
    format: str = Field(..., pattern="^(csv|json|coco|yolo)$")


class ExportResponse(BaseModel):
    task_id: UUID
    celery_task_id: str
    message: str


class StatusUpdateRequest(BaseModel):
    status: str


# ── Helpers ──────────────────────────────────────────────────────────────


async def _validate_dataset(
    db: AsyncSession, dataset_id: UUID, user: Optional[User] = None,
) -> Dataset:
    """Ensure the dataset exists (and optionally that ``user`` can access it)."""
    if user is not None:
        return await assert_dataset_access(db, dataset_id, user)
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalars().first()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


# Valid status transitions for the review workflow
_VALID_TRANSITIONS: dict[str, list[str]] = {
    "labeled": ["reviewed"],
    "reviewed": ["ready"],
}


# ── Routes ───────────────────────────────────────────────────────────────


@router.post(
    "/quality/{dataset_id}",
    response_model=QualityEvalResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_quality_eval(
    dataset_id: UUID,
    payload: QualityEvalRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger quality evaluation on a labeled dataset (async Celery task)."""
    dataset = await _validate_dataset(db, dataset_id, current_user)

    import uuid as _uuid

    celery_task_id = str(_uuid.uuid4())

    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="quality_eval",
        dataset_id=dataset_id,
        parameters={
            "expected_labels": payload.expected_labels,
        },
    )

    await db.commit()

    from data_intelligence.tasks.review_tasks import run_quality_evaluation

    run_quality_evaluation.apply_async(
        kwargs={
            "dataset_id": str(dataset_id),
            "expected_labels": payload.expected_labels,
        },
        task_id=celery_task_id,
    )

    return QualityEvalResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"Quality evaluation started for dataset {dataset.name}",
    )


@router.get("/quality/{dataset_id}")
async def get_quality_results(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest quality evaluation results for a dataset."""
    await _validate_dataset(db, dataset_id, current_user)

    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "quality_eval",
            BackgroundTask.status == "completed",
        )
        .order_by(BackgroundTask.completed_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    task = result.scalars().first()

    if task is None:
        raise HTTPException(
            status_code=404,
            detail="No completed quality evaluation found for this dataset",
        )

    return {
        "task_id": str(task.id),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "result": task.result,
    }


@router.post("/actions")
async def submit_review_actions(
    payload: BulkReviewRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit review actions (approve / reject / relabel) for dataset items."""
    dataset = await _validate_dataset(db, payload.dataset_id)

    # Fetch the latest aggregation or labeling result for this dataset
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == payload.dataset_id,
            BackgroundTask.status == "completed",
            BackgroundTask.task_type.in_(["aggregation", "ai_labeling", "labeling"]),
        )
        .order_by(BackgroundTask.completed_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    label_task = result.scalars().first()

    if label_task is None:
        raise HTTPException(
            status_code=400,
            detail="No completed labeling/aggregation results found. Run labeling first.",
        )

    # Build a lookup of existing predictions keyed by item_id
    task_result = label_task.result or {}
    predictions = (
        task_result.get("aggregation", {}).get("results", [])
        or task_result.get("ai_labeling", {}).get("predictions", [])
        or task_result.get("labeling", {}).get("predictions", [])
        or task_result.get("predictions", [])
        or task_result.get("results", [])
    )

    pred_map: dict[str, dict] = {}
    for pred in predictions:
        item_id = pred.get("text") or pred.get("item_id") or ""
        if item_id:
            pred_map[item_id] = pred

    # Process actions
    summary = {"approved": 0, "rejected": 0, "relabeled": 0, "not_found": 0}
    actions_log: list[dict] = []

    for action in payload.actions:
        if action.item_id not in pred_map:
            summary["not_found"] += 1
            continue

        entry = pred_map[action.item_id]

        if action.action == "approve":
            entry["review_status"] = "approved"
            summary["approved"] += 1
        elif action.action == "reject":
            entry["review_status"] = "rejected"
            summary["rejected"] += 1
        elif action.action == "relabel":
            old_label = (
                entry.get("final_label")
                or entry.get("predicted_label")
                or entry.get("label")
            )
            entry["review_status"] = "relabeled"
            entry["original_label"] = old_label
            if "final_label" in entry:
                entry["final_label"] = action.new_label
            elif "predicted_label" in entry:
                entry["predicted_label"] = action.new_label
            else:
                entry["label"] = action.new_label
            summary["relabeled"] += 1

        actions_log.append(
            {
                "item_id": action.item_id,
                "action": action.action,
                "new_label": action.new_label,
                "reviewed_by": str(current_user.id),
            }
        )

    # Persist the updated result back to the task record
    label_task.result = task_result
    await db.flush()

    # Store review actions as dataset metadata
    meta_stmt = select(DatasetMetadata).where(
        DatasetMetadata.dataset_id == payload.dataset_id,
        DatasetMetadata.key == "review_actions",
    )
    meta_result = await db.execute(meta_stmt)
    meta = meta_result.scalars().first()

    if meta is None:
        meta = DatasetMetadata(
            dataset_id=payload.dataset_id,
            key="review_actions",
            value=json.dumps(actions_log),
        )
        db.add(meta)
    else:
        existing = json.loads(meta.value) if meta.value else []
        existing.extend(actions_log)
        meta.value = json.dumps(existing)

    await db.commit()

    return {
        "dataset_id": str(payload.dataset_id),
        "summary": summary,
        "total_actions": len(payload.actions),
    }


@router.get("/status/{dataset_id}")
async def get_review_status(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get review status summary: counts of approved, rejected, relabeled items."""
    await _validate_dataset(db, dataset_id, current_user)

    # Load review actions metadata
    meta_stmt = select(DatasetMetadata).where(
        DatasetMetadata.dataset_id == dataset_id,
        DatasetMetadata.key == "review_actions",
    )
    meta_result = await db.execute(meta_stmt)
    meta = meta_result.scalars().first()

    actions_log: list[dict] = []
    if meta and meta.value:
        actions_log = json.loads(meta.value)

    # Count unique items by their latest action
    latest_by_item: dict[str, str] = {}
    for entry in actions_log:
        latest_by_item[entry["item_id"]] = entry["action"]

    counts = {"approved": 0, "rejected": 0, "relabeled": 0}
    for action in latest_by_item.values():
        if action in counts:
            counts[action] += 1

    total_reviewed = sum(counts.values())

    return {
        "dataset_id": str(dataset_id),
        "total_reviewed": total_reviewed,
        "approved": counts["approved"],
        "rejected": counts["rejected"],
        "relabeled": counts["relabeled"],
    }


@router.post(
    "/export/{dataset_id}",
    response_model=ExportResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_export(
    dataset_id: UUID,
    payload: ExportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger dataset export in the requested format (async Celery task)."""
    dataset = await _validate_dataset(db, dataset_id, current_user)

    valid_formats = {"csv", "json", "coco", "yolo"}
    if payload.format not in valid_formats:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid format '{payload.format}'. Must be one of: {', '.join(sorted(valid_formats))}",
        )

    import uuid as _uuid

    celery_task_id = str(_uuid.uuid4())

    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="export",
        dataset_id=dataset_id,
        parameters={"format": payload.format},
    )

    await db.commit()

    from data_intelligence.tasks.review_tasks import run_export

    run_export.apply_async(
        kwargs={
            "dataset_id": str(dataset_id),
            "format": payload.format,
        },
        task_id=celery_task_id,
    )

    return ExportResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"Export ({payload.format}) started for dataset {dataset.name}",
    )


@router.get("/export/{dataset_id}")
async def get_export_results(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest export results with a presigned download URL."""
    await _validate_dataset(db, dataset_id, current_user)

    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "export",
            BackgroundTask.status == "completed",
        )
        .order_by(BackgroundTask.completed_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    task = result.scalars().first()

    if task is None:
        raise HTTPException(
            status_code=404,
            detail="No completed export found for this dataset",
        )

    export_path = (task.result or {}).get("export_path")
    download_url = None

    if export_path:
        try:
            from core.storage import get_minio_client
            from core.settings import settings

            client = get_minio_client()
            from datetime import timedelta

            download_url = client.presigned_get_object(
                settings.MINIO_BUCKET_NAME,
                export_path,
                expires=timedelta(hours=1),
            )
        except Exception:
            download_url = None

    return {
        "task_id": str(task.id),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "export_path": export_path,
        "download_url": download_url,
        "result": task.result,
    }


@router.put("/dataset/{dataset_id}/status")
async def update_dataset_status(
    dataset_id: UUID,
    payload: StatusUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Promote a dataset through the review workflow (labeled -> reviewed -> ready)."""
    dataset = await _validate_dataset(db, dataset_id, current_user)

    current_status = dataset.status
    new_status = payload.status

    allowed = _VALID_TRANSITIONS.get(current_status, [])
    if new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid status transition: '{current_status}' -> '{new_status}'. "
                f"Allowed transitions from '{current_status}': {allowed or 'none'}"
            ),
        )

    dataset.status = new_status
    await db.commit()
    await db.refresh(dataset)

    return {
        "dataset_id": str(dataset.id),
        "previous_status": current_status,
        "new_status": dataset.status,
        "message": f"Dataset status updated to '{dataset.status}'",
    }
