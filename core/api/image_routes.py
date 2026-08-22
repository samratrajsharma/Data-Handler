"""
Image Pipeline API — upload, browse, embed, cluster, and search images
within a dataset.

All endpoints require at minimum the 'viewer' role.
"""

import io
import logging
import uuid as _uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import UUID

import core.paths  # noqa: F401

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from minio import Minio
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, func, case, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models.dataset import Dataset, DatasetVersion
from core.models.image_asset import ImageAsset
from core.services.auth_service import User, get_current_user
from core.services.task_service import create_task_record
from core.settings import settings
from core.storage import get_minio_client as _get_minio_client, get_minio_public_client

# ---------------------------------------------------------------------------
# Image pipeline imports (data-intelligence-system added via core.paths)
# ---------------------------------------------------------------------------
from image_pipeline.metadata_extractor import validate_image  # noqa: E402
from image_pipeline.thumbnail_generator import generate_thumbnail  # noqa: E402

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/images", tags=["images"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_MAX_UPLOAD_BYTES = settings.IMAGE_MAX_UPLOAD_MB * 1024 * 1024
_ALLOWED_EXTENSIONS = {
    ext.strip() for ext in settings.IMAGE_ALLOWED_EXTENSIONS.split(",")
}
_THUMBNAIL_SIZE = settings.IMAGE_THUMBNAIL_SIZE


# ── Schemas ──────────────────────────────────────────────────────────────


class ImageAssetResponse(BaseModel):
    id: UUID
    dataset_id: UUID
    file_name: str
    width: Optional[int] = None
    height: Optional[int] = None
    color_mode: Optional[str] = None
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    has_exif: bool = False
    cluster_id: Optional[int] = None
    thumbnail_url: Optional[str] = None
    original_url: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ImageUploadResponse(BaseModel):
    asset: ImageAssetResponse


class ImageBatchResponse(BaseModel):
    assets: list[ImageAssetResponse]
    total_uploaded: int
    errors: list[str]


class GalleryResponse(BaseModel):
    images: list[ImageAssetResponse]
    total: int
    embedded_count: int = 0


class ImageTaskResponse(BaseModel):
    task_id: UUID
    celery_task_id: str
    message: str


class ClusterRequest(BaseModel):
    min_cluster_size: int = 5


class SearchRequest(BaseModel):
    query_text: str
    top_k: int = Field(default=10, ge=1, le=200)


class SearchResult(BaseModel):
    asset: ImageAssetResponse
    score: float


# ── Helpers ──────────────────────────────────────────────────────────────



def _ensure_bucket(mc: Minio, bucket: str = settings.MINIO_BUCKET_NAME) -> None:
    """Create the bucket if it does not exist."""
    if not mc.bucket_exists(bucket):
        mc.make_bucket(bucket)
        logger.info("Created MinIO bucket '%s'", bucket)


def _upload_bytes_to_minio(
    mc: Minio,
    data: bytes,
    object_name: str,
    content_type: str,
    bucket: str = settings.MINIO_BUCKET_NAME,
) -> str:
    """Upload raw bytes to MinIO and return the object path."""
    _ensure_bucket(mc, bucket)
    mc.put_object(
        bucket,
        object_name,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )
    return object_name


def _presigned_url(mc: Minio, object_name: str) -> Optional[str]:
    """Generate a presigned GET URL for a MinIO object, or None on error."""
    if not object_name:
        return None
    try:
        # Presign against the PUBLIC endpoint so the URL opens in the browser.
        return get_minio_public_client().presigned_get_object(settings.MINIO_BUCKET_NAME, object_name)
    except Exception as exc:
        logger.warning("Failed to generate presigned URL for '%s': %s", object_name, exc)
        return None


def _proxy_url(dataset_id: UUID, asset_id: UUID, thumb: bool = False) -> str:
    """Build a proxy URL that routes through the API server."""
    base = f"/api/v1/images/{dataset_id}/{asset_id}/file"
    return f"{base}?thumb=true" if thumb else base


def _asset_to_response(asset: ImageAsset, mc: Minio) -> ImageAssetResponse:
    """Convert an ImageAsset ORM object to the response schema with URLs."""
    return ImageAssetResponse(
        id=asset.id,
        dataset_id=asset.dataset_id,
        file_name=asset.file_name,
        width=asset.width,
        height=asset.height,
        color_mode=asset.color_mode,
        mime_type=asset.mime_type,
        file_size=asset.file_size,
        has_exif=asset.has_exif,
        cluster_id=asset.cluster_id,
        thumbnail_url=_proxy_url(asset.dataset_id, asset.id, thumb=True) if asset.thumbnail_path else None,
        original_url=_proxy_url(asset.dataset_id, asset.id, thumb=False) if asset.original_path else None,
        created_at=asset.created_at,
    )


