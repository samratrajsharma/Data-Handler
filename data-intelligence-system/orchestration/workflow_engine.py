"""
Workflow Engine — executes multi-step data processing pipelines as DAGs.
Each step maps to an existing pipeline operation (ingest, structure, eda, label, review, export).
"""

import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

import core.paths  # noqa: F401

logger = logging.getLogger(__name__)

# ── Known step types ──────────────────────────────────────────────────────

KNOWN_STEP_TYPES = frozenset({
    "structuring",
    "eda",
    "labeling",
    "ai_labeling",
    "image_embeddings",
    "clustering",
    "quality_eval",
    "export",
})


# ── Data classes ──────────────────────────────────────────────────────────

@dataclass
class WorkflowStep:
    """A single step within a workflow pipeline."""

    step_type: str
    name: str
    config: dict
    status: str = "pending"
    result: dict | None = None
    error: str | None = None
    started_at: str | None = None
    completed_at: str | None = None


@dataclass
class WorkflowResult:
    """Final result of an executed workflow."""

    workflow_id: str
    status: str
    steps_completed: int
    steps_total: int
    step_results: list[dict]
    error: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


# ── Validation ────────────────────────────────────────────────────────────

def validate_workflow(steps: list[dict]) -> tuple[bool, str | None]:
    """Validate that a workflow definition is well-formed.

    Args:
        steps: Ordered list of step definition dicts.

    Returns:
        (True, None) when valid, or (False, error_message) on failure.
    """
    if not steps:
        return False, "Workflow must contain at least one step."

    for idx, step in enumerate(steps):
        step_type = step.get("step_type")
        if not step_type:
            return False, f"Step {idx} is missing required field 'step_type'."
        if step_type not in KNOWN_STEP_TYPES:
            return False, (
                f"Step {idx} has unknown step_type '{step_type}'. "
                f"Allowed types: {sorted(KNOWN_STEP_TYPES)}"
            )
        if not step.get("name"):
            return False, f"Step {idx} is missing required field 'name'."
        if "config" not in step or not isinstance(step["config"], dict):
            return False, f"Step {idx} must have a 'config' dict."

    logger.info("Workflow validated successfully (%d steps)", len(steps))
    return True, None


# ── Step execution ────────────────────────────────────────────────────────

