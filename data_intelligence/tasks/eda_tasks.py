"""
Celery tasks for the AI-Powered EDA Agent.
Runs statistical profiling, embedding generation, and clustering as background jobs.
"""

import logging

import core.paths  # noqa: F401

from core.celery_app import app

logger = logging.getLogger(__name__)


@app.task(bind=True, name="eda.run_pipeline")
def run_eda_pipeline(
    self,
    dataset_id: str,
    version_number: int,
    run_profiling: bool = True,
    run_embeddings: bool = True,
    run_clustering: bool = True,
    n_clusters: int = 5,
):
    """Run the full EDA pipeline: profile → embed → cluster → visualise.

    Args:
        dataset_id: UUID of the dataset.
        version_number: Which version's file to process.
        run_profiling: Whether to generate statistical profiles.
        run_embeddings: Whether to generate column embeddings.
        run_clustering: Whether to run clustering analysis.
        n_clusters: Number of clusters for k-means.
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
        logger.info("EDA: Loaded dataset %s v%d: %d rows, %d cols",
                     dataset_id, version_number, len(df), len(df.columns))

        result = {}

        # ── Step 2: Statistical profiling ────────────────────────────────
        if run_profiling:
            update_task_progress(db, celery_task_id, 0.3, "Running statistical profiling...")
            from eda.profiler import profile_dataset
            profile = profile_dataset(df)
            result["profiling"] = profile.to_dict()

        # ── Step 3: Embeddings ───────────────────────────────────────────
        if run_embeddings:
            update_task_progress(db, celery_task_id, 0.5, "Generating embeddings...")
            from eda.embedder import generate_embeddings
            embeddings_report = generate_embeddings(df, dataset_id, version_number)
            result["embeddings"] = embeddings_report.to_dict()

        # ── Step 4: Clustering ───────────────────────────────────────────
        if run_clustering:
            update_task_progress(db, celery_task_id, 0.7, "Running clustering analysis...")
            from eda.clusterer import run_clustering
            cluster_report = run_clustering(df, n_clusters=n_clusters)
            result["clustering"] = cluster_report.to_dict()

        # ── Done ─────────────────────────────────────────────────────────
        update_task_progress(db, celery_task_id, 0.95, "Finalizing EDA results...")
        complete_task(db, celery_task_id, result=result)
        logger.info("EDA complete for dataset %s", dataset_id)
        return result

    except Exception as exc:
        logger.error("EDA failed for dataset %s: %s", dataset_id, exc, exc_info=True)
        complete_task(db, celery_task_id, error=str(exc))
        raise
    finally:
        db.close()
