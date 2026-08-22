"""
Dataset service — business-logic layer for dataset CRUD, versioning,
permission checks, and lifecycle management.
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.models.dataset import Dataset, DatasetMetadata, DatasetVersion

from ..storage.minio_client import minio_storage
from .validation_service import DataValidator, ValidationResult

logger = logging.getLogger(__name__)


class DatasetService:
    """Static-method service for dataset operations."""

    # ── Create ────────────────────────────────────────────────────────────

    @staticmethod
    async def create_dataset(
        db: AsyncSession,
        name: str,
        description: str,
        source_type: str,
        user_id: uuid.UUID,
        org_id: str | None = None,
    ) -> Dataset:
        """Create a new dataset and grant the creator *owner* permission."""
        dataset = Dataset(
            id=uuid.uuid4(),
            name=name,
            description=description,
            source_type=source_type,
            status="raw",
        )
        db.add(dataset)
        await db.flush()

        # Single-user mode: no per-user dataset permissions.

        # Audit

        await db.refresh(dataset)
        logger.info("Created dataset %s (%s) by user %s", dataset.id, name, user_id)
        return dataset

    # ── Upload version ────────────────────────────────────────────────────

    @staticmethod
    async def upload_version(
        db: AsyncSession,
        dataset_id: uuid.UUID,
        file_data: bytes,
        file_name: str,
        file_type: str,
        user_id: uuid.UUID,
        parent_version_id: uuid.UUID | None = None,
    ) -> tuple[DatasetVersion, ValidationResult]:
        """Validate the file, upload to MinIO, and create a version record.

        Returns the persisted ``DatasetVersion`` and the ``ValidationResult``.
        """
        # 1. Validate
        validation = await DataValidator.validate_file(file_data, file_name, file_type)
        if not validation.is_valid:
            logger.warning(
                "Validation failed for dataset %s file %s: %s",
                dataset_id,
                file_name,
                validation.errors,
            )
            # Still return the validation so the caller can inspect errors;
            # we create NO version record for invalid data.
            dummy_version = DatasetVersion(
                id=uuid.uuid4(),
                dataset_id=dataset_id,
                version_number=0,
                storage_path="",
                file_name=file_name,
                file_size=len(file_data),
                file_type=file_type,
                schema_hash="",
                row_count=0,
            )
            return dummy_version, validation

        # 2. Determine next version number
        stmt = (
            select(func.coalesce(func.max(DatasetVersion.version_number), 0))
            .where(DatasetVersion.dataset_id == dataset_id)
        )
        result = await db.execute(stmt)
        current_max: int = result.scalar_one()
        next_version = current_max + 1

        # 3. Upload to MinIO
        content_type_map = {
            "csv": "text/csv",
            "json": "application/json",
        }
        content_type = content_type_map.get(
            file_type.lower().strip().lstrip("."), "application/octet-stream"
        )

        await minio_storage.ensure_bucket()
        storage_path = await minio_storage.upload_file(
            file_data=file_data,
            file_name=file_name,
            content_type=content_type,
            dataset_id=str(dataset_id),
            version=next_version,
        )

        # 4. Persist version record
        version = DatasetVersion(
            id=uuid.uuid4(),
            dataset_id=dataset_id,
            version_number=next_version,
            storage_path=storage_path,
            file_name=file_name,
            file_size=len(file_data),
            file_type=file_type,
            schema_hash=validation.schema_hash,
            row_count=validation.row_count,
            parent_version_id=parent_version_id,
        )
        db.add(version)
        await db.flush()

        # 5. Audit

        await db.refresh(version)
        logger.info(
            "Uploaded version %d for dataset %s (%s, %d rows)",
            next_version,
            dataset_id,
            file_name,
            validation.row_count,
        )
        return version, validation

    # ── Read single ───────────────────────────────────────────────────────

    @staticmethod
    async def get_dataset(db: AsyncSession, dataset_id: uuid.UUID) -> Dataset | None:
        """Return a dataset with its versions and metadata eagerly loaded."""
        stmt = (
            select(Dataset)
            .where(Dataset.id == dataset_id)
            .options(
                selectinload(Dataset.versions),
                selectinload(Dataset.metadata_entries),
            )
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    # ── List (with permission filter) ─────────────────────────────────────

    @staticmethod
    async def list_datasets(
        db: AsyncSession,
        user_id: uuid.UUID,
        status: str | None = None,
        skip: int = 0,
        limit: int = 20,
    ) -> tuple[list[Dataset], int]:
        """List datasets the user has any permission on.

        Returns ``(datasets, total_count)`` for pagination.
        """
        # Single-user mode: list every dataset.

        # Count query
        count_stmt = select(func.count()).select_from(Dataset)
        if status:
            count_stmt = count_stmt.where(Dataset.status == status)
        total_result = await db.execute(count_stmt)
        total_count: int = total_result.scalar_one()

        # Data query
        data_stmt = (
            select(Dataset)
            
            .options(
                selectinload(Dataset.versions),
                selectinload(Dataset.metadata_entries),
            )
            .order_by(Dataset.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        if status:
            data_stmt = data_stmt.where(Dataset.status == status)

        result = await db.execute(data_stmt)
        datasets = list(result.scalars().all())
        return datasets, total_count

    # ── Update status ─────────────────────────────────────────────────────

    @staticmethod
    async def update_dataset_status(
        db: AsyncSession,
        dataset_id: uuid.UUID,
        new_status: str,
        user_id: uuid.UUID,
    ) -> Dataset | None:
        """Transition a dataset to a new lifecycle status."""
        valid_statuses = {"raw", "processed", "labeled", "reviewed", "ready"}
        if new_status not in valid_statuses:
            raise ValueError(
                f"Invalid status '{new_status}'. Must be one of {valid_statuses}"
            )

        stmt = (
            update(Dataset)
            .where(Dataset.id == dataset_id)
            .values(status=new_status)
            .returning(Dataset.id)
        )
        result = await db.execute(stmt)
        updated_id = result.scalar_one_or_none()
        if updated_id is None:
            return None


        await db.flush()
        dataset = await DatasetService.get_dataset(db, dataset_id)
        logger.info(
            "Dataset %s status updated to %s by user %s",
            dataset_id,
            new_status,
            user_id,
        )
        return dataset

    # ── Metadata ──────────────────────────────────────────────────────────

    @staticmethod
    async def add_metadata(
        db: AsyncSession,
        dataset_id: uuid.UUID,
        key: str,
        value: str,
    ) -> DatasetMetadata:
        """Add or update a metadata key-value pair for a dataset.

        If a row with the same ``dataset_id`` + ``key`` already exists it is
        updated in place; otherwise a new row is inserted.
        """
        stmt = select(DatasetMetadata).where(
            DatasetMetadata.dataset_id == dataset_id,
            DatasetMetadata.key == key,
        )
        result = await db.execute(stmt)
        existing: DatasetMetadata | None = result.scalar_one_or_none()

        if existing is not None:
            existing.value = value
            await db.flush()
            await db.refresh(existing)
            return existing

        meta = DatasetMetadata(
            id=uuid.uuid4(),
            dataset_id=dataset_id,
            key=key,
            value=value,
        )
        db.add(meta)
        await db.flush()
        await db.refresh(meta)
        return meta

    # ── Versions ──────────────────────────────────────────────────────────

    @staticmethod
    async def get_versions(
        db: AsyncSession, dataset_id: uuid.UUID
    ) -> list[DatasetVersion]:
        """Return all versions of a dataset ordered by version number."""
        stmt = (
            select(DatasetVersion)
            .where(DatasetVersion.dataset_id == dataset_id)
            .order_by(DatasetVersion.version_number.asc())
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())

    # ── Delete (soft) ─────────────────────────────────────────────────────

    @staticmethod
    async def delete_dataset(
        db: AsyncSession,
        dataset_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> bool:
        """Soft-delete a dataset by setting its status to ``'archived'``.

        Note: the ``dataset_status`` enum in the DB may need an
        ``'archived'`` value added via migration.  As a safe fallback we
        mark the name with a ``[DELETED]`` prefix and remove all
        non-owner permissions so the dataset no longer appears in listings.

        Returns ``True`` if the dataset existed and was archived.
        """
        dataset = await DatasetService.get_dataset(db, dataset_id)
        if dataset is None:
            return False

        # Mark as deleted via name prefix (safe even without enum migration)
        if not dataset.name.startswith("[DELETED] "):
            dataset.name = f"[DELETED] {dataset.name}"


        # Delete files from MinIO for each version
        for version in dataset.versions:
            if version.storage_path:
                await minio_storage.delete_file(version.storage_path)


        await db.flush()
        logger.info("Soft-deleted dataset %s by user %s", dataset_id, user_id)
        return True
