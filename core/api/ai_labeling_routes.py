"""
AI-Powered Labeling API — trigger AI label prediction, synthetic generation,
similarity propagation, aggregation, and active learning.
"""

import asyncio
from typing import Optional
from uuid import UUID

import core.paths  # noqa: F401

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models.background_task import BackgroundTask
from core.models.dataset import Dataset, DatasetVersion
from core.services.auth_service import User, get_current_user
from core.services.task_service import create_task_record
from core.services.dataset_access_service import assert_dataset_access

router = APIRouter(prefix="/api/v1/labeling/ai", tags=["ai-labeling"])


# ── Schemas ──────────────────────────────────────────────────────────────


class AILabelRequest(BaseModel):
    dataset_id: UUID
    labels: list[str]
    version_number: Optional[int] = None
    text_column: str = "text"
    examples: Optional[list[dict]] = None
    instructions: Optional[str] = None
    provider: Optional[str] = None
    model_name: Optional[str] = None


class AILabelResponse(BaseModel):
    task_id: UUID
    celery_task_id: str
    message: str


class SyntheticRequest(BaseModel):
    label: str
    count: int = Field(default=20, ge=1, le=100)
    examples: Optional[list[dict]] = None
    provider: Optional[str] = None
    model_name: Optional[str] = None


class PropagationRequest(BaseModel):
    dataset_id: UUID
    labels: list[str]
    confidence_threshold: float = 0.7
    top_k: int = 5


class AggregateRequest(BaseModel):
    dataset_id: UUID
    strategy: str = "confidence_weighted"
    include_rule_labels: bool = True
    include_ai_labels: bool = True
    include_propagated_labels: bool = True


class ActiveLearningRequest(BaseModel):
    dataset_id: UUID
    top_n: int = 20


class PreviewRequest(BaseModel):
    dataset_id: UUID
    labels: list[str]
    version_number: Optional[int] = None
    text_column: str = "text"
    examples: Optional[list[dict]] = None
    instructions: Optional[str] = None
    provider: Optional[str] = None
    model_name: Optional[str] = None
    sample_size: int = Field(default=5, ge=1, le=10)


# ── Helpers ──────────────────────────────────────────────────────────────


async def _get_user_llm_config(
    db: AsyncSession,
    user_id,
    provider: str = None,
    model_name: str = None,
):
    """Build an LLMConfig from the user's saved LLM provider configuration.

    Auto-rewrites localhost URLs to host.docker.internal when we're running
    inside Docker — covers the case where the user saved their Ollama
    config back when the default was localhost. The rewrite happens HERE
    (in the API process which uvicorn auto-reloads) rather than only in
    the Celery worker, so a stale worker pod still gets a corrected URL.
    """
    from core.models.llm_config import LLMConfigRecord
    from core.llm.providers import LLMConfig, LLMProvider
    from core.llm.service import _normalize_local_url

    if provider:
        stmt = select(LLMConfigRecord).where(
            LLMConfigRecord.user_id == user_id,
            LLMConfigRecord.provider == provider,
        )
    else:
        stmt = select(LLMConfigRecord).where(
            LLMConfigRecord.user_id == user_id,
            LLMConfigRecord.is_default == True,  # noqa: E712
        )

    result = await db.execute(stmt)
    record = result.scalars().first()

    if not record:
        raise HTTPException(
            400,
            "No LLM provider configured. Set up a provider in LLM Settings first.",
        )

    fixed_base_url = _normalize_local_url(record.base_url) if record.base_url else record.base_url
    return LLMConfig(
        provider=LLMProvider(record.provider),
        model_name=model_name or record.model_name,
        api_key=record.api_key_encrypted,
        base_url=fixed_base_url,
        temperature=record.temperature,
        max_tokens=record.max_tokens,
    )


