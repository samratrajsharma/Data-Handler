"""
ORM models package.

Re-exports the shared declarative ``Base`` (defined in ``core.database``) and
every model class. Importing this package registers all tables on
``Base.metadata`` so ``init_db()``'s ``create_all`` builds the full schema.
"""
from core.database import Base
from core.models.dataset import Dataset, DatasetVersion, DatasetMetadata
from core.models.background_task import BackgroundTask
from core.models.image_asset import ImageAsset
from core.models.llm_config import LLMConfigRecord
from core.models.workflow import Workflow, WorkflowTemplate
from core.models.annotation import (
    AnnotationClass,
    ImageAnnotation,
    ImageAnnotationState,
    ImageTag,
    TextDocument,
    TextAnnotation,
)

__all__ = [
    "Base",
    "Dataset",
    "DatasetVersion",
    "DatasetMetadata",
    "BackgroundTask",
    "ImageAsset",
    "LLMConfigRecord",
    "Workflow",
    "WorkflowTemplate",
    "AnnotationClass",
    "ImageAnnotation",
    "ImageAnnotationState",
    "ImageTag",
    "TextDocument",
    "TextAnnotation",
]
