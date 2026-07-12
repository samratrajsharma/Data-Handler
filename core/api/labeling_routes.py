"""
Rule-Based Labeling Engine API — trigger labeling pipelines and inspect operators.
"""

import asyncio
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models.background_task import BackgroundTask
from core.models.dataset import Dataset, DatasetVersion
from core.services.auth_service import User, get_current_user
from core.services.task_service import create_task_record
from core.services.dataset_access_service import assert_dataset_access
from core.settings import settings as _settings
from core.storage import get_minio_client

router = APIRouter(prefix="/api/v1/labeling", tags=["labeling"])


# ── Schemas ──────────────────────────────────────────────────────────────

# Derive operators from the engine's actual registry — single source of truth
import core.paths  # noqa: F401

from labeling.rule_engine import SUPPORTED_OPERATORS  # noqa: E402

AVAILABLE_OPERATORS = sorted(SUPPORTED_OPERATORS)


class RuleCondition(BaseModel):
    column: str
    operator: str
    value: Any = None


class RuleDefinition(BaseModel):
    """Accepts either the legacy flat shape or the new compound shape.

    Legacy: {column, operator, value, label, priority}
    Compound: {label, priority, logic, conditions: [{column, operator, value}, ...]}

    Both shapes are normalised by the rule engine on load.
    """
    label: str
    priority: int = 0
    # Compound shape
    logic: Optional[str] = None  # "and" | "or"
    conditions: Optional[list[RuleCondition]] = None
    # Legacy flat shape (still accepted for backward compatibility)
    column: Optional[str] = None
    operator: Optional[str] = None
    value: Any = None


class LabelingRequest(BaseModel):
    dataset_id: UUID
    version_number: Optional[int] = None  # defaults to latest
    rules: Optional[list[RuleDefinition]] = None  # inline rule definitions
    rule_set_id: Optional[UUID] = None
    conflict_strategy: str = "first_match"


class LabelingResponse(BaseModel):
    task_id: UUID
    celery_task_id: str
    message: str


# ── Routes ───────────────────────────────────────────────────────────────


@router.post("/run", response_model=LabelingResponse, status_code=status.HTTP_202_ACCEPTED)
async def run_labeling(
    payload: LabelingRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger the Rule-Based Labeling pipeline on a dataset.

    Applies rule definitions to label data rows as a background task.
    Provide either inline `rules` or a `rule_set_id`. Returns immediately
    with a task ID to track progress.
    """
    # Validate: must provide either rules or rule_set_id
    if not payload.rules and not payload.rule_set_id:
        raise HTTPException(
            status_code=400,
            detail="Must provide either 'rules' (inline rule definitions) or 'rule_set_id'.",
        )

    # Verify dataset exists AND the caller is allowed to label it.
    dataset = await assert_dataset_access(db, payload.dataset_id, current_user)

    # Get the version to process
    if payload.version_number:
        version_stmt = select(DatasetVersion).where(
            DatasetVersion.dataset_id == payload.dataset_id,
            DatasetVersion.version_number == payload.version_number,
        )
    else:
        # Get latest version
        version_stmt = (
            select(DatasetVersion)
            .where(DatasetVersion.dataset_id == payload.dataset_id)
            .order_by(DatasetVersion.version_number.desc())
            .limit(1)
        )

    version_result = await db.execute(version_stmt)
    version = version_result.scalars().first()
    if version is None:
        msg = (
            f"Version {payload.version_number} not found for this dataset."
            if payload.version_number
            else "No file versions found for this dataset. Upload a file first."
        )
        raise HTTPException(status_code=400, detail=msg)

    # Serialize rules for Celery
    rules_payload = None
    if payload.rules:
        rules_payload = [r.model_dump() for r in payload.rules]

    # Pre-generate a Celery task ID so the DB record and Celery job share it
    import uuid as _uuid
    celery_task_id = str(_uuid.uuid4())

    # Create tracking record FIRST with the known ID
    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="labeling",
        dataset_id=payload.dataset_id,
        parameters={
            "version_number": version.version_number,
            "rules": rules_payload,
            "rule_set_id": str(payload.rule_set_id) if payload.rule_set_id else None,
            "conflict_strategy": payload.conflict_strategy,
        },
    )


    # Commit so the row is visible to the Celery worker before dispatch
    await db.commit()

    # NOW submit the Celery task with the same pre-generated ID
    from data_intelligence.tasks.labeling_tasks import run_labeling_pipeline
    run_labeling_pipeline.apply_async(
        kwargs={
            "dataset_id": str(payload.dataset_id),
            "version_number": version.version_number,
            "rules": rules_payload,
            "rule_set_id": str(payload.rule_set_id) if payload.rule_set_id else None,
            "conflict_strategy": payload.conflict_strategy,
        },
        task_id=celery_task_id,
    )

    return LabelingResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"Labeling pipeline started for dataset {dataset.name} v{version.version_number}",
    )


@router.get("/results/{dataset_id}")
async def get_labeling_results(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest labeling results for a dataset."""
    await assert_dataset_access(db, dataset_id, current_user)
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "labeling",
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
            detail="No completed labeling results found for this dataset",
        )

    return {
        "task_id": str(task.id),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "result": task.result,
    }


