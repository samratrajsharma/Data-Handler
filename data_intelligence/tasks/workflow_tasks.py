"""
Celery task for Workflow Orchestration.
Executes multi-step data pipelines (structuring → EDA → labeling → review).
"""

import copy
import logging
from datetime import datetime

import core.paths  # noqa: F401

from core.celery_app import app
from core.database_sync import SyncSessionLocal
from core.services.task_service import update_task_progress, complete_task

logger = logging.getLogger(__name__)


def _execute_step(step: dict, dataset_id: str, version_number: int) -> dict:
    """Execute a single workflow step via the Celery-backed pipelines.

    Dispatches directly to the same Celery tasks the API uses
    (run_structuring, run_eda, run_labeling, run_quality_evaluation, …).
    The orchestration.workflow_engine module is not used here because
    its `execute_step` signature requires a live db_session and minio_client
    that aren't available inside a Celery worker context.

    Returns the step dict updated with status and result.
    """
    step_type = step.get("step_type") or step.get("type") or "unknown"
    step_config = step.get("config", {}) or {}

    logger.info(
        "Executing step '%s' (type=%s) for dataset %s v%d",
        step.get("name", step_type),
        step_type,
        dataset_id,
        version_number,
    )

    result = {"type": step_type, "status": "completed"}

    try:
        if step_type == "structuring":
            from data_intelligence.tasks.structuring_tasks import run_structuring_pipeline
            run_structuring_pipeline.apply(
                kwargs={
                    "dataset_id": dataset_id,
                    "version_number": version_number,
                    **step_config,
                },
            ).get(timeout=3600, disable_sync_subtasks=False)
            result["message"] = "Structuring completed"

        elif step_type == "eda":
            from data_intelligence.tasks.eda_tasks import run_eda_pipeline
            run_eda_pipeline.apply(
                kwargs={
                    "dataset_id": dataset_id,
                    "version_number": version_number,
                    **step_config,
                },
            ).get(timeout=3600, disable_sync_subtasks=False)
            result["message"] = "EDA completed"

        elif step_type == "labeling":
            from data_intelligence.tasks.labeling_tasks import run_labeling_pipeline
            # Labeling needs rules — skip when caller didn't provide any
            # rather than crashing the whole workflow.
            if not step_config.get("rules") and not step_config.get("rule_set_id"):
                result["status"] = "skipped"
                result["message"] = "No rules/rule_set_id supplied — labeling step skipped"
            else:
                run_labeling_pipeline.apply(
                    kwargs={
                        "dataset_id": dataset_id,
                        "version_number": version_number,
                        **step_config,
                    },
                ).get(timeout=3600, disable_sync_subtasks=False)
                result["message"] = "Labeling completed"

        elif step_type == "ai_labeling":
            from data_intelligence.tasks.ai_labeling_tasks import predict_labels
            predict_labels.apply(
                kwargs={
                    "dataset_id": dataset_id,
                    "version_number": version_number,
                    **step_config,
                },
            ).get(timeout=3600, disable_sync_subtasks=False)
            result["message"] = "AI labeling completed"

        elif step_type in ("review", "quality_eval"):
            from data_intelligence.tasks.review_tasks import run_quality_evaluation
            run_quality_evaluation.apply(
                kwargs={
                    "dataset_id": dataset_id,
                    **step_config,
                },
            ).get(timeout=3600, disable_sync_subtasks=False)
            result["message"] = "Quality review completed"

        elif step_type == "export":
            from data_intelligence.tasks.review_tasks import run_export
            export_format = step_config.get("format", "json")
            run_export.apply(
                kwargs={
                    "dataset_id": dataset_id,
                    "format": export_format,
                },
            ).get(timeout=3600, disable_sync_subtasks=False)
            result["message"] = f"Export ({export_format}) completed"

        elif step_type in ("image_embeddings", "clustering"):
            # Image pipeline steps are stubbed for tabular workflows.
            result["status"] = "skipped"
            result["message"] = f"Step '{step_type}' is not yet wired into the workflow runner — skipped"

        else:
            result["status"] = "skipped"
            result["message"] = f"Unknown step type '{step_type}' — skipped"

    except Exception as exc:
        result["status"] = "failed"
        result["message"] = str(exc)
        raise

    return result


# ── Celery Task ──────────────────────────────────────────────────────────


