"""
Annotation API — class management (shared by image and text datasets),
manual image annotation (bbox / polygon / classification), per-image
workflow state (annotate → approve/reject), and train/valid/test splits.

Geometry is stored **normalized** (0..1 relative to the image's natural
size); ``bbox`` x/y is the top-left corner and ``polygon`` points are
``[[x, y], ...]`` pairs.
"""

import logging
import random
import uuid as _uuid
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models.annotation import (
    AnnotationClass,
    ImageAnnotation,
    ImageAnnotationState,
)
from core.models.dataset import Dataset
from core.models.image_asset import ImageAsset
from core.services.auth_service import User, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/annotations", tags=["annotations"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Preset palette for auto-assigned class colors (orange-first, ~12 hues).
_CLASS_COLOR_PALETTE = [
    "#f97316", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ef4444",
    "#14b8a6", "#f43f5e", "#8b5cf6", "#84cc16", "#06b6d4", "#d946ef",
]

ImageStatus = Literal["unannotated", "annotated", "approved", "rejected"]
SplitName = Literal["train", "valid", "test"]
AnnotationKind = Literal["bbox", "polygon", "classification"]


# ── Schemas ──────────────────────────────────────────────────────────────


class AnnotationClassOut(BaseModel):
    id: UUID
    dataset_id: UUID
    name: str
    color: str
    shortcut: Optional[str] = None
    order_index: int

    model_config = ConfigDict(from_attributes=True)


class AnnotationClassListResponse(BaseModel):
    classes: list[AnnotationClassOut]


class AnnotationClassCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    color: Optional[str] = None
    shortcut: Optional[str] = Field(None, max_length=8)


class AnnotationClassUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    color: Optional[str] = None
    shortcut: Optional[str] = Field(None, max_length=8)
    order_index: Optional[int] = None


class ImageAnnotationOut(BaseModel):
    id: UUID
    class_id: UUID
    kind: AnnotationKind
    # Normalized 0..1 geometry. bbox: x/y is the top-left corner.
    x: Optional[float] = None
    y: Optional[float] = None
    w: Optional[float] = None
    h: Optional[float] = None
    points: Optional[list[tuple[float, float]]] = None

    model_config = ConfigDict(from_attributes=True)


class ImageAnnotationIn(BaseModel):
    class_id: UUID
    kind: AnnotationKind
    x: Optional[float] = None
    y: Optional[float] = None
    w: Optional[float] = None
    h: Optional[float] = None
    points: Optional[list[tuple[float, float]]] = None


class AnnotateQueueItem(BaseModel):
    asset_id: UUID
    file_name: str
    width: Optional[int] = None
    height: Optional[int] = None
    thumbnail_url: Optional[str] = None
    status: ImageStatus
    split: Optional[SplitName] = None
    annotation_count: int


class AnnotateQueueResponse(BaseModel):
    items: list[AnnotateQueueItem]
    total: int


class SplitCounts(BaseModel):
    train: int
    valid: int
    test: int
    unassigned: int


class ClassCount(BaseModel):
    class_id: UUID
    name: str
    color: str
    count: int


class AnnotateSummary(BaseModel):
    total: int
    annotated: int
    unannotated: int
    approved: int
    rejected: int
    splits: SplitCounts
    class_counts: list[ClassCount]


class AnnotatedAssetInfo(BaseModel):
    id: UUID
    file_name: str
    width: Optional[int] = None
    height: Optional[int] = None
    original_url: Optional[str] = None
    thumbnail_url: Optional[str] = None


class ImageAnnotationsResponse(BaseModel):
    asset: AnnotatedAssetInfo
    annotations: list[ImageAnnotationOut]
    status: ImageStatus
    split: Optional[SplitName] = None
    prev_asset_id: Optional[UUID] = None
    next_asset_id: Optional[UUID] = None


class SaveAnnotationsRequest(BaseModel):
    annotations: list[ImageAnnotationIn]
    status: Optional[ImageStatus] = None


class SaveAnnotationsResponse(BaseModel):
    annotations: list[ImageAnnotationOut]
    status: ImageStatus


class ImageStateUpdate(BaseModel):
    status: Optional[ImageStatus] = None
    split: Optional[SplitName] = None


class ImageStateResponse(BaseModel):
    status: ImageStatus
    split: Optional[SplitName] = None


