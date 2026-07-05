"""
Celery tasks for Review & Export.
Handles quality evaluation and dataset export to common ML formats.
"""

import csv
import io
import json
import logging

import core.paths  # noqa: F401

from core.celery_app import app
from core.database_sync import SyncSessionLocal
from core.services.task_service import update_task_progress, complete_task
from core.settings import settings

logger = logging.getLogger(__name__)


# ── Task 1: Quality Evaluation ────────────────────────────────────────────


@app.task(bind=True, name="review.quality_eval")
def run_quality_evaluation(
    self,
    dataset_id: str,
    expected_labels: list | None = None,
):
    """Evaluate the quality of labels for a dataset across all labeling sources."""
    celery_task_id = self.request.id
    db = SyncSessionLocal()

    try:
        # Step 1: Gather labels from all completed labeling tasks
        update_task_progress(db, celery_task_id, 0.1, "Gathering labels from completed tasks...")

        from sqlalchemy import select
        from core.models.background_task import BackgroundTask

        stmt = select(BackgroundTask).where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.status == "completed",
            BackgroundTask.task_type.in_(
                ["labeling", "ai_labeling", "aggregation", "propagation"]
            ),
        )
        result = db.execute(stmt)
        completed_tasks = result.scalars().all()

        if not completed_tasks:
            raise ValueError(
                "No completed labeling tasks found for this dataset. "
                "Run labeling first."
            )

        # Step 2: Build a unified list of label entries
        update_task_progress(db, celery_task_id, 0.3, "Building label entries...")

        labels: list[dict] = []
        all_item_ids: set[str] = set()

        for task in completed_tasks:
            task_result = task.result or {}
            source_type_map = {
                "labeling": "rule",
                "ai_labeling": "ai",
                "aggregation": "aggregation",
                "propagation": "propagation",
            }
            source_type = source_type_map.get(task.task_type, "rule")

            # Extract predictions from various result structures
            predictions = task_result.get("aggregation", {}).get("results", [])
            if not predictions:
                predictions = task_result.get("ai_labeling", {}).get("predictions", [])
            if not predictions:
                predictions = task_result.get("labeling", {}).get("predictions", [])
            if not predictions:
                predictions = task_result.get("propagation", {}).get("results", [])
            if not predictions:
                predictions = task_result.get("predictions", [])
            if not predictions:
                predictions = task_result.get("results", [])

            for pred in predictions:
                item_id = (
                    pred.get("text")
                    or pred.get("item_id")
                    or ""
                )
                label = (
                    pred.get("final_label")
                    or pred.get("predicted_label")
                    or pred.get("propagated_label")
                    or pred.get("label")
                    or ""
                )
                confidence = float(pred.get("confidence", 0.0))

                if not item_id:
                    continue

                all_item_ids.add(item_id)
                labels.append(
                    {
                        "item_id": item_id,
                        "label": label,
                        "confidence": confidence,
                        "source": source_type,
                    }
                )

        logger.info(
            "Collected %d label entries across %d items from %d tasks.",
            len(labels),
            len(all_item_ids),
            len(completed_tasks),
        )

        # Step 3: Determine total items count
        update_task_progress(db, celery_task_id, 0.5, "Computing total item count...")

        # Use the number of unique item_ids as total; if we have a dataset version
        # with a row_count that is larger, prefer that.
        total_items = len(all_item_ids)

        from core.models.dataset import DatasetVersion

        version_stmt = (
            select(DatasetVersion)
            .where(DatasetVersion.dataset_id == dataset_id)
            .order_by(DatasetVersion.version_number.desc())
            .limit(1)
        )
        version_result = db.execute(version_stmt)
        version = version_result.scalars().first()
        if version and version.row_count and version.row_count > total_items:
            total_items = version.row_count

        # Step 4: Run quality evaluation
        update_task_progress(db, celery_task_id, 0.7, "Evaluating label quality...")

        from quality.evaluator import evaluate_label_quality

        report = evaluate_label_quality(
            labels=labels,
            total_items=total_items,
            label_list=expected_labels,
        )

        # Step 5: Save results
        update_task_progress(db, celery_task_id, 0.9, "Saving quality report...")

        result_data = report.to_dict()

        complete_task(db, celery_task_id, result=result_data)
        logger.info(
            "Quality evaluation complete for dataset %s: grade %s (%.1f)",
            dataset_id,
            report.grade,
            report.overall_score,
        )
        return result_data

    except Exception as exc:
        logger.error(
            "Quality evaluation failed for dataset %s: %s",
            dataset_id,
            exc,
            exc_info=True,
        )
        complete_task(db, celery_task_id, error=str(exc))
        raise
    finally:
        db.close()


# ── Task 2: Dataset Export ────────────────────────────────────────────────