@app.task(bind=True, name="workflow.execute")
def execute_workflow(
    self,
    workflow_id: str,
    dataset_id: str,
    version_number: int,
    steps: list[dict],
    start_step: int = 0,
):
    """Execute a multi-step workflow pipeline.

    Iterates through each step, updating DB progress as it goes.
    Supports pause (checks status before each step) and resume
    (via start_step parameter).
    """
    celery_task_id = self.request.id
    db = SyncSessionLocal()

    try:
        from sqlalchemy import select as sa_select, update as sa_update
        from core.models.workflow import Workflow

        # Mark workflow as running
        db.execute(
            sa_update(Workflow)
            .where(Workflow.id == workflow_id)
            .values(status="running", started_at=datetime.utcnow())
        )
        db.commit()

        update_task_progress(
            db, celery_task_id, 0.0,
            f"Starting workflow from step {start_step}",
        )

        total_steps = len(steps)
        step_results: list[dict] = []

        for i in range(start_step, total_steps):
            # Check if workflow is still running (might have been paused)
            result = db.execute(
                sa_select(Workflow.status).where(Workflow.id == workflow_id)
            )
            current_status = result.scalar_one_or_none()

            if current_status == "paused":
                logger.info(
                    "Workflow %s paused at step %d/%d", workflow_id, i, total_steps
                )
                update_task_progress(
                    db, celery_task_id,
                    i / total_steps,
                    f"Paused at step {i}/{total_steps}",
                    status="paused",
                )
                return {
                    "workflow_id": workflow_id,
                    "status": "paused",
                    "paused_at_step": i,
                }

            if current_status not in ("running", "pending"):
                logger.warning(
                    "Workflow %s in unexpected status '%s' — aborting",
                    workflow_id, current_status,
                )
                return {
                    "workflow_id": workflow_id,
                    "status": current_status,
                    "aborted_at_step": i,
                }

            step = copy.deepcopy(steps[i])
            step_name = step.get("name", step.get("type", f"step-{i}"))

            progress = i / total_steps
            update_task_progress(
                db, celery_task_id, progress,
                f"Running step {i + 1}/{total_steps}: {step_name}",
            )

            # Update current_step and mark step as running in DB
            steps_copy = copy.deepcopy(steps)
            steps_copy[i]["status"] = "running"
            db.execute(
                sa_update(Workflow)
                .where(Workflow.id == workflow_id)
                .values(current_step=i, steps=steps_copy)
            )
            db.commit()

            try:
                step_result = _execute_step(step, dataset_id, version_number)
                step_results.append(step_result)

                # Mark step completed in steps array
                steps_copy[i]["status"] = "completed"
                steps_copy[i]["result"] = step_result
                db.execute(
                    sa_update(Workflow)
                    .where(Workflow.id == workflow_id)
                    .values(steps=steps_copy)
                )
                db.commit()

                # Update local steps reference for next iteration
                steps = steps_copy

            except Exception as step_exc:
                logger.error(
                    "Workflow %s failed at step %d (%s): %s",
                    workflow_id, i, step_name, step_exc,
                    exc_info=True,
                )

                steps_copy[i]["status"] = "failed"
                steps_copy[i]["error"] = str(step_exc)

                db.execute(
                    sa_update(Workflow)
                    .where(Workflow.id == workflow_id)
                    .values(
                        status="failed",
                        current_step=i,
                        steps=steps_copy,
                        result={
                            "failed_step": i,
                            "error": str(step_exc),
                            "completed_steps": step_results,
                        },
                    )
                )
                db.commit()

                complete_task(
                    db, celery_task_id,
                    error=f"Failed at step {i} ({step_name}): {step_exc}",
                )
                return {
                    "workflow_id": workflow_id,
                    "status": "failed",
                    "failed_step": i,
                    "error": str(step_exc),
                }

        # All steps completed successfully
        final_result = {
            "workflow_id": workflow_id,
            "status": "completed",
            "total_steps": total_steps,
            "step_results": step_results,
        }

        db.execute(
            sa_update(Workflow)
            .where(Workflow.id == workflow_id)
            .values(
                status="completed",
                current_step=total_steps,
                completed_at=datetime.utcnow(),
                result=final_result,
            )
        )
        db.commit()

        complete_task(db, celery_task_id, result=final_result)

        logger.info(
            "Workflow %s completed: %d steps executed successfully",
            workflow_id, total_steps,
        )
        return final_result

    except Exception as exc:
        logger.error(
            "Workflow %s failed unexpectedly: %s",
            workflow_id, exc, exc_info=True,
        )

        try:
            from sqlalchemy import update as sa_update
            from core.models.workflow import Workflow

            db.execute(
                sa_update(Workflow)
                .where(Workflow.id == workflow_id)
                .values(status="failed")
            )
            db.commit()
        except Exception:
            pass

        complete_task(db, celery_task_id, error=str(exc))
        raise
    finally:
        db.close()
