"""
Celery tasks for the Rule-Based Labeling Engine.
Applies labeling rules to datasets as a background job.
"""

import logging

import core.paths  # noqa: F401

from core.celery_app import app

logger = logging.getLogger(__name__)


@app.task(bind=True, name="labeling.run_pipeline")
def run_labeling_pipeline(
    self,
    dataset_id: str,
    version_number: int,
    rules: list | None = None,
    rule_set_id: str | None = None,
    conflict_strategy: str = "first_match",
):
    """Apply labeling rules to a dataset.

    Args:
        dataset_id: UUID of the dataset.
        version_number: Which version's file to process.
        rules: Inline rule definitions (list of dicts).
        rule_set_id: ID of a saved rule set to apply.
        conflict_strategy: How to handle conflicts: first_match, majority, priority.
    """
    celery_task_id = self.request.id
    from core.database_sync import SyncSessionLocal
    from core.services.task_service import update_task_progress, complete_task

    db = SyncSessionLocal()

    try:
        # ── Step 1: Load data ────────────────────────────────────────────
        update_task_progress(db, celery_task_id, 0.1, "Loading dataset from storage...")

        from data_intelligence.tasks.structuring_tasks import _load_dataset_file
        df = _load_dataset_file(dataset_id, version_number)
        logger.info("Labeling: Loaded dataset %s v%d: %d rows", dataset_id, version_number, len(df))

        # ── Step 2: Load or parse rules ──────────────────────────────────
        update_task_progress(db, celery_task_id, 0.25, "Loading labeling rules...")
        from labeling.rule_engine import RuleEngine

        engine = RuleEngine(conflict_strategy=conflict_strategy)

        if rule_set_id:
            from labeling.rule_store import load_rule_set
            rule_defs = load_rule_set(db, rule_set_id)
            engine.load_rules(rule_defs)
        elif rules:
            engine.load_rules(rules)
        else:
            raise ValueError("Either 'rules' or 'rule_set_id' must be provided")

        # ── Step 3: Apply rules ──────────────────────────────────────────
        update_task_progress(db, celery_task_id, 0.5, "Applying labeling rules...")
        labeled_df, labeling_report = engine.apply(df)

        # ── Step 4: Save labeled file ────────────────────────────────────
        update_task_progress(db, celery_task_id, 0.75, "Saving labeled dataset...")

        from data_intelligence.tasks.structuring_tasks import _save_cleaned_file
        labeled_path = _save_cleaned_file(labeled_df, dataset_id, version_number, "labeled_data.csv")

        # ── Step 4b: Build per-row predictions list ──────────────────────
        # Quality evaluation and export downstream tasks read individual
        # predictions from `result["labeling"]["predictions"]`. We build that
        # list here from the labeled DataFrame so they don't need to re-read
        # the file from object storage.
        predictions: list[dict] = []
        label_col = "__label__"
        if label_col in labeled_df.columns:
            id_col = next(
                (c for c in ("id", "Id", "ID", "item_id") if c in labeled_df.columns),
                None,
            )
            for row_idx, row in labeled_df.iterrows():
                label_val = row[label_col]
                if label_val is None:
                    continue
                if id_col is not None:
                    item_id = str(row[id_col])
                else:
                    item_id = str(row_idx)
                predictions.append(
                    {
                        "item_id": item_id,
                        "label": str(label_val),
                        "confidence": 1.0,
                    }
                )

        labeling_dict = labeling_report.to_dict()
        labeling_dict["predictions"] = predictions

        # ── Done ─────────────────────────────────────────────────────────
        result = {
            "labeling": labeling_dict,
            "labeled_file_path": labeled_path,
            "total_rows": len(labeled_df),
            "labeled_rows": labeling_report.labeled_count,
            "unlabeled_rows": labeling_report.unlabeled_count,
        }

        update_task_progress(db, celery_task_id, 0.95, "Finalizing labeling results...")
        # Sanitize numpy / NaN values so PostgreSQL JSONB accepts the result.
        from data_intelligence.tasks.structuring_tasks import _json_safe
        complete_task(db, celery_task_id, result=_json_safe(result))
        logger.info("Labeling complete for dataset %s: %d/%d labeled",
                     dataset_id, labeling_report.labeled_count, len(labeled_df))
        return result

    except Exception as exc:
        logger.error("Labeling failed for dataset %s: %s", dataset_id, exc, exc_info=True)
        complete_task(db, celery_task_id, error=str(exc))
        raise
    finally:
        db.close()
