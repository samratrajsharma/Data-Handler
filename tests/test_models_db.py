"""ORM models registration (Docker/full-deps only — skipped without SQLAlchemy)."""
import pytest

pytest.importorskip("sqlalchemy")


def test_all_models_register_on_base():
    from core.models import (  # noqa: F401
        Base, Dataset, DatasetVersion, DatasetMetadata, BackgroundTask,
        ImageAsset, LLMConfigRecord, Workflow, WorkflowTemplate,
    )
    expected = {
        "datasets", "dataset_versions", "dataset_metadata", "background_tasks",
        "image_assets", "llm_configs", "workflows", "workflow_templates",
    }
    assert expected <= set(Base.metadata.tables)


def test_background_task_key_columns():
    from core.models import Base
    cols = {c.name for c in Base.metadata.tables["background_tasks"].columns}
    assert {"celery_task_id", "task_type", "status", "result", "progress"} <= cols
