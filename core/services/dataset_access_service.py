"""
Dataset access control.

Single-user mode: there is no multi-tenant access control. These helpers are
kept as no-op shims so route call sites that pass ``current_user`` through
them keep working. They collapse to:

* every helper accepts the user and ignores it
* ``assert_dataset_access`` just checks the row exists (404 if not)
"""

from typing import Iterable, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from core.models.dataset import Dataset
from core.services.auth_service import User


def is_superadmin(user: User) -> bool:  # noqa: ARG001
    return True


def can_access_dataset(user: User, dataset: Dataset) -> bool:  # noqa: ARG001
    return True


def dataset_access_filter(user: User) -> Optional[ColumnElement]:  # noqa: ARG001
    return None


async def assert_dataset_access(
    db: AsyncSession,
    dataset_id: UUID,
    user: User,  # noqa: ARG001
) -> Dataset:
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalars().first()
    if dataset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )
    return dataset


async def assert_datasets_access(
    db: AsyncSession,
    dataset_ids: Iterable[UUID],
    user: User,
) -> None:
    ids = list({UUID(str(d)) if not isinstance(d, UUID) else d for d in dataset_ids})
    for did in ids:
        await assert_dataset_access(db, did, user)
