"""
Celery tasks for AI-Powered Labeling.
Handles AI prediction, image labeling, similarity propagation, and label aggregation.
"""

import base64
import io
import logging

import core.paths  # noqa: F401

from core.celery_app import app
from core.database_sync import SyncSessionLocal
from core.services.task_service import update_task_progress, complete_task

logger = logging.getLogger(__name__)


def _build_llm_config(provider, model_name, api_key_encrypted, base_url, temperature, max_tokens):
    """Reconstruct an LLMConfig from individual parameters passed via Celery."""
    from core.llm.providers import LLMConfig, LLMProvider

    return LLMConfig(
        provider=LLMProvider(provider),
        model_name=model_name,
        api_key=api_key_encrypted,
        base_url=base_url,
        temperature=temperature,
        max_tokens=max_tokens,
    )


# ── Task 1: AI Text Label Prediction ────────────────────────────────────


@app.task(bind=True, name="ai_labeling.predict")
def predict_labels(
    self,
    dataset_id: str,
    version_number: int,
    labels: list,
    text_column: str = "text",
    provider: str = None,
    model_name: str = None,
    api_key_encrypted: str = None,
    base_url: str = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    examples: list = None,
    instructions: str = None,
):
    """Predict labels for text items in a dataset using the configured LLM."""
    celery_task_id = self.request.id
    db = SyncSessionLocal()

    try:
        # Step 1: Load dataset
        update_task_progress(db, celery_task_id, 0.1, "Loading dataset from storage...")

        from data_intelligence.tasks.structuring_tasks import _load_dataset_file

        df = _load_dataset_file(dataset_id, version_number)
        logger.info(
            "AI labeling: Loaded dataset %s v%d: %d rows",
            dataset_id, version_number, len(df),
        )

        # Step 2: Extract text column
        update_task_progress(db, celery_task_id, 0.2, "Extracting text column...")

        if text_column not in df.columns:
            raise ValueError(
                f"Column '{text_column}' not found in dataset. "
                f"Available columns: {list(df.columns)}"
            )

        texts = df[text_column].dropna().astype(str).tolist()
        logger.info("Extracted %d text items from column '%s'.", len(texts), text_column)

        # Step 3: Build LLM config and run predictions
        update_task_progress(
            db, celery_task_id, 0.3,
            f"Predicting labels for {len(texts)} rows...",
        )

        config = _build_llm_config(
            provider, model_name, api_key_encrypted, base_url, temperature, max_tokens
        )

        from labeling.ai_labeler import predict_text_labels

        # Wire a progress callback so the UI's progress bar moves smoothly
        # from 30% to 90% as rows complete. Without this, the bar would
        # freeze for the entire prediction loop and users assume the job
        # is hung. The callback fires every `batch_size` items (default 10).
        def _on_progress(done: int, total: int, eta_seconds: float):
            # Linearly map item progress (0..total) onto task progress (0.3..0.9).
            frac = done / max(1, total)
            task_frac = 0.3 + (0.6 * frac)
            eta_msg = ""
            if eta_seconds and eta_seconds > 0:
                if eta_seconds < 60:
                    eta_msg = f" (~{int(eta_seconds)}s left)"
                else:
                    eta_msg = f" (~{int(eta_seconds / 60)}m left)"
            try:
                update_task_progress(
                    db, celery_task_id, task_frac,
                    f"Predicting labels: {done:,} / {total:,} done{eta_msg}",
                )
            except Exception:  # noqa: BLE001
                pass  # don't let a DB blip kill the prediction job

        report = predict_text_labels(
            texts, labels, config,
            examples=examples, instructions=instructions,
            concurrency=5,
            progress_callback=_on_progress,
        )

        # Step 4: Save results
        update_task_progress(db, celery_task_id, 0.9, "Saving prediction results...")

        result = {
            "ai_labeling": report.to_dict(),
            "total_items": report.total_items,
            "labeled_count": report.labeled_count,
            "avg_confidence": report.avg_confidence,
            "model_used": report.model_used,
            "provider": report.provider,
        }

        complete_task(db, celery_task_id, result=result)
        logger.info(
            "AI labeling complete for dataset %s: %d/%d labeled, avg confidence=%.3f",
            dataset_id, report.labeled_count, report.total_items, report.avg_confidence,
        )
        return result

    except Exception as exc:
        logger.error("AI labeling failed for dataset %s: %s", dataset_id, exc, exc_info=True)
        complete_task(db, celery_task_id, error=str(exc))
        raise
    finally:
        db.close()


# ── Task 2: AI Image Label Prediction ───────────────────────────────────