async def _user_from_header_or_query(
    request: Request,
    token: Optional[str] = Query(
        None, description="Legacy — ignored in single-user mode."
    ),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Image-proxy auth dependency.

    Phase D — auth is gone. This used to decode a token from the
    ``Authorization`` header or a ``?token=`` query parameter, because
    browser ``<img>`` tags can't attach headers. With token validation
    gone, it simply delegates to :func:`get_current_user`, which returns
    the local user. The ``request`` and ``token`` parameters are kept so
    existing call sites and URL shapes (``?token=…``) don't break.
    """
    _ = request, token  # explicitly unused in single-user mode
    return await get_current_user()


async def _validate_dataset(db: AsyncSession, dataset_id: UUID) -> Dataset:
    """Fetch dataset or raise 404."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalars().first()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


async def _get_latest_version(db: AsyncSession, dataset_id: UUID) -> Optional[DatasetVersion]:
    """Return the latest DatasetVersion for a dataset, or None."""
    stmt = (
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset_id)
        .order_by(DatasetVersion.version_number.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalars().first()


async def _process_single_upload(
    file: UploadFile,
    dataset_id: UUID,
    version_id: Optional[UUID],
    db: AsyncSession,
    mc: Minio,
) -> ImageAsset:
    """
    Validate, upload, and persist a single image. Returns the created
    ImageAsset row. Raises HTTPException on failure.
    """
    # ---- Read file bytes ----
    contents = await file.read()

    if len(contents) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File '{file.filename}' exceeds the {settings.IMAGE_MAX_UPLOAD_MB} MB upload limit",
        )

    # ---- Extension check ----
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Extension '{ext}' is not allowed. Accepted: {sorted(_ALLOWED_EXTENSIONS)}",
        )

    # ---- Image validation & metadata extraction ----
    validation = validate_image(contents, filename)
    if not validation.is_valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid image '{filename}': {validation.error}",
        )

    meta = validation.metadata
    asset_id = _uuid.uuid4()
    safe_name = f"{asset_id}_{filename}"

    # ---- Upload original to MinIO ----
    original_key = f"datasets/{dataset_id}/images/{safe_name}"
    _upload_bytes_to_minio(
        mc,
        contents,
        original_key,
        content_type=file.content_type or "application/octet-stream",
    )

    # ---- Generate & upload thumbnail ----
    thumbnail_key: Optional[str] = None
    try:
        thumb_bytes = generate_thumbnail(contents, max_size=_THUMBNAIL_SIZE)
        thumbnail_key = f"datasets/{dataset_id}/thumbnails/{safe_name}"
        _upload_bytes_to_minio(mc, thumb_bytes, thumbnail_key, content_type="image/jpeg")
    except Exception as exc:
        logger.warning("Thumbnail generation failed for '%s': %s", filename, exc)

    # ---- Create DB row ----
    asset = ImageAsset(
        id=asset_id,
        dataset_id=dataset_id,
        version_id=version_id,
        original_path=original_key,
        thumbnail_path=thumbnail_key,
        file_name=filename,
        file_size=meta.file_size if meta else len(contents),
        mime_type=file.content_type,
        width=meta.width if meta else None,
        height=meta.height if meta else None,
        color_mode=meta.color_mode if meta else None,
        channels=meta.channels if meta else None,
        has_exif=meta.has_exif if meta else False,
        exif_data=meta.exif_data if meta else None,
    )
    db.add(asset)
    await db.flush()
    await db.refresh(asset)

    logger.info("Uploaded image asset %s ('%s') to dataset %s", asset.id, filename, dataset_id)
    return asset


# ── Routes ───────────────────────────────────────────────────────────────