async def _resolve_dataset_version(
    db: AsyncSession,
    dataset_id: UUID,
    version_number: int | None = None,
    user: Optional[User] = None,
):
    """Validate the dataset exists (and access if user given) and return (dataset, version).

    When ``user`` is provided the access check is enforced — that's the
    expected path for HTTP-triggered calls. Background callers that don't
    represent a specific user can omit it.
    """
    if user is not None:
        dataset = await assert_dataset_access(db, dataset_id, user)
    else:
        result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
        dataset = result.scalars().first()
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")

    if version_number:
        version_stmt = select(DatasetVersion).where(
            DatasetVersion.dataset_id == dataset_id,
            DatasetVersion.version_number == version_number,
        )
    else:
        version_stmt = (
            select(DatasetVersion)
            .where(DatasetVersion.dataset_id == dataset_id)
            .order_by(DatasetVersion.version_number.desc())
            .limit(1)
        )

    version_result = await db.execute(version_stmt)
    version = version_result.scalars().first()
    if version is None:
        msg = (
            f"Version {version_number} not found for this dataset."
            if version_number
            else "No file versions found for this dataset. Upload a file first."
        )
        raise HTTPException(status_code=400, detail=msg)

    return dataset, version


# ── Routes ───────────────────────────────────────────────────────────────