@app.task(bind=True, name="ai_labeling.predict_images")
def predict_image_labels_task(
    self,
    dataset_id: str,
    labels: list,
    provider: str = None,
    model_name: str = None,
    api_key_encrypted: str = None,
    base_url: str = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
):
    """Predict labels for images in a dataset using the configured LLM."""
    celery_task_id = self.request.id
    db = SyncSessionLocal()

    try:
        # Step 1: Query image assets
        update_task_progress(db, celery_task_id, 0.1, "Loading image assets...")

        from sqlalchemy import select
        from core.models.image_asset import ImageAsset

        stmt = select(ImageAsset).where(ImageAsset.dataset_id == dataset_id)
        result = db.execute(stmt)
        images = result.scalars().all()

        if not images:
            raise ValueError(f"No images found for dataset {dataset_id}")

        logger.info("Found %d images for dataset %s.", len(images), dataset_id)

        # Step 2: Download images from MinIO and encode as base64
        update_task_progress(db, celery_task_id, 0.2, "Downloading images from storage...")

        from core.settings import settings
        from core.storage import get_minio_client

        client = get_minio_client()

        base64_list = []
        mime_types = []
        valid_images = []

        for img in images:
            try:
                response = client.get_object(settings.MINIO_BUCKET_NAME, img.original_path)
                raw_bytes = response.read()
                response.close()
                response.release_conn()

                b64 = base64.b64encode(raw_bytes).decode("utf-8")
                base64_list.append(b64)
                mime_types.append(img.mime_type or "image/png")
                valid_images.append(img)
            except Exception as exc:
                logger.warning(
                    "Failed to download image %s: %s", img.file_name, exc
                )

        if not base64_list:
            raise ValueError("Could not download any images from storage")

        logger.info("Downloaded %d images for classification.", len(base64_list))

        # Step 3: Run AI image classification
        update_task_progress(db, celery_task_id, 0.4, "Running AI image label predictions...")

        config = _build_llm_config(
            provider, model_name, api_key_encrypted, base_url, temperature, max_tokens
        )

        from labeling.ai_labeler import predict_image_labels

        report = predict_image_labels(base64_list, labels, config, mime_types=mime_types)

        # Step 4: Save results
        update_task_progress(db, celery_task_id, 0.9, "Saving prediction results...")

        result = {
            "ai_labeling": report.to_dict(),
            "total_items": report.total_items,
            "labeled_count": report.labeled_count,
            "avg_confidence": report.avg_confidence,
            "model_used": report.model_used,
            "provider": report.provider,
        }

        complete_task(db, celery_task_id, result=result)
        logger.info(
            "AI image labeling complete for dataset %s: %d/%d labeled",
            dataset_id, report.labeled_count, report.total_items,
        )
        return result

    except Exception as exc:
        logger.error(
            "AI image labeling failed for dataset %s: %s", dataset_id, exc, exc_info=True
        )
        complete_task(db, celery_task_id, error=str(exc))
        raise
    finally:
        db.close()


# ── Task 3: Similarity-Based Label Propagation ──────────────────────────


@app.task(bind=True, name="ai_labeling.propagate")
def propagate_labels_task(
    self,
    dataset_id: str,
    labels: list,
    confidence_threshold: float = 0.7,
    top_k: int = 5,
):
    """Propagate labels from labeled to unlabeled items via vector similarity."""
    celery_task_id = self.request.id
    db = SyncSessionLocal()

    try:
        # Step 1: Gather existing labels from completed tasks
        update_task_progress(db, celery_task_id, 0.1, "Gathering existing labels...")

        from sqlalchemy import select
        from core.models.background_task import BackgroundTask

        stmt = select(BackgroundTask).where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.status == "completed",
            BackgroundTask.task_type.in_(["labeling", "ai_labeling"]),
        )
        result = db.execute(stmt)
        completed_tasks = result.scalars().all()

        # Build labeled_items and collect all item IDs
        labeled_items = []
        labeled_ids = set()

        for task in completed_tasks:
            task_result = task.result or {}
            predictions = task_result.get("ai_labeling", {}).get("predictions", [])
            if not predictions:
                predictions = task_result.get("labeling", {}).get("predictions", [])
            if not predictions:
                predictions = task_result.get("predictions", [])

            for pred in predictions:
                item_id = pred.get("text") or pred.get("item_id") or ""
                label = pred.get("predicted_label") or pred.get("label") or ""
                if item_id and label:
                    labeled_items.append({"id": item_id, "label": label})
                    labeled_ids.add(item_id)

        logger.info("Found %d labeled items from previous tasks.", len(labeled_items))

        # Step 2: Determine unlabeled IDs
        update_task_progress(db, celery_task_id, 0.3, "Identifying unlabeled items...")

        # The collection name follows the dataset ID convention
        collection_name = f"dataset_{dataset_id}"

        # Query Qdrant for all point IDs in this collection
        from core.settings import settings

        try:
            from qdrant_client import QdrantClient

            qdrant = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)
            collection_info = qdrant.get_collection(collection_name)
            total_points = collection_info.points_count or 0

            # Scroll through all points to get IDs
            all_ids = set()
            offset = None
            while True:
                points, next_offset = qdrant.scroll(
                    collection_name=collection_name,
                    limit=1000,
                    offset=offset,
                    with_payload=False,
                    with_vectors=False,
                )
                for pt in points:
                    all_ids.add(str(pt.id))
                if next_offset is None:
                    break
                offset = next_offset

            unlabeled_ids = [uid for uid in all_ids if uid not in labeled_ids]
        except Exception as exc:
            logger.warning("Could not query Qdrant for unlabeled IDs: %s", exc)
            unlabeled_ids = []

        logger.info("Found %d unlabeled items for propagation.", len(unlabeled_ids))

        # Step 3: Run propagation
        update_task_progress(db, celery_task_id, 0.5, "Running label propagation...")

        from labeling.similarity_propagator import propagate_labels

        report = propagate_labels(
            labeled_items=labeled_items,
            unlabeled_ids=unlabeled_ids,
            collection_name=collection_name,
            confidence_threshold=confidence_threshold,
            top_k=top_k,
        )

        # Step 4: Save results
        update_task_progress(db, celery_task_id, 0.9, "Saving propagation results...")

        result_data = {
            "propagation": report.to_dict(),
            "total_unlabeled": report.total_unlabeled,
            "propagated_count": report.propagated_count,
            "skipped_count": report.skipped_count,
        }

        complete_task(db, celery_task_id, result=result_data)
        logger.info(
            "Label propagation complete for dataset %s: %d/%d propagated",
            dataset_id, report.propagated_count, report.total_unlabeled,
        )
        return result_data

    except Exception as exc:
        logger.error(
            "Label propagation failed for dataset %s: %s", dataset_id, exc, exc_info=True
        )
        complete_task(db, celery_task_id, error=str(exc))
        raise
    finally:
        db.close()