class AutoSplitRequest(BaseModel):
    train: float = Field(..., ge=0.0, le=1.0)
    valid: float = Field(..., ge=0.0, le=1.0)
    test: float = Field(..., ge=0.0, le=1.0)
    only_annotated: bool = False
    seed: Optional[int] = None


class AutoSplitResponse(BaseModel):
    train: int
    valid: int
    test: int
    assigned: int


# ── Helpers ──────────────────────────────────────────────────────────────


def _proxy_url(dataset_id: UUID, asset_id: UUID, thumb: bool = False) -> str:
    """Build a proxy URL that routes through the API server (image proxy)."""
    base = f"/api/v1/images/{dataset_id}/{asset_id}/file"
    return f"{base}?thumb=true" if thumb else base


def _clamp01(value: float) -> float:
    """Clamp a coordinate to the normalized 0..1 range."""
    return max(0.0, min(1.0, float(value)))


async def _validate_dataset(db: AsyncSession, dataset_id: UUID) -> Dataset:
    """Fetch dataset or raise 404."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalars().first()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


async def _get_asset(db: AsyncSession, dataset_id: UUID, asset_id: UUID) -> ImageAsset:
    """Fetch an image asset scoped to a dataset or raise 404."""
    stmt = select(ImageAsset).where(
        ImageAsset.id == asset_id,
        ImageAsset.dataset_id == dataset_id,
    )
    result = await db.execute(stmt)
    asset = result.scalars().first()
    if asset is None:
        raise HTTPException(status_code=404, detail="Image asset not found")
    return asset


async def _get_class(db: AsyncSession, dataset_id: UUID, class_id: UUID) -> AnnotationClass:
    """Fetch an annotation class scoped to a dataset or raise 404."""
    stmt = select(AnnotationClass).where(
        AnnotationClass.id == class_id,
        AnnotationClass.dataset_id == dataset_id,
    )
    result = await db.execute(stmt)
    cls = result.scalars().first()
    if cls is None:
        raise HTTPException(status_code=404, detail="Annotation class not found")
    return cls


async def _get_state(db: AsyncSession, asset_id: UUID) -> Optional[ImageAnnotationState]:
    """Fetch the workflow-state row for an asset, or None."""
    result = await db.execute(
        select(ImageAnnotationState).where(ImageAnnotationState.asset_id == asset_id)
    )
    return result.scalars().first()


async def _name_conflict(
    db: AsyncSession,
    dataset_id: UUID,
    name: str,
    exclude_id: Optional[UUID] = None,
) -> bool:
    """True if a class with the same (case-insensitive) name exists."""
    stmt = select(AnnotationClass.id).where(
        AnnotationClass.dataset_id == dataset_id,
        func.lower(AnnotationClass.name) == name.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(AnnotationClass.id != exclude_id)
    result = await db.execute(stmt)
    return result.scalars().first() is not None


def _queue_filters(
    dataset_id: UUID,
    status_filter: Optional[str],
    split_filter: Optional[str],
) -> list:
    """WHERE clauses for the annotation queue (ImageAsset LEFT OUTER JOIN
    ImageAnnotationState); a missing state row counts as 'unannotated'."""
    clauses = [ImageAsset.dataset_id == dataset_id]
    if status_filter is not None:
        clauses.append(
            func.coalesce(ImageAnnotationState.status, "unannotated") == status_filter
        )
    if split_filter is not None:
        clauses.append(ImageAnnotationState.split == split_filter)
    return clauses


def _validate_annotation_geometry(ann: ImageAnnotationIn) -> dict:
    """Validate and clamp one incoming annotation's geometry.

    Returns the cleaned geometry columns (x, y, w, h, points) or raises 422.
    """
    if ann.kind == "bbox":
        if ann.x is None or ann.y is None or ann.w is None or ann.h is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="bbox annotation requires x, y, w and h",
            )
        # Trim the box to the image instead of merely clamping each value —
        # a box crossing an edge keeps its visible portion (Roboflow-style).
        x0 = _clamp01(ann.x)
        y0 = _clamp01(ann.y)
        x1 = _clamp01(ann.x + ann.w)
        y1 = _clamp01(ann.y + ann.h)
        w = x1 - x0
        h = y1 - y0
        if w <= 0 or h <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="bbox annotation requires w > 0 and h > 0 inside the image",
            )
        return {"x": x0, "y": y0, "w": w, "h": h, "points": None}

    if ann.kind == "polygon":
        if not ann.points or len(ann.points) < 3:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="polygon annotation requires at least 3 [x, y] points",
            )
        points = [[_clamp01(px), _clamp01(py)] for px, py in ann.points]
        return {"x": None, "y": None, "w": None, "h": None, "points": points}

    # classification — no geometry
    return {"x": None, "y": None, "w": None, "h": None, "points": None}


def _annotation_to_out(row: ImageAnnotation) -> ImageAnnotationOut:
    """Convert an ImageAnnotation ORM row to the response schema."""
    return ImageAnnotationOut(
        id=row.id,
        class_id=row.class_id,
        kind=row.kind,
        x=row.x,
        y=row.y,
        w=row.w,
        h=row.h,
        points=row.points,
    )


# ── Class management (image + text datasets) ─────────────────────────────


@router.get("/{dataset_id}/classes", response_model=AnnotationClassListResponse)
async def list_classes(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the dataset's annotation classes ordered by order_index, name."""
    await _validate_dataset(db, dataset_id)

    stmt = (
        select(AnnotationClass)
        .where(AnnotationClass.dataset_id == dataset_id)
        .order_by(AnnotationClass.order_index, AnnotationClass.name)
    )
    result = await db.execute(stmt)
    classes = result.scalars().all()
    return AnnotationClassListResponse(
        classes=[AnnotationClassOut.model_validate(c) for c in classes]
    )