@router.post("/predict", response_model=AILabelResponse, status_code=status.HTTP_202_ACCEPTED)
async def predict_labels(
    payload: AILabelRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger AI-powered label prediction on a text dataset (async Celery task)."""
    dataset, version = await _resolve_dataset_version(
        db, payload.dataset_id, payload.version_number, user=current_user,
    )

    # Resolve LLM config so we can pass credentials to the worker
    llm_config = await _get_user_llm_config(db, payload.provider, payload.model_name)

    import uuid as _uuid

    celery_task_id = str(_uuid.uuid4())

    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="ai_labeling",
        dataset_id=payload.dataset_id,
        parameters={
            "version_number": version.version_number,
            "labels": payload.labels,
            "text_column": payload.text_column,
            "provider": llm_config.provider.value,
            "model_name": llm_config.model_name,
        },
    )

    await db.commit()

    from data_intelligence.tasks.ai_labeling_tasks import predict_labels as predict_task

    predict_task.apply_async(
        kwargs={
            "dataset_id": str(payload.dataset_id),
            "version_number": version.version_number,
            "labels": payload.labels,
            "text_column": payload.text_column,
            "provider": llm_config.provider.value,
            "model_name": llm_config.model_name,
            "api_key_encrypted": llm_config.api_key,
            "base_url": llm_config.base_url,
            "temperature": llm_config.temperature,
            "max_tokens": llm_config.max_tokens,
            "examples": payload.examples,
            "instructions": payload.instructions,
        },
        task_id=celery_task_id,
    )

    return AILabelResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"AI label prediction started for dataset {dataset.name} v{version.version_number}",
    )


@router.post("/preview")
async def preview_predictions(
    payload: PreviewRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Classify the first few rows of a dataset synchronously.

    Lets the user sanity-check their labels, few-shot examples and custom
    instructions before launching a full prediction run.
    """
    if not payload.labels:
        raise HTTPException(status_code=400, detail="Provide at least one label.")

    _dataset, version = await _resolve_dataset_version(
        db, payload.dataset_id, payload.version_number, user=current_user,
    )
    llm_config = await _get_user_llm_config(db, payload.provider, payload.model_name)

    # Load the dataset file off the event loop (blocking download + parse).
    from data_intelligence.tasks.structuring_tasks import _load_dataset_file

    try:
        df = await asyncio.to_thread(
            _load_dataset_file, str(payload.dataset_id), version.version_number
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not read dataset file: {exc}")

    if payload.text_column not in df.columns:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{payload.text_column}' not found. Available: {list(df.columns)}",
        )

    texts = (
        df[payload.text_column].dropna().astype(str).head(payload.sample_size).tolist()
    )
    if not texts:
        raise HTTPException(status_code=400, detail="No text rows found to preview.")

    from core.llm.service import LLMService

    service = LLMService(llm_config)
    results = await asyncio.gather(
        *[
            service.classify(t, payload.labels, payload.examples, payload.instructions)
            for t in texts
        ]
    )

    predictions = [
        {
            "text": t,
            "label": r.get("label"),
            "confidence": round(float(r.get("confidence", 0.0)), 3),
            "reasoning": r.get("reasoning", ""),
        }
        for t, r in zip(texts, results)
    ]
    return {
        "predictions": predictions,
        "model": llm_config.model_name,
        "provider": llm_config.provider.value,
        "sample_size": len(predictions),
    }


@router.post("/predict-images", response_model=AILabelResponse, status_code=status.HTTP_202_ACCEPTED)
async def predict_image_labels(
    payload: AILabelRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger AI-powered label prediction on an image dataset (async Celery task)."""
    dataset = await assert_dataset_access(db, payload.dataset_id, current_user)

    llm_config = await _get_user_llm_config(db, payload.provider, payload.model_name)

    import uuid as _uuid

    celery_task_id = str(_uuid.uuid4())

    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="ai_labeling",
        dataset_id=payload.dataset_id,
        parameters={
            "labels": payload.labels,
            "provider": llm_config.provider.value,
            "model_name": llm_config.model_name,
            "mode": "image",
        },
    )

    await db.commit()

    from data_intelligence.tasks.ai_labeling_tasks import predict_image_labels_task

    predict_image_labels_task.apply_async(
        kwargs={
            "dataset_id": str(payload.dataset_id),
            "labels": payload.labels,
            "provider": llm_config.provider.value,
            "model_name": llm_config.model_name,
            "api_key_encrypted": llm_config.api_key,
            "base_url": llm_config.base_url,
            "temperature": llm_config.temperature,
            "max_tokens": llm_config.max_tokens,
        },
        task_id=celery_task_id,
    )

    return AILabelResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"AI image label prediction started for dataset {dataset.name}",
    )


@router.get("/predictions/{dataset_id}")
async def get_predictions(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest AI prediction results for a dataset."""
    await assert_dataset_access(db, dataset_id, current_user)
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "ai_labeling",
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
            detail="No completed AI labeling results found for this dataset",
        )

    return {
        "task_id": str(task.id),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "result": task.result,
    }


@router.post("/synthetic")
async def generate_synthetic(
    payload: SyntheticRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate synthetic text samples for a given label (synchronous)."""
    llm_config = await _get_user_llm_config(db, payload.provider, payload.model_name)

    from labeling.ai_labeler import generate_synthetic_data

    samples = generate_synthetic_data(
        label=payload.label,
        count=payload.count,
        config=llm_config,
        examples=payload.examples,
    )

    return {
        "label": payload.label,
        "requested_count": payload.count,
        "generated_count": len(samples),
        "samples": samples,
    }


@router.post("/propagate", response_model=AILabelResponse, status_code=status.HTTP_202_ACCEPTED)
async def propagate_labels(
    payload: PropagationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger similarity-based label propagation (async Celery task)."""
    dataset = await assert_dataset_access(db, payload.dataset_id, current_user)

    import uuid as _uuid

    celery_task_id = str(_uuid.uuid4())

    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="propagation",
        dataset_id=payload.dataset_id,
        parameters={
            "labels": payload.labels,
            "confidence_threshold": payload.confidence_threshold,
            "top_k": payload.top_k,
        },
    )

    await db.commit()

    from data_intelligence.tasks.ai_labeling_tasks import propagate_labels_task

    propagate_labels_task.apply_async(
        kwargs={
            "dataset_id": str(payload.dataset_id),
            "labels": payload.labels,
            "confidence_threshold": payload.confidence_threshold,
            "top_k": payload.top_k,
        },
        task_id=celery_task_id,
    )

    return AILabelResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"Label propagation started for dataset {dataset.name}",
    )