# ── Task 4: Label Aggregation ───────────────────────────────────────────


@app.task(bind=True, name="ai_labeling.aggregate")
def aggregate_labels_task(
    self,
    dataset_id: str,
    strategy: str = "confidence_weighted",
    include_rules: bool = True,
    include_ai: bool = True,
    include_propagated: bool = True,
):
    """Aggregate labels from all sources into a single label per item."""
    celery_task_id = self.request.id
    db = SyncSessionLocal()

    try:
        # Step 1: Gather labels from all sources
        update_task_progress(db, celery_task_id, 0.1, "Gathering labels from all sources...")

        from sqlalchemy import select
        from core.models.background_task import BackgroundTask

        # Build the task type filter based on include flags
        included_types = []
        if include_rules:
            included_types.append("labeling")
        if include_ai:
            included_types.append("ai_labeling")
        if include_propagated:
            included_types.append("propagation")

        if not included_types:
            raise ValueError("At least one label source must be included.")

        stmt = select(BackgroundTask).where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.status == "completed",
            BackgroundTask.task_type.in_(included_types),
        )
        result = db.execute(stmt)
        completed_tasks = result.scalars().all()

        if not completed_tasks:
            raise ValueError(
                "No completed labeling tasks found for this dataset. "
                "Run labeling first."
            )

        # Step 2: Build item_labels mapping
        update_task_progress(db, celery_task_id, 0.3, "Building label mappings...")

        from labeling.label_aggregator import LabelSource, aggregate_labels

        item_labels: dict[str, list[LabelSource]] = {}

        for task in completed_tasks:
            task_result = task.result or {}
            source_type_map = {
                "labeling": "rule",
                "ai_labeling": "ai",
                "propagation": "propagation",
            }
            source_type = source_type_map.get(task.task_type, "rule")

            # Extract predictions based on the result structure
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
                    pred.get("predicted_label")
                    or pred.get("propagated_label")
                    or pred.get("label")
                    or ""
                )
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
                        metadata={"task_id": str(task.id)},
                    )
                )

        logger.info(
            "Collected labels for %d items from %d tasks.",
            len(item_labels), len(completed_tasks),
        )

        # Step 3: Run aggregation
        update_task_progress(db, celery_task_id, 0.6, "Aggregating labels...")

        report = aggregate_labels(item_labels, strategy=strategy)

        # Step 4: Save results
        update_task_progress(db, celery_task_id, 0.9, "Saving aggregation results...")

        result_data = {
            "aggregation": report.to_dict(),
            "total_items": report.total_items,
            "labeled_count": report.labeled_count,
            "multi_source_count": report.multi_source_count,
            "conflict_count": report.conflict_count,
            "label_distribution": report.label_distribution,
        }

        complete_task(db, celery_task_id, result=result_data)
        logger.info(
            "Label aggregation complete for dataset %s: %d items, %d conflicts",
            dataset_id, report.labeled_count, report.conflict_count,
        )
        return result_data

    except Exception as exc:
        logger.error(
            "Label aggregation failed for dataset %s: %s", dataset_id, exc, exc_info=True
        )
        complete_task(db, celery_task_id, error=str(exc))
        raise
    finally:
        db.close()