class PreviewRulesRequest(BaseModel):
    dataset_id: UUID
    rules: list[RuleDefinition]
    conflict_strategy: str = "first_match"
    sample_size: int = 500
    samples_per_rule: int = 5


@router.post("/preview-rules")
async def preview_rules(
    payload: PreviewRulesRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dry-run rules against a sample of the dataset — no Celery, no MinIO write.

    Returns per-rule match counts (out of the sample), label distribution,
    coverage %, and up to ``samples_per_rule`` sample matching rows for each
    rule so the user can verify the rule before running the full job.
    """
    if not payload.rules:
        raise HTTPException(status_code=400, detail="At least one rule is required")

    # Verify dataset exists + has data + caller has access.
    dataset = await assert_dataset_access(db, payload.dataset_id, current_user)
    if dataset.source_type == "image":
        raise HTTPException(status_code=400, detail="Rule labeling is not available for image datasets")

    v_stmt = (
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == payload.dataset_id)
        .order_by(DatasetVersion.version_number.desc())
        .limit(1)
    )
    version = (await db.execute(v_stmt)).scalars().first()
    if version is None:
        raise HTTPException(status_code=400, detail="Dataset has no uploaded versions yet")

    sample_size = max(1, min(payload.sample_size, 5000))
    samples_per_rule = max(0, min(payload.samples_per_rule, 25))

    # Load the head of the dataset in a thread (synchronous pandas IO).
    try:
        from data_intelligence.tasks.structuring_tasks import _load_dataset_file  # type: ignore
        import core.paths  # noqa: F401
        from labeling.rule_engine import RuleEngine

        df = await asyncio.to_thread(
            _load_dataset_file, str(payload.dataset_id), version.version_number,
        )
        sample = df.head(sample_size)

        engine = RuleEngine(conflict_strategy=payload.conflict_strategy)
        rule_dicts = [r.model_dump() for r in payload.rules]
        engine.load_rules(rule_dicts)
        labeled_df, report = engine.apply(sample, label_column="__label__")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Preview failed: {exc}")

    # Build per-rule sample rows. We re-evaluate each (already-parsed) rule
    # against the sample rows so we get up to N matching examples per rule
    # (independent of the conflict-resolution which only assigns one label).
    per_rule_samples: list[list[dict]] = []
    for rule_obj in engine.rules:
        matches: list[dict] = []
        for i in range(len(sample)):
            if len(matches) >= samples_per_rule:
                break
            try:
                if RuleEngine._evaluate_rule(rule_obj, sample, i):
                    row = sample.iloc[i].to_dict()
                    safe: dict = {}
                    for k, v in row.items():
                        try:
                            if v is None:
                                safe[str(k)] = None
                            elif isinstance(v, (int, float, bool, str)):
                                safe[str(k)] = v
                            else:
                                safe[str(k)] = str(v)
                        except Exception:  # noqa: BLE001
                            safe[str(k)] = None
                    matches.append(safe)
            except Exception:  # noqa: BLE001
                continue
        per_rule_samples.append(matches)

    return {
        "sample_size": int(len(sample)),
        "total_rows": int(len(df)),
        "report": report.to_dict(),
        "per_rule_samples": per_rule_samples,
        "columns": [str(c) for c in sample.columns],
    }


@router.get("/rules/operators")
async def list_operators(
    current_user: User = Depends(get_current_user),
):
    """List all available rule operators for the labeling engine."""
    return {
        "operators": AVAILABLE_OPERATORS,
    }


# ── Saved rule sets (Stage B) ───────────────────────────────────────────


class RuleSetCreate(BaseModel):
    name: str
    description: str = ""
    rules: list[RuleDefinition]


class RuleSetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    rules: Optional[list[RuleDefinition]] = None


@router.get("/rule-sets")
async def list_saved_rule_sets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all saved rule sets (summaries only)."""
    from labeling.rule_store import async_list_rule_sets  # type: ignore
    items = await async_list_rule_sets(db)
    return {"rule_sets": items}


@router.post("/rule-sets", status_code=status.HTTP_201_CREATED)
async def create_saved_rule_set(
    payload: RuleSetCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save a new named rule set so it can be reused on other datasets."""
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    if not payload.rules:
        raise HTTPException(status_code=400, detail="At least one rule is required")

    from labeling.rule_store import async_save_rule_set  # type: ignore
    res = await async_save_rule_set(
        db=db,
        name=payload.name.strip(),
        description=(payload.description or "").strip(),
        rules=[r.model_dump() for r in payload.rules],
    )
    return res


@router.get("/rule-sets/{rule_set_id}")
async def get_saved_rule_set(
    rule_set_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Load the full contents (including rules) of a saved rule set."""
    from labeling.rule_store import async_load_rule_set  # type: ignore
    try:
        return await async_load_rule_set(db, str(rule_set_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/rule-sets/{rule_set_id}")
async def update_saved_rule_set(
    rule_set_id: UUID,
    payload: RuleSetUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a saved rule set's name / description / rules."""
    from labeling.rule_store import async_update_rule_set  # type: ignore
    try:
        res = await async_update_rule_set(
            db=db,
            rule_set_id=str(rule_set_id),
            name=payload.name.strip() if payload.name is not None else None,
            description=(payload.description or "").strip() if payload.description is not None else None,
            rules=[r.model_dump() for r in payload.rules] if payload.rules is not None else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return res


@router.delete("/rule-sets/{rule_set_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_rule_set(
    rule_set_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a saved rule set."""
    from labeling.rule_store import async_delete_rule_set  # type: ignore
    ok = await async_delete_rule_set(db, str(rule_set_id))
    if not ok:
        raise HTTPException(status_code=404, detail="Rule set not found")
    return None


@router.get("/download/{dataset_id}")
async def download_labeling_result(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream the labeled dataset file from the latest successful labeling run."""
    await assert_dataset_access(db, dataset_id, current_user)
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "labeling",
            BackgroundTask.status == "completed",
        )
        .order_by(BackgroundTask.completed_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    task = result.scalars().first()
    if task is None or not task.result:
        raise HTTPException(
            status_code=404,
            detail="No completed labeling result found for this dataset",
        )
    path = (task.result or {}).get("labeled_file_path")
    if not path:
        raise HTTPException(
            status_code=404,
            detail="Labeled file path missing from result",
        )

    mc = get_minio_client()
    try:
        response = mc.get_object(_settings.MINIO_BUCKET_NAME, path)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve labeled file: {exc}",
        )

    filename = path.rsplit("/", 1)[-1]
    return StreamingResponse(
        response,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
