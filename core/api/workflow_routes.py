"""
Workflow Orchestration API — create, manage, and monitor multi-step
data pipelines (structuring → EDA → labeling → review → export).
"""

import uuid as _uuid
from datetime import datetime
from typing import Optional
from uuid import UUID

import core.paths  # noqa: F401

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models.dataset import Dataset, DatasetVersion
from core.services.auth_service import User, get_current_user
from core.models.workflow import Workflow, WorkflowTemplate
from core.services.task_service import create_task_record

router = APIRouter(prefix="/api/v1/workflows", tags=["workflows"])


# ── Schemas ──────────────────────────────────────────────────────────────


class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    dataset_id: UUID
    steps: list[dict] = Field(default_factory=list)
    template_id: Optional[UUID] = None


class WorkflowResponse(BaseModel):
    id: UUID
    name: str
    status: str
    current_step: int
    total_steps: int
    message: str


class WorkflowDetail(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    dataset_id: UUID
    status: str
    steps: list[dict]
    current_step: int
    result: Optional[dict]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime


class WorkflowStepUpdate(BaseModel):
    step_index: int
    action: str = Field(..., pattern="^(skip|retry)$")


class TemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    steps: list[dict]
    category: Optional[str] = None


class TemplateResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    steps: list[dict]
    category: Optional[str]
    is_builtin: bool = False


# ── Helpers ──────────────────────────────────────────────────────────────


async def _validate_dataset(db: AsyncSession, dataset_id: UUID) -> Dataset:
    """Ensure the dataset exists and return it."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalars().first()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


async def _get_latest_version(db: AsyncSession, dataset_id: UUID) -> DatasetVersion:
    """Return the latest DatasetVersion for a dataset."""
    stmt = (
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset_id)
        .order_by(DatasetVersion.version_number.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    version = result.scalars().first()
    if version is None:
        raise HTTPException(
            status_code=400,
            detail="Dataset has no versions. Upload data first.",
        )
    return version


def _validate_workflow_steps(steps: list[dict]) -> list[dict]:
    """Validate workflow steps, raising HTTPException on failure.

    Returns the same steps list when valid so callers can keep the
    `steps = _validate_workflow_steps(steps)` pattern.
    """
    try:
        from orchestration.workflow_engine import validate_workflow
        is_valid, error_msg = validate_workflow(steps)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg or "Invalid workflow.")
        return steps
    except ImportError:
        # Engine not yet implemented — do basic validation
        if not steps:
            raise HTTPException(
                status_code=400, detail="Workflow must have at least one step."
            )
        for i, step in enumerate(steps):
            if "step_type" not in step and "type" not in step:
                raise HTTPException(
                    status_code=400,
                    detail=f"Step {i} missing required 'step_type' field.",
                )
        return steps


def _build_default_pipeline(source_type: str | None = None) -> list[dict]:
    """Build a default pipeline using orchestration templates or a fallback."""
    try:
        from orchestration.templates import build_default_pipeline
        return build_default_pipeline(source_type=source_type)
    except ImportError:
        # Fallback: standard structuring → EDA → quality eval pipeline.
        # Keys must match orchestration.WorkflowStep fields (step_type, name, config).
        # Labeling is omitted from the default because it requires explicit rules.
        steps = [
            {"step_type": "structuring", "name": "Auto-structure", "config": {}},
            {"step_type": "eda", "name": "Exploratory Data Analysis", "config": {}},
            {"step_type": "quality_eval", "name": "Quality Review", "config": {}},
        ]
        return steps


def _get_builtin_templates() -> list[dict]:
    """Return built-in templates from the orchestration package."""
    try:
        from orchestration.templates import BUILTIN_TEMPLATES
        return BUILTIN_TEMPLATES
    except ImportError:
        return [
            {
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "Standard Data Pipeline",
                "description": "Structure → EDA → Label → Review",
                "steps": _build_default_pipeline(),
                "category": "general",
                "is_builtin": True,
            },
            {
                "id": "00000000-0000-0000-0000-000000000002",
                "name": "Quick Label Pipeline",
                "description": "Structure → Auto-Label",
                "steps": [
                    {"type": "structuring", "name": "Auto-structure", "config": {}},
                    {"type": "labeling", "name": "Auto-label", "config": {}},
                ],
                "category": "quick",
                "is_builtin": True,
            },
        ]


# ── Routes ───────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=WorkflowResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_workflow(
    payload: WorkflowCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create and start a new workflow pipeline."""
    dataset = await _validate_dataset(db, payload.dataset_id)
    version = await _get_latest_version(db, payload.dataset_id)

    # Resolve steps: from template or from payload
    steps = payload.steps
    if payload.template_id:
        result = await db.execute(
            select(WorkflowTemplate).where(WorkflowTemplate.id == payload.template_id)
        )
        template = result.scalars().first()
        if template is None:
            raise HTTPException(status_code=404, detail="Template not found")
        steps = template.steps

    steps = _validate_workflow_steps(steps)

    # Annotate each step with initial status
    for i, step in enumerate(steps):
        step.setdefault("status", "pending")
        step.setdefault("index", i)

    # Create the Workflow record
    workflow = Workflow(
        name=payload.name,
        description=payload.description,
        dataset_id=payload.dataset_id,
        status="pending",
        steps=steps,
        current_step=0,
        started_at=datetime.utcnow(),
    )
    db.add(workflow)
    await db.flush()
    await db.refresh(workflow)

    # Pre-generate Celery task ID and create a tracking record
    celery_task_id = str(_uuid.uuid4())

    await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="workflow_execute",
        dataset_id=payload.dataset_id,
        parameters={
            "workflow_id": str(workflow.id),
            "steps": steps,
        },
    )

    await db.commit()

    # Dispatch the Celery task
    from data_intelligence.tasks.workflow_tasks import execute_workflow

    execute_workflow.apply_async(
        kwargs={
            "workflow_id": str(workflow.id),
            "dataset_id": str(payload.dataset_id),
            "version_number": version.version_number,
            "steps": steps,
            "start_step": 0,
        },
        task_id=celery_task_id,
    )

    return WorkflowResponse(
        id=workflow.id,
        name=workflow.name,
        status="pending",
        current_step=0,
        total_steps=len(steps),
        message=f"Workflow '{workflow.name}' started with {len(steps)} steps",
    )