@router.post(
    "/{dataset_id}/classes",
    response_model=AnnotationClassOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_class(
    dataset_id: UUID,
    payload: AnnotationClassCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an annotation class. Color is auto-assigned from a preset
    palette when omitted; order_index is appended at the end."""
    await _validate_dataset(db, dataset_id)

    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Class name must not be empty",
        )

    if await _name_conflict(db, dataset_id, name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A class named '{name}' already exists in this dataset",
        )

    count_stmt = select(func.count(AnnotationClass.id)).where(
        AnnotationClass.dataset_id == dataset_id
    )
    existing_count = (await db.execute(count_stmt)).scalar() or 0

    color = payload.color or _CLASS_COLOR_PALETTE[existing_count % len(_CLASS_COLOR_PALETTE)]

    max_order_stmt = select(func.max(AnnotationClass.order_index)).where(
        AnnotationClass.dataset_id == dataset_id
    )
    max_order = (await db.execute(max_order_stmt)).scalar()
    order_index = (max_order + 1) if max_order is not None else 0

    cls = AnnotationClass(
        id=_uuid.uuid4(),
        dataset_id=dataset_id,
        name=name,
        color=color,
        shortcut=payload.shortcut,
        order_index=order_index,
    )
    db.add(cls)
    await db.commit()

    logger.info("Created annotation class '%s' (%s) in dataset %s", name, cls.id, dataset_id)
    return AnnotationClassOut.model_validate(cls)


@router.patch("/{dataset_id}/classes/{class_id}", response_model=AnnotationClassOut)
async def update_class(
    dataset_id: UUID,
    class_id: UUID,
    payload: AnnotationClassUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an annotation class's name, color, shortcut or order_index."""
    await _validate_dataset(db, dataset_id)
    cls = await _get_class(db, dataset_id, class_id)

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Class name must not be empty",
            )
        if await _name_conflict(db, dataset_id, name, exclude_id=class_id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A class named '{name}' already exists in this dataset",
            )
        cls.name = name
    if payload.color is not None:
        cls.color = payload.color
    if "shortcut" in payload.model_fields_set:
        cls.shortcut = payload.shortcut
    if payload.order_index is not None:
        cls.order_index = payload.order_index

    await db.commit()
    return AnnotationClassOut.model_validate(cls)


@router.delete("/{dataset_id}/classes/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_class(
    dataset_id: UUID,
    class_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an annotation class (DB cascade removes its annotations)."""
    await _validate_dataset(db, dataset_id)
    cls = await _get_class(db, dataset_id, class_id)

    await db.execute(sa_delete(AnnotationClass).where(AnnotationClass.id == cls.id))
    await db.commit()
    logger.info("Deleted annotation class %s from dataset %s", class_id, dataset_id)


# ── Image annotation — literal routes BEFORE /{asset_id}/ siblings ───────


@router.get("/{dataset_id}/images/summary", response_model=AnnotateSummary)
async def get_annotate_summary(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Annotation progress summary: status counts, split counts and
    per-class annotation counts."""
    await _validate_dataset(db, dataset_id)

    total_stmt = select(func.count(ImageAsset.id)).where(
        ImageAsset.dataset_id == dataset_id
    )
    total = (await db.execute(total_stmt)).scalar() or 0

    # Status counts from state rows; images without a row are unannotated.
    status_stmt = (
        select(ImageAnnotationState.status, func.count(ImageAnnotationState.asset_id))
        .where(ImageAnnotationState.dataset_id == dataset_id)
        .group_by(ImageAnnotationState.status)
    )
    status_counts = {row[0]: row[1] for row in (await db.execute(status_stmt)).all()}
    annotated = status_counts.get("annotated", 0)
    approved = status_counts.get("approved", 0)
    rejected = status_counts.get("rejected", 0)
    unannotated = total - annotated - approved - rejected

    split_stmt = (
        select(ImageAnnotationState.split, func.count(ImageAnnotationState.asset_id))
        .where(ImageAnnotationState.dataset_id == dataset_id)
        .group_by(ImageAnnotationState.split)
    )
    split_counts = {row[0]: row[1] for row in (await db.execute(split_stmt)).all()}
    train = split_counts.get("train", 0)
    valid = split_counts.get("valid", 0)
    test = split_counts.get("test", 0)

    class_stmt = (
        select(
            AnnotationClass.id,
            AnnotationClass.name,
            AnnotationClass.color,
            func.count(ImageAnnotation.id).label("count"),
        )
        .outerjoin(ImageAnnotation, ImageAnnotation.class_id == AnnotationClass.id)
        .where(AnnotationClass.dataset_id == dataset_id)
        .group_by(
            AnnotationClass.id,
            AnnotationClass.name,
            AnnotationClass.color,
            AnnotationClass.order_index,
        )
        .order_by(AnnotationClass.order_index, AnnotationClass.name)
    )
    class_rows = (await db.execute(class_stmt)).all()

    return AnnotateSummary(
        total=total,
        annotated=annotated,
        unannotated=unannotated,
        approved=approved,
        rejected=rejected,
        splits=SplitCounts(
            train=train,
            valid=valid,
            test=test,
            unassigned=total - train - valid - test,
        ),
        class_counts=[
            ClassCount(class_id=row[0], name=row[1], color=row[2], count=row[3])
            for row in class_rows
        ],
    )


@router.get("/{dataset_id}/images/queue", response_model=AnnotateQueueResponse)
async def get_annotate_queue(
    dataset_id: UUID,
    status_filter: Optional[ImageStatus] = Query(None, alias="status"),
    split: Optional[SplitName] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Paginated annotation queue with per-image status, split and
    annotation counts. Missing state rows count as 'unannotated'."""
    await _validate_dataset(db, dataset_id)

    clauses = _queue_filters(dataset_id, status_filter, split)

    count_stmt = (
        select(func.count(ImageAsset.id))
        .select_from(ImageAsset)
        .outerjoin(
            ImageAnnotationState, ImageAnnotationState.asset_id == ImageAsset.id
        )
        .where(*clauses)
    )
    total = (await db.execute(count_stmt)).scalar() or 0

    ann_count_sq = (
        select(func.count(ImageAnnotation.id))
        .where(ImageAnnotation.asset_id == ImageAsset.id)
        .scalar_subquery()
    )

    stmt = (
        select(ImageAsset, ImageAnnotationState, ann_count_sq.label("annotation_count"))
        .outerjoin(
            ImageAnnotationState, ImageAnnotationState.asset_id == ImageAsset.id
        )
        .where(*clauses)
        .order_by(ImageAsset.created_at.asc(), ImageAsset.id.asc())
        .offset(skip)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()

    items = [
        AnnotateQueueItem(
            asset_id=asset.id,
            file_name=asset.file_name,
            width=asset.width,
            height=asset.height,
            thumbnail_url=_proxy_url(dataset_id, asset.id, thumb=True)
            if asset.thumbnail_path
            else None,
            status=state.status if state is not None else "unannotated",
            split=state.split if state is not None else None,
            annotation_count=ann_count or 0,
        )
        for asset, state, ann_count in rows
    ]

    return AnnotateQueueResponse(items=items, total=total)


@router.post("/{dataset_id}/images/split", response_model=AutoSplitResponse)
async def auto_split_images(
    dataset_id: UUID,
    payload: AutoSplitRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Randomly assign images to train/valid/test splits by ratio
    (deterministic for a given seed). Preserves annotation status."""
    await _validate_dataset(db, dataset_id)

    ratio_sum = payload.train + payload.valid + payload.test
    if abs(ratio_sum - 1.0) > 0.01:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Split ratios must sum to 1.0 (got {ratio_sum:.3f})",
        )

    if payload.only_annotated:
        ids_stmt = (
            select(ImageAsset.id)
            .join(ImageAnnotationState, ImageAnnotationState.asset_id == ImageAsset.id)
            .where(
                ImageAsset.dataset_id == dataset_id,
                ImageAnnotationState.status.in_(["annotated", "approved"]),
            )
        )
    else:
        ids_stmt = select(ImageAsset.id).where(ImageAsset.dataset_id == dataset_id)
    # Stable base ordering so a given seed always produces the same split.
    asset_ids = sorted((await db.execute(ids_stmt)).scalars().all(), key=str)

    rng = random.Random(payload.seed if payload.seed is not None else 42)
    rng.shuffle(asset_ids)

    # Largest-remainder allocation: exact total, and a 0-ratio split never
    # receives leftovers (e.g. train .8 / valid .2 / test 0 keeps test empty).
    n = len(asset_ids)
    ratios = [("train", payload.train), ("valid", payload.valid), ("test", payload.test)]
    counts = {name: int(r * n) for name, r in ratios}
    leftover = n - sum(counts.values())
    remainders = sorted(
        ((r * n) - int(r * n), name)
        for name, r in ratios
        if r > 0
    )
    while leftover > 0 and remainders:
        _, name = remainders.pop()  # largest fractional remainder first
        counts[name] += 1
        leftover -= 1
        if leftover > 0 and not remainders:
            remainders = [(0.0, nm) for nm, r in ratios if r > 0]
    n_train, n_valid, n_test = counts["train"], counts["valid"], counts["test"]

    assignments: list[tuple[UUID, str]] = []
    assignments += [(aid, "train") for aid in asset_ids[:n_train]]
    assignments += [(aid, "valid") for aid in asset_ids[n_train : n_train + n_valid]]
    assignments += [(aid, "test") for aid in asset_ids[n_train + n_valid : n_train + n_valid + n_test]]

    # Upsert state rows, preserving status.
    states_stmt = select(ImageAnnotationState).where(
        ImageAnnotationState.dataset_id == dataset_id
    )
    states = {s.asset_id: s for s in (await db.execute(states_stmt)).scalars().all()}

    for aid, split_name in assignments:
        state = states.get(aid)
        if state is not None:
            state.split = split_name
        else:
            db.add(
                ImageAnnotationState(
                    asset_id=aid,
                    dataset_id=dataset_id,
                    status="unannotated",
                    split=split_name,
                )
            )

    await db.commit()
    logger.info(
        "Auto-split dataset %s: %d train / %d valid / %d test (seed=%s)",
        dataset_id, n_train, n_valid, n_test, payload.seed,
    )

    return AutoSplitResponse(train=n_train, valid=n_valid, test=n_test, assigned=n)


# ── Per-asset routes (after the literal siblings above) ──────────────────


@router.get(
    "/{dataset_id}/images/{asset_id}/annotations",
    response_model=ImageAnnotationsResponse,
)
async def get_image_annotations(
    dataset_id: UUID,
    asset_id: UUID,
    status_filter: Optional[ImageStatus] = Query(None, alias="status"),
    split: Optional[SplitName] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """All annotations for one image, plus its workflow state and the
    prev/next asset ids in the queue ordering (honoring the optional
    status/split filters so navigation respects the active filter)."""
    await _validate_dataset(db, dataset_id)
    asset = await _get_asset(db, dataset_id, asset_id)

    ann_stmt = (
        select(ImageAnnotation)
        .where(ImageAnnotation.asset_id == asset_id)
        .order_by(ImageAnnotation.created_at.asc(), ImageAnnotation.id.asc())
    )
    annotations = (await db.execute(ann_stmt)).scalars().all()

    state = await _get_state(db, asset_id)

    # Neighbors in the same stable ordering as the queue.
    ids_stmt = (
        select(ImageAsset.id)
        .outerjoin(
            ImageAnnotationState, ImageAnnotationState.asset_id == ImageAsset.id
        )
        .where(*_queue_filters(dataset_id, status_filter, split))
        .order_by(ImageAsset.created_at.asc(), ImageAsset.id.asc())
    )
    ordered_ids = list((await db.execute(ids_stmt)).scalars().all())

    prev_asset_id: Optional[UUID] = None
    next_asset_id: Optional[UUID] = None
    try:
        idx = ordered_ids.index(asset_id)
        if idx > 0:
            prev_asset_id = ordered_ids[idx - 1]
        if idx < len(ordered_ids) - 1:
            next_asset_id = ordered_ids[idx + 1]
    except ValueError:
        pass  # asset filtered out by status/split — no neighbors

    return ImageAnnotationsResponse(
        asset=AnnotatedAssetInfo(
            id=asset.id,
            file_name=asset.file_name,
            width=asset.width,
            height=asset.height,
            original_url=_proxy_url(dataset_id, asset.id, thumb=False)
            if asset.original_path
            else None,
            thumbnail_url=_proxy_url(dataset_id, asset.id, thumb=True)
            if asset.thumbnail_path
            else None,
        ),
        annotations=[_annotation_to_out(a) for a in annotations],
        status=state.status if state is not None else "unannotated",
        split=state.split if state is not None else None,
        prev_asset_id=prev_asset_id,
        next_asset_id=next_asset_id,
    )


@router.put(
    "/{dataset_id}/images/{asset_id}/annotations",
    response_model=SaveAnnotationsResponse,
)
async def save_image_annotations(
    dataset_id: UUID,
    asset_id: UUID,
    payload: SaveAnnotationsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Replace-all save: delete the image's existing annotations, insert
    the new list and upsert its workflow state."""
    await _validate_dataset(db, dataset_id)
    await _get_asset(db, dataset_id, asset_id)

    # Validate class ownership.
    class_ids_stmt = select(AnnotationClass.id).where(
        AnnotationClass.dataset_id == dataset_id
    )
    valid_class_ids = set((await db.execute(class_ids_stmt)).scalars().all())
    for ann in payload.annotations:
        if ann.class_id not in valid_class_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Class {ann.class_id} does not belong to this dataset",
            )

    # Validate geometry up front so a bad payload changes nothing.
    cleaned = [_validate_annotation_geometry(ann) for ann in payload.annotations]

    # Replace-all.
    await db.execute(
        sa_delete(ImageAnnotation).where(ImageAnnotation.asset_id == asset_id)
    )

    rows: list[ImageAnnotation] = []
    for ann, geom in zip(payload.annotations, cleaned):
        row = ImageAnnotation(
            id=_uuid.uuid4(),
            dataset_id=dataset_id,
            asset_id=asset_id,
            class_id=ann.class_id,
            kind=ann.kind,
            x=geom["x"],
            y=geom["y"],
            w=geom["w"],
            h=geom["h"],
            points=geom["points"],
        )
        db.add(row)
        rows.append(row)

    # Upsert workflow state.
    state = await _get_state(db, asset_id)
    if payload.status is not None:
        final_status = payload.status
    elif payload.annotations:
        # Preserve approved/rejected on re-save; otherwise mark annotated.
        if state is not None and state.status in ("approved", "rejected"):
            final_status = state.status
        else:
            final_status = "annotated"
    else:
        final_status = "unannotated"

    if state is not None:
        state.status = final_status
    else:
        db.add(
            ImageAnnotationState(
                asset_id=asset_id,
                dataset_id=dataset_id,
                status=final_status,
                split=None,
            )
        )

    await db.commit()

    return SaveAnnotationsResponse(
        annotations=[_annotation_to_out(r) for r in rows],
        status=final_status,
    )


@router.patch(
    "/{dataset_id}/images/{asset_id}/state",
    response_model=ImageStateResponse,
)
async def set_image_state(
    dataset_id: UUID,
    asset_id: UUID,
    payload: ImageStateUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upsert the image's workflow state (status and/or split). Passing
    ``split: null`` explicitly clears the split assignment."""
    await _validate_dataset(db, dataset_id)
    await _get_asset(db, dataset_id, asset_id)

    state = await _get_state(db, asset_id)
    if state is None:
        state = ImageAnnotationState(
            asset_id=asset_id,
            dataset_id=dataset_id,
            status="unannotated",
            split=None,
        )
        db.add(state)

    if payload.status is not None:
        state.status = payload.status
    if "split" in payload.model_fields_set:
        state.split = payload.split

    await db.commit()
    return ImageStateResponse(status=state.status, split=state.split)