@app.task(bind=True, name="review.export")
def run_export(
    self,
    dataset_id: str,
    format: str,
    version_number: int | None = None,
):
    """Export labeled dataset to the requested format and upload to MinIO."""
    celery_task_id = self.request.id
    db = SyncSessionLocal()

    try:
        # Step 1: Load labeled data from the most recent completed tasks
        update_task_progress(db, celery_task_id, 0.1, "Loading labeled data...")

        from sqlalchemy import select
        from core.models.background_task import BackgroundTask

        # Prefer aggregation results, then fall back to other labeling results
        stmt = (
            select(BackgroundTask)
            .where(
                BackgroundTask.dataset_id == dataset_id,
                BackgroundTask.status == "completed",
                BackgroundTask.task_type.in_(
                    ["aggregation", "ai_labeling", "labeling", "propagation"]
                ),
            )
            .order_by(BackgroundTask.completed_at.desc())
        )
        result = db.execute(stmt)
        completed_tasks = result.scalars().all()

        if not completed_tasks:
            raise ValueError(
                "No completed labeling tasks found for this dataset. "
                "Run labeling first before exporting."
            )

        # Collect all labeled items, preferring the most recent task's labels
        items: dict[str, dict] = {}

        # Process in reverse chronological order so later results overwrite earlier
        for task in reversed(completed_tasks):
            task_result = task.result or {}

            predictions = task_result.get("aggregation", {}).get("results", [])
            if not predictions:
                predictions = task_result.get("ai_labeling", {}).get("predictions", [])
            if not predictions:
                predictions = task_result.get("labeling", {}).get("predictions", [])
            if not predictions:
                predictions = task_result.get("propagation", {}).get("results", [])
            if not predictions:
                predictions = task_result.get("predictions", [])
            if not predictions:
                predictions = task_result.get("results", [])

            for pred in predictions:
                item_id = (
                    pred.get("text")
                    or pred.get("item_id")
                    or ""
                )
                if not item_id:
                    continue

                label = (
                    pred.get("final_label")
                    or pred.get("predicted_label")
                    or pred.get("propagated_label")
                    or pred.get("label")
                    or ""
                )
                confidence = float(pred.get("confidence", 0.0))
                review_status = pred.get("review_status", "")

                items[item_id] = {
                    "item_id": item_id,
                    "label": label,
                    "confidence": confidence,
                    "review_status": review_status,
                }

        labeled_items = list(items.values())
        logger.info(
            "Collected %d labeled items for export (format=%s).",
            len(labeled_items),
            format,
        )

        # Step 2: Generate the export file
        update_task_progress(db, celery_task_id, 0.4, f"Generating {format} export...")

        if format == "csv":
            buf = io.StringIO()
            fieldnames = ["item_id", "label", "confidence", "review_status"]
            writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for item in labeled_items:
                writer.writerow(item)
            export_bytes = buf.getvalue().encode("utf-8")
        elif format == "json":
            export_bytes = json.dumps(labeled_items, indent=2, ensure_ascii=False).encode("utf-8")
        elif format in ("coco", "yolo"):
            raise ValueError(
                f"Export format '{format}' requires image dataset support "
                "that isn't wired into the tabular export task. Use 'csv' or 'json'."
            )
        else:
            raise ValueError(f"Unsupported export format: {format!r}")

        ext_map = {"csv": "csv", "json": "json"}
        extension = ext_map.get(format, format)
        filename = f"export_{format}.{extension}"

        # Step 3: Upload to MinIO
        update_task_progress(db, celery_task_id, 0.7, "Uploading export to storage...")

        from core.storage import get_minio_client

        client = get_minio_client()

        export_path = f"datasets/{dataset_id}/exports/{filename}"

        client.put_object(
            bucket_name=settings.MINIO_BUCKET_NAME,
            object_name=export_path,
            data=io.BytesIO(export_bytes),
            length=len(export_bytes),
            content_type="application/octet-stream",
        )

        logger.info("Uploaded export to MinIO: %s", export_path)

        # Step 4: Complete task
        update_task_progress(db, celery_task_id, 0.9, "Finalizing export...")

        result_data = {
            "export_path": export_path,
            "format": format,
            "filename": filename,
            "total_items": len(labeled_items),
            "size_bytes": len(export_bytes),
        }

        complete_task(db, celery_task_id, result=result_data)
        logger.info(
            "Export complete for dataset %s: %s (%d items, %d bytes)",
            dataset_id,
            format,
            len(labeled_items),
            len(export_bytes),
        )
        return result_data

    except Exception as exc:
        logger.error(
            "Export failed for dataset %s: %s", dataset_id, exc, exc_info=True
        )
        complete_task(db, celery_task_id, error=str(exc))
        raise
    finally:
        db.close()