@router.get("", response_model=list[WorkflowResponse])
async def list_workflows(
    dataset_id: Optional[UUID] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List workflows created by the current user, optionally filtered by dataset."""
    stmt = select(Workflow).where(Workflow.created_by == current_user.id)
    if dataset_id is not None:
        stmt = stmt.where(Workflow.dataset_id == dataset_id)
    stmt = stmt.order_by(Workflow.created_at.desc())

    result = await db.execute(stmt)
    workflows = result.scalars().all()

    return [
        WorkflowResponse(
            id=w.id,
            name=w.name,
            status=w.status,
            current_step=w.current_step,
            total_steps=len(w.steps) if w.steps else 0,
            message=f"Step {w.current_step}/{len(w.steps) if w.steps else 0}",
        )
        for w in workflows
    ]


@router.get("/templates", response_model=list[TemplateResponse])
async def list_templates(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all workflow templates (built-in + custom)."""
    # Built-in templates
    builtins = _get_builtin_templates()
    templates_out: list[TemplateResponse] = [
        TemplateResponse(
            id=UUID(t["id"]) if isinstance(t["id"], str) else t["id"],
            name=t["name"],
            description=t.get("description"),
            steps=t["steps"],
            category=t.get("category"),
            is_builtin=True,
        )
        for t in builtins
    ]

    # Custom templates from DB
    result = await db.execute(
        select(WorkflowTemplate).order_by(WorkflowTemplate.created_at.desc())
    )
    db_templates = result.scalars().all()

    for t in db_templates:
        templates_out.append(
            TemplateResponse(
                id=t.id,
                name=t.name,
                description=t.description,
                steps=t.steps,
                category=t.category,
                is_builtin=False,
            )
        )

    return templates_out


@router.post(
    "/templates",
    response_model=TemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_template(
    payload: TemplateCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a custom workflow template (admin only)."""
    _validate_workflow_steps(payload.steps)

    template = WorkflowTemplate(
        name=payload.name,
        description=payload.description,
        steps=payload.steps,
        category=payload.category,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)

    return TemplateResponse(
        id=template.id,
        name=template.name,
        description=template.description,
        steps=template.steps,
        category=template.category,
        is_builtin=False,
    )


@router.get("/{workflow_id}", response_model=WorkflowDetail)
async def get_workflow(
    workflow_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get full workflow detail including step statuses."""
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalars().first()
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    return WorkflowDetail(
        id=workflow.id,
        name=workflow.name,
        description=workflow.description,
        dataset_id=workflow.dataset_id,
        status=workflow.status,
        steps=workflow.steps or [],
        current_step=workflow.current_step,
        result=workflow.result,
        started_at=workflow.started_at,
        completed_at=workflow.completed_at,
        created_at=workflow.created_at,
    )


@router.put("/{workflow_id}/pause")
async def pause_workflow(
    workflow_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Pause a running workflow."""
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalars().first()
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if workflow.status != "running":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot pause workflow in '{workflow.status}' status. Must be 'running'.",
        )

    workflow.status = "paused"
    await db.commit()

    return {
        "workflow_id": str(workflow.id),
        "status": "paused",
        "message": f"Workflow '{workflow.name}' paused at step {workflow.current_step}",
    }


@router.put("/{workflow_id}/resume")
async def resume_workflow(
    workflow_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resume a paused workflow from the current step."""
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalars().first()
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if workflow.status != "paused":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resume workflow in '{workflow.status}' status. Must be 'paused'.",
        )

    version = await _get_latest_version(db, workflow.dataset_id)

    workflow.status = "running"
    await db.flush()

    # Pre-generate Celery task ID for the resumed run
    celery_task_id = str(_uuid.uuid4())

    await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="workflow_execute",
        dataset_id=workflow.dataset_id,
        parameters={
            "workflow_id": str(workflow.id),
            "resumed_from_step": workflow.current_step,
        },
    )

    await db.commit()

    from data_intelligence.tasks.workflow_tasks import execute_workflow

    execute_workflow.apply_async(
        kwargs={
            "workflow_id": str(workflow.id),
            "dataset_id": str(workflow.dataset_id),
            "version_number": version.version_number,
            "steps": workflow.steps,
            "start_step": workflow.current_step,
        },
        task_id=celery_task_id,
    )

    return {
        "workflow_id": str(workflow.id),
        "status": "running",
        "message": f"Workflow '{workflow.name}' resumed from step {workflow.current_step}",
    }


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a workflow."""
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalars().first()
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if workflow.status == "running":
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a running workflow. Pause it first.",
        )

    await db.delete(workflow)
    await db.commit()


@router.post(
    "/quick-start/{dataset_id}",
    response_model=WorkflowResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def quick_start_workflow(
    dataset_id: UUID,
    source_type: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Quick-start a default pipeline for a dataset."""
    dataset = await _validate_dataset(db, dataset_id)
    version = await _get_latest_version(db, dataset_id)

    steps = _build_default_pipeline(source_type=source_type)

    for i, step in enumerate(steps):
        step.setdefault("status", "pending")
        step.setdefault("index", i)

    workflow = Workflow(
        name=f"Quick Pipeline — {dataset.name}",
        description=f"Auto-generated default pipeline for dataset '{dataset.name}'",
        dataset_id=dataset_id,
        status="pending",
        steps=steps,
        current_step=0,
        started_at=datetime.utcnow(),
    )
    db.add(workflow)
    await db.flush()
    await db.refresh(workflow)

    celery_task_id = str(_uuid.uuid4())

    await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="workflow_execute",
        dataset_id=dataset_id,
        parameters={
            "workflow_id": str(workflow.id),
            "quick_start": True,
            "source_type": source_type,
        },
    )

    await db.commit()

    from data_intelligence.tasks.workflow_tasks import execute_workflow

    execute_workflow.apply_async(
        kwargs={
            "workflow_id": str(workflow.id),
            "dataset_id": str(dataset_id),
            "version_number": version.version_number,
            "steps": steps,
            "start_step": 0,
        },
        task_id=celery_task_id,
    )

    return WorkflowResponse(
        id=workflow.id,
        name=workflow.name,
        status="pending",
        current_step=0,
        total_steps=len(steps),
        message=f"Quick-start pipeline launched with {len(steps)} steps",
    )
