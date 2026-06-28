"""
Celery application configuration for Orchestraty.
Handles async background tasks: data structuring, EDA, labeling.
"""

from celery import Celery

from core.settings import settings

app = Celery(
    "orchestraty",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",

    # Timezone
    timezone="UTC",
    enable_utc=True,

    # Task behavior
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,

    # Result expiry (24 hours)
    result_expires=86400,

    # Auto-discover tasks in these modules
    include=[
        "data_intelligence.tasks.structuring_tasks",
        "data_intelligence.tasks.eda_tasks",
        "data_intelligence.tasks.labeling_tasks",
        "data_intelligence.tasks.image_tasks",
        "data_intelligence.tasks.ai_labeling_tasks",
        "data_intelligence.tasks.review_tasks",
        "data_intelligence.tasks.workflow_tasks",
    ],
)


# Optionally warm the CLIP model when each worker process boots, so the first
# embedding request doesn't pay the model-load cost. Off by default so that
# tabular-only users don't load a vision model into RAM (set CLIP_PRELOAD=true).
from celery.signals import worker_process_init  # noqa: E402


@worker_process_init.connect
def _warm_image_models(**_kwargs):
    try:
        if not settings.CLIP_PRELOAD:
            return
        from image_pipeline.clip_embedder import load_clip_model
        load_clip_model(settings.CLIP_MODEL_NAME)
    except Exception as exc:  # pragma: no cover - best-effort warmup
        import logging
        logging.getLogger(__name__).warning("CLIP warmup skipped: %s", exc)
