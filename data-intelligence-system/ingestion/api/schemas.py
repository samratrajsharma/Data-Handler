"""
Pydantic schemas for the Data Ingestion API.

Covers dataset CRUD, versioning, metadata, permissions, file upload
responses, and validation results.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


class DatasetCreate(BaseModel):
    """Payload for creating a new dataset."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    source_type: str = Field(..., pattern="^(csv|json|api|database|image)$")


class DatasetResponse(BaseModel):
    """Read-only representation of a persisted dataset."""

    id: UUID
    name: str
    description: Optional[str]
    source_type: str
    status: str
    created_at: datetime
    updated_at: Optional[datetime]
    row_count: Optional[int] = None  # populated from the latest version
    version_count: Optional[int] = None

    model_config = {"from_attributes": True}


class DatasetPreviewResponse(BaseModel):
    """Small head-of-file preview used by the Datasets page inline preview."""

    columns: list[str]
    rows: list[list]
    row_count: Optional[int] = None
    truncated: bool = False


class DatasetStatusUpdate(BaseModel):
    """Payload for transitioning a dataset through its lifecycle."""

    status: str = Field(..., pattern="^(raw|processed|labeled|reviewed|ready)$")


class DatasetListResponse(BaseModel):
    """Paginated list of datasets."""

    datasets: list[DatasetResponse]
    total: int
    skip: int
    limit: int


# ---------------------------------------------------------------------------
# Dataset versions
# ---------------------------------------------------------------------------


class DatasetVersionResponse(BaseModel):
    """Read-only representation of a single dataset version."""

    id: UUID
    dataset_id: UUID
    version_number: int
    storage_path: str
    file_name: str
    file_size: Optional[int]
    file_type: str
    schema_hash: Optional[str]
    row_count: Optional[int]
    parent_version_id: Optional[UUID]
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Dataset metadata
# ---------------------------------------------------------------------------


class DatasetMetadataUpdate(BaseModel):
    """Payload for adding or updating a metadata key-value pair."""

    key: str = Field(..., min_length=1, max_length=255)
    value: str


class DatasetMetadataResponse(BaseModel):
    """Read-only representation of a metadata entry."""

    id: UUID
    dataset_id: UUID
    key: str
    value: str
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class ValidationResultResponse(BaseModel):
    """Result of validating an uploaded file."""

    is_valid: bool
    row_count: int
    column_count: int
    columns: list[str]
    schema_hash: str
    errors: list[str]
    warnings: list[str]
    sample_data: list[dict]


# ---------------------------------------------------------------------------
# Upload (composite)
# ---------------------------------------------------------------------------


class UploadResponse(BaseModel):
    """Composite response returned after a successful file upload."""

    dataset: DatasetResponse
    version: DatasetVersionResponse
    validation: ValidationResultResponse