@router.get("/propagation/{dataset_id}")
async def get_propagation_results(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest propagation results for a dataset."""
    await assert_dataset_access(db, dataset_id, current_user)
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "propagation",
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
            detail="No completed propagation results found for this dataset",
        )

    return {
        "task_id": str(task.id),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "result": task.result,
    }


@router.post("/aggregate", response_model=AILabelResponse, status_code=status.HTTP_202_ACCEPTED)
async def aggregate_labels(
    payload: AggregateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger label aggregation across all labeling sources (async Celery task)."""
    dataset = await assert_dataset_access(db, payload.dataset_id, current_user)

    import uuid as _uuid

    celery_task_id = str(_uuid.uuid4())

    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="aggregation",
        dataset_id=payload.dataset_id,
        parameters={
            "strategy": payload.strategy,
            "include_rule_labels": payload.include_rule_labels,
            "include_ai_labels": payload.include_ai_labels,
            "include_propagated_labels": payload.include_propagated_labels,
        },
    )

    await db.commit()

    from data_intelligence.tasks.ai_labeling_tasks import aggregate_labels_task

    aggregate_labels_task.apply_async(
        kwargs={
            "dataset_id": str(payload.dataset_id),
            "strategy": payload.strategy,
            "include_rules": payload.include_rule_labels,
            "include_ai": payload.include_ai_labels,
            "include_propagated": payload.include_propagated_labels,
        },
        task_id=celery_task_id,
    )

    return AILabelResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"Label aggregation started for dataset {dataset.name}",
    )


@router.get("/aggregation/{dataset_id}")
async def get_aggregation_results(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest aggregation results for a dataset."""
    await assert_dataset_access(db, dataset_id, current_user)
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "aggregation",
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
            detail="No completed aggregation results found for this dataset",
        )

    return {
        "task_id": str(task.id),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "result": task.result,
    }


@router.post("/active-learning")
async def active_learning(
    payload: ActiveLearningRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Identify items that would benefit most from human review (synchronous)."""
    # Gather label sources from all completed labeling tasks for this dataset
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == payload.dataset_id,
            BackgroundTask.status == "completed",
            BackgroundTask.task_type.in_(["labeling", "ai_labeling", "propagation"]),
        )
    )
    result = await db.execute(stmt)
    tasks = result.scalars().all()

    if not tasks:
        raise HTTPException(
            status_code=404,
            detail="No completed labeling results found for this dataset. "
            "Run rule-based, AI, or propagation labeling first.",
        )

    from labeling.label_aggregator import LabelSource, active_learning_candidates

    # Build item_labels dict from completed task results
    item_labels: dict[str, list[LabelSource]] = {}

    for task in tasks:
        task_result = task.result or {}
        source_type = {
            "labeling": "rule",
            "ai_labeling": "ai",
            "propagation": "propagation",
        }.get(task.task_type, "rule")

        # Extract predictions/results from the task result
        predictions = task_result.get("labeling", {}).get("predictions", [])
        if not predictions:
            predictions = task_result.get("predictions", [])
        if not predictions:
            # Try propagation results format
            predictions = task_result.get("results", [])

        for pred in predictions:
            item_id = pred.get("text") or pred.get("item_id") or ""
            label = pred.get("predicted_label") or pred.get("propagated_label") or pred.get("label") or ""
            confidence = float(pred.get("confidence", 0.0))

            if not item_id:
                continue

            if item_id not in item_labels:
                item_labels[item_id] = []

            item_labels[item_id].append(
                LabelSource(
                    source_type=source_type,
                    label=label,
                    confidence=confidence,
                )
            )

    candidates = active_learning_candidates(item_labels, top_n=payload.top_n)

    return {
        "dataset_id": str(payload.dataset_id),
        "total_labeled_items": len(item_labels),
        "candidates_count": len(candidates),
        "candidates": candidates,
    }