def execute_step(
    step: WorkflowStep,
    dataset_id: str,
    version_number: int,
    db_session,
    minio_client,
) -> WorkflowStep:
    """Execute a single workflow step by dispatching to the appropriate pipeline.

    Args:
        step: The WorkflowStep to execute.
        dataset_id: UUID string of the target dataset.
        version_number: Dataset version to operate on.
        db_session: Database session for persistence.
        minio_client: MinIO client for object storage.

    Returns:
        The updated WorkflowStep with status, result, and timing populated.
    """
    step.status = "running"
    step.started_at = datetime.now(timezone.utc).isoformat()
    logger.info("Executing step '%s' (type=%s) for dataset %s v%d",
                step.name, step.step_type, dataset_id, version_number)

    try:
        if step.step_type == "structuring":
            from structuring.cleaning_pipeline import run_cleaning_pipeline
            result = run_cleaning_pipeline(
                dataset_id=dataset_id,
                version_number=version_number,
                db_session=db_session,
                minio_client=minio_client,
                **step.config,
            )
            step.result = result if isinstance(result, dict) else {"output": str(result)}

        elif step.step_type == "eda":
            from eda.profiler import profile_dataframe
            result = profile_dataframe(
                dataset_id=dataset_id,
                version_number=version_number,
                db_session=db_session,
                minio_client=minio_client,
                **step.config,
            )
            step.result = result if isinstance(result, dict) else {"output": str(result)}

        elif step.step_type == "labeling":
            from labeling.rule_engine import apply_rules
            result = apply_rules(
                dataset_id=dataset_id,
                version_number=version_number,
                db_session=db_session,
                minio_client=minio_client,
                **step.config,
            )
            step.result = result if isinstance(result, dict) else {"output": str(result)}

        elif step.step_type == "ai_labeling":
            from labeling.ai_labeler import predict_labels
            result = predict_labels(
                dataset_id=dataset_id,
                version_number=version_number,
                db_session=db_session,
                minio_client=minio_client,
                **step.config,
            )
            step.result = result if isinstance(result, dict) else {"output": str(result)}

        elif step.step_type == "image_embeddings":
            from image_pipeline.clip_embedder import generate_embeddings
            result = generate_embeddings(
                dataset_id=dataset_id,
                version_number=version_number,
                db_session=db_session,
                minio_client=minio_client,
                **step.config,
            )
            step.result = result if isinstance(result, dict) else {"output": str(result)}

        elif step.step_type == "clustering":
            from image_pipeline.image_clusterer import cluster_images
            result = cluster_images(
                dataset_id=dataset_id,
                version_number=version_number,
                db_session=db_session,
                minio_client=minio_client,
                **step.config,
            )
            step.result = result if isinstance(result, dict) else {"output": str(result)}

        elif step.step_type == "quality_eval":
            from quality.evaluator import evaluate_label_quality
            result = evaluate_label_quality(
                dataset_id=dataset_id,
                version_number=version_number,
                db_session=db_session,
                minio_client=minio_client,
                **step.config,
            )
            step.result = result if isinstance(result, dict) else {"output": str(result)}

        elif step.step_type == "export":
            from quality.exporter import export_csv, export_json, export_coco
            export_format = step.config.get("format", "csv")
            output_path = step.config.get("output_path", f"/tmp/{dataset_id}_export")
            if export_format == "csv":
                result = export_csv(items=[], output_path=output_path)
            elif export_format == "json":
                result = export_json(items=[], output_path=output_path)
            elif export_format == "coco":
                result = export_coco(
                    image_items=[], output_path=output_path,
                    categories=step.config.get("categories", []),
                )
            else:
                result = export_csv(items=[], output_path=output_path)
            step.result = {"output_path": result}

        else:
            step.status = "failed"
            step.result = {"error": f"Unknown step type: {step.step_type}"}
            logger.error("Step '%s' has unknown step_type '%s'", step.name, step.step_type)
            step.completed_at = datetime.now(timezone.utc).isoformat()
            return step

        step.status = "completed"
        logger.info("Step '%s' completed successfully", step.name)

    except Exception as exc:
        step.status = "failed"
        step.error = str(exc)
        logger.error("Step '%s' failed: %s", step.name, exc, exc_info=True)

    step.completed_at = datetime.now(timezone.utc).isoformat()
    return step


# ── Default pipeline builder ──────────────────────────────────────────────

def build_default_pipeline(source_type: str = "csv") -> list[dict]:
    """Build a sensible default pipeline for the given source type.

    Args:
        source_type: One of "csv", "json", "image", etc.

    Returns:
        Ordered list of step definition dicts.
    """
    if source_type in ("csv", "json"):
        steps = [
            {
                "step_type": "structuring",
                "name": "Data Structuring",
                "config": {"null_strategy": "drop", "normalize_text": True},
            },
            {
                "step_type": "eda",
                "name": "Exploratory Data Analysis",
                "config": {},
            },
            {
                "step_type": "labeling",
                "name": "Rule-Based Labeling",
                "config": {},
            },
            {
                "step_type": "quality_eval",
                "name": "Quality Evaluation",
                "config": {},
            },
            {
                "step_type": "export",
                "name": "Export Dataset",
                "config": {"format": source_type},
            },
        ]
    elif source_type == "image":
        steps = [
            {
                "step_type": "image_embeddings",
                "name": "Generate Image Embeddings",
                "config": {},
            },
            {
                "step_type": "clustering",
                "name": "Cluster Images",
                "config": {"min_cluster_size": 5},
            },
            {
                "step_type": "quality_eval",
                "name": "Quality Evaluation",
                "config": {},
            },
            {
                "step_type": "export",
                "name": "Export Dataset",
                "config": {"format": "coco"},
            },
        ]
    else:
        logger.warning("Unknown source_type '%s', falling back to csv pipeline", source_type)
        return build_default_pipeline("csv")

    logger.info("Built default %s pipeline with %d steps", source_type, len(steps))
    return steps