@router.post(
    "/{dataset_id}/upload",
    response_model=ImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_single_image(
    dataset_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a single image to a dataset."""
    dataset = await _validate_dataset(db, dataset_id)
    version = await _get_latest_version(db, dataset_id)
    version_id = version.id if version else None

    mc = _get_minio_client()

    asset = await _process_single_upload(file, dataset_id, version_id, db, mc)
    await db.commit()

    return ImageUploadResponse(asset=_asset_to_response(asset, mc))


@router.post(
    "/{dataset_id}/upload-batch",
    response_model=ImageBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_batch_images(
    dataset_id: UUID,
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload multiple images to a dataset in a single request."""
    if len(files) > settings.IMAGE_BATCH_MAX_COUNT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many files. Maximum is {settings.IMAGE_BATCH_MAX_COUNT} per batch.",
        )

    dataset = await _validate_dataset(db, dataset_id)
    version = await _get_latest_version(db, dataset_id)
    version_id = version.id if version else None

    mc = _get_minio_client()
    assets: list[ImageAsset] = []
    errors: list[str] = []

    for f in files:
        try:
            asset = await _process_single_upload(f, dataset_id, version_id, db, mc)
            assets.append(asset)
        except HTTPException as exc:
            errors.append(f"{f.filename}: {exc.detail}")
            logger.warning("Batch upload skipped '%s': %s", f.filename, exc.detail)
        except Exception as exc:
            errors.append(f"{f.filename}: {str(exc)}")
            logger.error("Unexpected error uploading '%s': %s", f.filename, exc, exc_info=True)

    if assets:
        await db.commit()

    return ImageBatchResponse(
        assets=[_asset_to_response(a, mc) for a in assets],
        total_uploaded=len(assets),
        errors=errors,
    )


class ModelStatusResponse(BaseModel):
    model: str
    ready: bool
    loaded: bool


@router.get("/model/status", response_model=ModelStatusResponse)
async def clip_model_status(current_user: User = Depends(get_current_user)):
    """Whether the CLIP model is available locally (no download needed).

    Declared before the /{dataset_id}/{asset_id} route so the literal "model"
    segment is not parsed as a dataset UUID.
    """
    from image_pipeline.clip_embedder import clip_model_ready, clip_model_loaded
    name = settings.CLIP_MODEL_NAME
    return ModelStatusResponse(
        model=name,
        ready=clip_model_ready(name),
        loaded=clip_model_loaded(name),
    )


@router.post(
    "/model/prepare",
    response_model=ImageTaskResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def clip_model_prepare(
    dataset_id: UUID = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start a tracked, one-time CLIP model download/load so the UI can show
    live progress (reuses the background-task progress bar)."""
    await _validate_dataset(db, dataset_id)
    celery_task_id = str(_uuid.uuid4())
    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="image_model_prepare",
        dataset_id=dataset_id,
        parameters={"model": settings.CLIP_MODEL_NAME},
    )
    await db.commit()
    from data_intelligence.tasks.image_tasks import prepare_clip_model
    prepare_clip_model.apply_async(
        kwargs={"dataset_id": str(dataset_id)},
        task_id=celery_task_id,
    )
    return ImageTaskResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message="Model preparation started",
    )


@router.get("/{dataset_id}/gallery", response_model=GalleryResponse)
async def get_gallery(
    dataset_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    cluster_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return paginated image gallery with presigned thumbnail URLs."""
    await _validate_dataset(db, dataset_id)

    # Base filter
    where_clauses = [ImageAsset.dataset_id == dataset_id]
    if cluster_id is not None:
        where_clauses.append(ImageAsset.cluster_id == cluster_id)

    # Total count
    count_stmt = select(func.count(ImageAsset.id)).where(*where_clauses)
    total = (await db.execute(count_stmt)).scalar() or 0

    # How many images in this dataset already have an embedding (drives the
    # "embeddings done — clustering/search unlocked" state in the UI).
    embedded_stmt = select(func.count(ImageAsset.id)).where(
        ImageAsset.dataset_id == dataset_id,
        ImageAsset.embedding_id.is_not(None),
    )
    embedded_count = (await db.execute(embedded_stmt)).scalar() or 0

    # Paginated query
    stmt = (
        select(ImageAsset)
        .where(*where_clauses)
        .order_by(ImageAsset.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    mc = _get_minio_client()
    return GalleryResponse(
        images=[_asset_to_response(a, mc) for a in rows],
        total=total,
        embedded_count=embedded_count,
    )


@router.get("/{dataset_id}/{asset_id}", response_model=ImageAssetResponse)
async def get_image_detail(
    dataset_id: UUID,
    asset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return full metadata and presigned URLs for a single image asset."""
    stmt = select(ImageAsset).where(
        ImageAsset.id == asset_id,
        ImageAsset.dataset_id == dataset_id,
    )
    result = await db.execute(stmt)
    asset = result.scalars().first()

    if asset is None:
        raise HTTPException(status_code=404, detail="Image asset not found")

    mc = _get_minio_client()
    return _asset_to_response(asset, mc)


@router.post(
    "/{dataset_id}/embeddings",
    response_model=ImageTaskResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_embeddings(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger async CLIP embedding generation for all images in a dataset."""
    await _validate_dataset(db, dataset_id)

    celery_task_id = str(_uuid.uuid4())

    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="image_embeddings",
        dataset_id=dataset_id,
        parameters={"model": settings.CLIP_MODEL_NAME},
    )

    # Commit so the row is visible to the Celery worker before dispatch
    await db.commit()

    from data_intelligence.tasks.image_tasks import generate_image_embeddings

    generate_image_embeddings.apply_async(
        kwargs={"dataset_id": str(dataset_id)},
        task_id=celery_task_id,
    )

    return ImageTaskResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"CLIP embedding generation started for dataset {dataset_id}",
    )


@router.post(
    "/{dataset_id}/cluster",
    response_model=ImageTaskResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_clustering(
    dataset_id: UUID,
    payload: ClusterRequest = ClusterRequest(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger async image clustering based on CLIP embeddings."""
    await _validate_dataset(db, dataset_id)

    celery_task_id = str(_uuid.uuid4())

    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="image_clustering",
        dataset_id=dataset_id,
        parameters={"min_cluster_size": payload.min_cluster_size},
    )

    await db.commit()

    from data_intelligence.tasks.image_tasks import run_image_clustering

    run_image_clustering.apply_async(
        kwargs={
            "dataset_id": str(dataset_id),
            "min_cluster_size": payload.min_cluster_size,
        },
        task_id=celery_task_id,
    )

    return ImageTaskResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"Image clustering started for dataset {dataset_id}",
    )


@router.get("/{dataset_id}/clusters")
async def get_clusters(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return clustering results: cluster sizes and assets per cluster."""
    await _validate_dataset(db, dataset_id)

    # Cluster size summary
    summary_stmt = (
        select(
            ImageAsset.cluster_id,
            func.count(ImageAsset.id).label("count"),
        )
        .where(
            ImageAsset.dataset_id == dataset_id,
            ImageAsset.cluster_id.is_not(None),
        )
        .group_by(ImageAsset.cluster_id)
        .order_by(ImageAsset.cluster_id)
    )
    summary_result = await db.execute(summary_stmt)
    cluster_summary = {row.cluster_id: row.count for row in summary_result}

    # Assets grouped by cluster
    assets_stmt = (
        select(ImageAsset)
        .where(
            ImageAsset.dataset_id == dataset_id,
            ImageAsset.cluster_id.is_not(None),
        )
        .order_by(ImageAsset.cluster_id, ImageAsset.created_at)
    )
    assets_result = await db.execute(assets_stmt)
    assets = assets_result.scalars().all()

    mc = _get_minio_client()
    clusters: dict[int, list[ImageAssetResponse]] = {}
    for asset in assets:
        cid = asset.cluster_id
        clusters.setdefault(cid, []).append(_asset_to_response(asset, mc))

    # Count unclustered
    unclustered_stmt = select(func.count(ImageAsset.id)).where(
        ImageAsset.dataset_id == dataset_id,
        ImageAsset.cluster_id.is_(None),
    )
    unclustered_count = (await db.execute(unclustered_stmt)).scalar() or 0

    return {
        "dataset_id": str(dataset_id),
        "cluster_summary": cluster_summary,
        "unclustered_count": unclustered_count,
        "clusters": {str(k): v for k, v in clusters.items()},
    }


@router.post("/{dataset_id}/search", response_model=list[SearchResult])
async def search_images(
    dataset_id: UUID,
    payload: SearchRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Text-to-image similarity search using CLIP embeddings and Qdrant."""
    await _validate_dataset(db, dataset_id)

    from image_pipeline.clip_embedder import embed_text, search_similar

    # Generate text embedding
    try:
        query_vector = embed_text(payload.query_text, model_name=settings.CLIP_MODEL_NAME)
    except Exception as exc:
        logger.error("CLIP text embedding failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate text embedding for search query",
        )

    # Embeddings are written to a per-dataset collection by the image task
    # (store_image_vectors_in_qdrant with f"{dataset_id}_images"); query that
    # same collection. The global settings.QDRANT_IMAGE_COLLECTION is never
    # populated, which is why search previously always came back empty.
    collection_name = f"{dataset_id}_images"

    # search_similar() logs-and-swallows a missing-collection error and returns
    # [], so a search issued before embeddings exist would masquerade as an
    # empty-but-successful result. Surface that state distinctly instead.
    embedded_stmt = select(func.count(ImageAsset.id)).where(
        ImageAsset.dataset_id == dataset_id,
        ImageAsset.embedding_id.is_not(None),
    )
    embedded_count = (await db.execute(embedded_stmt)).scalar() or 0
    if embedded_count == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "No image embeddings found for this dataset. Generate "
                "embeddings before running a similarity search."
            ),
        )

    # Search Qdrant
    hits = search_similar(
        query_vector=query_vector,
        collection_name=collection_name,
        top_k=payload.top_k,
    )

    if not hits:
        return []

    # Resolve asset IDs from Qdrant payloads
    hit_map: dict[str, float] = {}
    for h in hits:
        asset_id_str = h.get("payload", {}).get("asset_id")
        if asset_id_str:
            hit_map[asset_id_str] = h.get("score", 0.0)

    if not hit_map:
        return []

    # Fetch matching assets that belong to this dataset
    asset_ids = [_uuid.UUID(aid) for aid in hit_map]
    stmt = select(ImageAsset).where(
        ImageAsset.id.in_(asset_ids),
        ImageAsset.dataset_id == dataset_id,
    )
    result = await db.execute(stmt)
    assets_by_id = {str(a.id): a for a in result.scalars().all()}

    mc = _get_minio_client()
    results: list[SearchResult] = []
    for aid_str, score in sorted(hit_map.items(), key=lambda x: x[1], reverse=True):
        asset = assets_by_id.get(aid_str)
        if asset:
            results.append(
                SearchResult(
                    asset=_asset_to_response(asset, mc),
                    score=score,
                )
            )

    return results


# ── Proxy endpoint — serves images directly from MinIO ─────────────────


@router.get("/{dataset_id}/{asset_id}/file")
async def proxy_image_file(
    dataset_id: UUID,
    asset_id: UUID,
    thumb: bool = Query(False),
    current_user: User = Depends(_user_from_header_or_query),
    db: AsyncSession = Depends(get_db),
):
    """Stream an image file (original or thumbnail) from MinIO storage.

    Authenticated via the Authorization header *or* a ``?token=`` query
    parameter so browser ``<img>`` tags can load proxied images.
    """
    stmt = select(ImageAsset).where(
        ImageAsset.id == asset_id,
        ImageAsset.dataset_id == dataset_id,
    )
    result = await db.execute(stmt)
    asset = result.scalars().first()
    if asset is None:
        raise HTTPException(status_code=404, detail="Image asset not found")

    object_name = asset.thumbnail_path if thumb else asset.original_path
    if not object_name:
        raise HTTPException(status_code=404, detail="File not available")

    mc = _get_minio_client()
    try:
        response = mc.get_object(settings.MINIO_BUCKET_NAME, object_name)
        content_type = asset.mime_type or "image/jpeg"
        return StreamingResponse(
            response,
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except Exception as exc:
        logger.error("Failed to proxy image '%s': %s", object_name, exc)
        raise HTTPException(status_code=500, detail="Failed to retrieve image")


# ── Delete endpoint ────────────────────────────────────────────────────


@router.delete("/{dataset_id}/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_image(
    dataset_id: UUID,
    asset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an image asset and its MinIO objects."""
    stmt = select(ImageAsset).where(
        ImageAsset.id == asset_id,
        ImageAsset.dataset_id == dataset_id,
    )
    result = await db.execute(stmt)
    asset = result.scalars().first()
    if asset is None:
        raise HTTPException(status_code=404, detail="Image asset not found")

    mc = _get_minio_client()
    # Remove objects from MinIO
    for path in [asset.original_path, asset.thumbnail_path]:
        if path:
            try:
                mc.remove_object(settings.MINIO_BUCKET_NAME, path)
            except Exception as exc:
                logger.warning("Failed to remove MinIO object '%s': %s", path, exc)

    await db.execute(
        sa_delete(ImageAsset).where(ImageAsset.id == asset_id)
    )
    await db.commit()
