"""
FastAPI router for the Data Ingestion API.

Prefix: /api/v1/datasets

All endpoints require authentication.  Role gates are enforced via the
Phase D: single-user mode, no auth, no RBAC.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import logging
from typing import Optional
from uuid import UUID

import csv as csv_mod

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from core.models.dataset import Dataset, DatasetMetadata, DatasetVersion
from core.services.auth_service import User
from core.services.auth_service import get_current_user
from core.services.dataset_access_service import (
    assert_dataset_access,
    dataset_access_filter,
)

from .schemas import (
    DatasetCreate,
    DatasetListResponse,
    DatasetMetadataResponse,
    DatasetMetadataUpdate,
    DatasetPreviewResponse,
    DatasetResponse,
    DatasetStatusUpdate,
    DatasetVersionResponse,
    UploadResponse,
    ValidationResultResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/datasets", tags=["datasets"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MAX_UPLOAD_SIZE = 500 * 1024 * 1024  # 500 MB
ALLOWED_FILE_TYPES = {"text/csv", "application/json", "text/plain"}
ALLOWED_EXTENSIONS = {".csv", ".json", ".jsonl", ".txt", ".tsv"}


def _get_extension(filename: str) -> str:
    """Return the lowercased file extension including the leading dot."""
    idx = filename.rfind(".")
    return filename[idx:].lower() if idx != -1 else ""


# Single source of truth for which delimiters we sniff in CSV-style files.
# Order matters only for tie-breaking — we always prefer the one that yields
# the most columns on the header line, falling back to comma.
_DELIMITER_CANDIDATES = (",", ";", "\t", "|")


def _find_data_start_line(text: str, delim: str) -> int:
    """Find the line index where the real tabular data begins.

    Some CSVs (UCI datasets, BI exports, kaggle bundles) prepend
    descriptive metadata lines before the actual header. pandas chokes
    on these with "Expected N fields in line K". We detect this shape by
    finding the most common *multi-field* line count — if it covers at
    least 3 lines, we treat its first occurrence as the real header.

    We ignore single-field lines because a long descriptive prelude can
    outnumber the data rows; we want the most popular *tabular* shape,
    not the popular shape overall.

    Returns 0 (no skip) when the file looks normal.
    """
    lines = text.splitlines()[:200]
    if len(lines) < 3:
        return 0
    counts = [(i, line.count(delim) + 1) for i, line in enumerate(lines) if line.strip()]
    if not counts:
        return 0
    from collections import Counter
    multi_field = [c for _, c in counts if c >= 2]
    if not multi_field:
        return 0
    target_count, target_freq = Counter(multi_field).most_common(1)[0]
    if target_freq < 3:
        return 0
    if counts[0][1] == target_count:
        return 0
    for idx, cnt in counts:
        if cnt == target_count:
            return idx
    return 0


def _decode_flexible(raw_bytes: bytes) -> tuple[str, str]:
    """Decode ``raw_bytes`` to text, trying common encodings.

    Returns ``(text, encoding_used)``. Tries (in order): UTF-8 with BOM,
    UTF-8, UTF-16 (LE/BE BOM), then ``charset-normalizer`` if available,
    and finally CP1252 / Latin-1 as a last resort (these never raise so
    we'll always get *something* back).

    This is what lets users upload Excel-exported CSVs (typically
    Windows-1252), German / French datasets (ISO-8859-1), or UTF-16-LE
    files from Power BI exports without seeing a generic "not UTF-8"
    rejection.
    """
    # BOM-prefixed UTF-8 (Excel often writes this).
    if raw_bytes.startswith(b"\xef\xbb\xbf"):
        try:
            return raw_bytes.decode("utf-8-sig"), "utf-8-sig"
        except UnicodeDecodeError:
            pass
    # UTF-16 with BOM.
    if raw_bytes[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return raw_bytes.decode("utf-16"), "utf-16"
        except UnicodeDecodeError:
            pass
    # Strict UTF-8 — the common case.
    try:
        return raw_bytes.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        pass
    # Try charset-normalizer for trickier encodings.
    try:
        from charset_normalizer import from_bytes as _cn_from_bytes  # type: ignore
        result = _cn_from_bytes(raw_bytes[:65536]).best()
        if result is not None and result.encoding:
            enc = result.encoding
            try:
                return raw_bytes.decode(enc), enc
            except (UnicodeDecodeError, LookupError):
                pass
    except ImportError:
        pass
    # Last-resort fallbacks that never raise. CP1252 is Excel's default on
    # Windows; Latin-1 maps every byte 0-255 so it always succeeds.
    for enc in ("cp1252", "latin-1"):
        try:
            return raw_bytes.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return raw_bytes.decode("utf-8", errors="replace"), "utf-8 (with replacement)"


def _sniff_delimiter(text_sample: str, ext: str) -> str:
    """Detect the most likely field delimiter for a CSV-style file.

    Defaults: ``\t`` for ``.tsv`` and ``,`` for ``.csv`` / ``.txt`` if no
    candidate clearly wins. Otherwise picks whichever delimiter splits the
    first non-empty line into the most fields — that's a robust heuristic
    for the four common cases (comma, semicolon, tab, pipe) and handles the
    Adult-style ``a;b;c`` datasets the user just hit.

    Tries Python's ``csv.Sniffer`` first because it correctly ignores
    delimiters inside quoted strings; falls back to the field-count
    heuristic if Sniffer can't decide.
    """
    default = "\t" if ext == ".tsv" else ","
    if not text_sample:
        return default

    # Grab a meaningful sample — first ~16 KB, ending on a newline.
    sample = text_sample[:16384]
    last_nl = sample.rfind("\n")
    if last_nl > 200:
        sample = sample[:last_nl]

    # Try csv.Sniffer first.
    try:
        dialect = csv_mod.Sniffer().sniff(sample, delimiters="".join(_DELIMITER_CANDIDATES))
        if dialect.delimiter in _DELIMITER_CANDIDATES:
            return dialect.delimiter
    except Exception:  # noqa: BLE001
        pass

    # Fall back to "whichever delimiter splits the first line into the most
    # columns" — and only override the default if the winner has at least 2
    # fields (so single-column files don't accidentally pick up stray chars).
    first_line = sample.split("\n", 1)[0]
    best_delim = default
    best_count = first_line.count(default) + 1
    for cand in _DELIMITER_CANDIDATES:
        count = first_line.count(cand) + 1
        if count > best_count and count >= 2:
            best_count = count
            best_delim = cand
    return best_delim


def _extract_columns(raw_bytes: bytes, file_name: str) -> list[str]:
    """Best-effort extraction of column names from a dataset file's header."""
    ext = _get_extension(file_name)
    try:
        if ext in (".csv", ".tsv", ".txt"):
            text = raw_bytes.decode("utf-8", errors="replace")
            delimiter = _sniff_delimiter(text, ext)
            # Skip any prelude metadata lines so the header we pick is the
            # actual tabular header, not free-text from a README block.
            skip = _find_data_start_line(text, delimiter)
            lines = text.split("\n")
            header_line = lines[skip] if skip < len(lines) else lines[0]
            reader = csv_mod.reader(io.StringIO(header_line), delimiter=delimiter)
            return [c.strip() for c in next(reader, []) if c.strip()]
        if ext in (".json", ".jsonl"):
            text = raw_bytes.decode("utf-8", errors="replace").strip()
            if ext == ".jsonl":
                first = text.splitlines()[0] if text else "{}"
                obj = json.loads(first)
            else:
                parsed = json.loads(text)
                obj = parsed[0] if isinstance(parsed, list) and parsed else parsed
            if isinstance(obj, dict):
                return list(obj.keys())
    except Exception:  # noqa: BLE001
        return []
    return []


def _extract_preview(raw_bytes: bytes, file_name: str, limit: int = 10) -> tuple[list[str], list[list]]:
    """Return the first ``limit`` rows of a file as (columns, rows) for inline preview."""
    ext = _get_extension(file_name)
    try:
        if ext in (".csv", ".tsv", ".txt"):
            text = raw_bytes.decode("utf-8", errors="replace")
            delimiter = _sniff_delimiter(text, ext)
            # Skip prelude metadata so the preview shows the actual table.
            skip = _find_data_start_line(text, delimiter)
            if skip > 0:
                # Trim the prelude before handing to the csv reader.
                lines = text.split("\n")
                text = "\n".join(lines[skip:])
            reader = csv_mod.reader(io.StringIO(text), delimiter=delimiter)
            header = next(reader, [])
            columns = [c.strip() for c in header]
            rows: list[list] = []
            for i, row in enumerate(reader):
                if i >= limit:
                    break
                rows.append([str(v) for v in row])
            return columns, rows
        if ext in (".json", ".jsonl"):
            text = raw_bytes.decode("utf-8", errors="replace").strip()
            if ext == ".jsonl":
                parsed: list = []
                for ln in text.splitlines()[: limit + 5]:
                    if not ln.strip():
                        continue
                    try:
                        parsed.append(json.loads(ln))
                    except Exception:  # noqa: BLE001
                        continue
                    if len(parsed) >= limit:
                        break
            else:
                raw_parsed = json.loads(text)
                parsed = raw_parsed if isinstance(raw_parsed, list) else [raw_parsed]
                parsed = parsed[:limit]
            if not parsed:
                return [], []
            if isinstance(parsed[0], dict):
                cols: list[str] = list(parsed[0].keys())
                seen = set(cols)
                for obj in parsed[1:]:
                    if isinstance(obj, dict):
                        for k in obj.keys():
                            if k not in seen:
                                cols.append(k)
                                seen.add(k)
                rows = [
                    [
                        ("" if not isinstance(obj, dict) else (
                            "" if obj.get(c) is None else str(obj.get(c))
                        ))
                        for c in cols
                    ]
                    for obj in parsed
                ]
                return cols, rows
    except Exception:  # noqa: BLE001
        return [], []
    return [], []


async def _get_dataset_or_404(
    db: AsyncSession,
    dataset_id: UUID,
    user: Optional[User] = None,
) -> Dataset:
    """Fetch a dataset by primary key, optionally enforcing user access.

    When ``user`` is provided we route through
    :func:`assert_dataset_access` so callers get cross-org isolation for
    free. When omitted we fall back to the original "just fetch" behaviour
    — used by background tasks / internal callers that aren't acting on
    behalf of a specific user.
    """
    if user is not None:
        return await assert_dataset_access(db, dataset_id, user)
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalars().first()
    if dataset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )
    return dataset


def _validate_file_content(
    raw_bytes: bytes,
    file_name: str,
    file_type: str,
) -> ValidationResultResponse:
    """Perform lightweight validation on an uploaded file.

    Returns a ``ValidationResultResponse`` with schema information and any
    errors or warnings detected.
    """
    errors: list[str] = []
    warnings: list[str] = []
    columns: list[str] = []
    row_count = 0
    column_count = 0
    sample_data: list[dict] = []

    ext = _get_extension(file_name)
    schema_hash = hashlib.sha256(raw_bytes[:8192]).hexdigest()

    try:
        if ext in (".csv", ".tsv"):
            text, enc_used = _decode_flexible(raw_bytes)
            if enc_used != "utf-8":
                warnings.append(
                    f"File decoded as {enc_used} (not UTF-8). It will be re-encoded as "
                    "UTF-8 when processed. Verify special characters look correct in the preview."
                )
            delimiter = _sniff_delimiter(text, ext)
            reader = csv_mod.DictReader(io.StringIO(text), delimiter=delimiter)
            columns = reader.fieldnames or []
            column_count = len(columns)
            rows: list[dict] = []
            for row in reader:
                rows.append(row)
            row_count = len(rows)
            sample_data = rows[:5]
            if row_count == 0:
                warnings.append("File contains headers but no data rows")
            if column_count == 1 and delimiter == ",":
                warnings.append(
                    "Detected only one column with the default comma delimiter. "
                    "If your file uses ';' or '|' as separators and this looks wrong, "
                    "save it as a true comma-separated CSV and re-upload."
                )
        elif ext in (".json", ".jsonl"):
            text, enc_used = _decode_flexible(raw_bytes)
            if enc_used != "utf-8":
                warnings.append(f"File decoded as {enc_used} (not UTF-8).")
            if ext == ".jsonl":
                lines = [ln for ln in text.strip().splitlines() if ln.strip()]
                parsed = [json.loads(ln) for ln in lines]
            else:
                parsed_raw = json.loads(text)
                parsed = parsed_raw if isinstance(parsed_raw, list) else [parsed_raw]
            row_count = len(parsed)
            if parsed and isinstance(parsed[0], dict):
                columns = list(parsed[0].keys())
                column_count = len(columns)
            sample_data = parsed[:5]
            if row_count == 0:
                warnings.append("JSON file contains no records")
        elif ext == ".txt":
            text, _ = _decode_flexible(raw_bytes)
            lines = text.strip().splitlines()
            row_count = len(lines)
            columns = ["line"]
            column_count = 1
            sample_data = [{"line": ln} for ln in lines[:5]]
        else:
            errors.append(f"Unsupported file extension: {ext}")
    except json.JSONDecodeError as exc:
        errors.append(f"Invalid JSON: {exc}")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"Validation error: {exc}")

    return ValidationResultResponse(
        is_valid=len(errors) == 0,
        row_count=row_count,
        column_count=column_count,
        columns=columns,
        schema_hash=schema_hash,
        errors=errors,
        warnings=warnings,
        sample_data=sample_data,
    )


# ---------------------------------------------------------------------------
# POST / — Create dataset
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=DatasetResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_dataset(
    payload: DatasetCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new dataset record (no file upload yet)."""
    dataset = Dataset(
        name=payload.name,
        description=payload.description,
        source_type=payload.source_type,
        status="raw",
    )
    db.add(dataset)
    await db.flush()
    await db.refresh(dataset)


    return dataset


# ---------------------------------------------------------------------------
# POST /{dataset_id}/upload — Upload file to dataset
# ---------------------------------------------------------------------------


@router.post(
    "/{dataset_id}/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_file(
    dataset_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file to an existing dataset.

    The file is validated, stored in MinIO (object storage), and a new
    ``DatasetVersion`` is created.
    """
    dataset = await _get_dataset_or_404(db, dataset_id, current_user)

    # --- basic file checks ---
    file_name = file.filename or "upload"
    ext = _get_extension(file_name)
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{ext}' is not supported. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    raw_bytes = await file.read()
    file_size = len(raw_bytes)
    if file_size > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File exceeds maximum upload size of {MAX_UPLOAD_SIZE // (1024 * 1024)} MB",
        )
    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    # --- validate content ---
    file_type = file.content_type or "application/octet-stream"
    validation = _validate_file_content(raw_bytes, file_name, file_type)
    if not validation.is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "File validation failed",
                "errors": validation.errors,
            },
        )

    # --- determine version number ---
    latest_stmt = (
        select(func.max(DatasetVersion.version_number))
        .where(DatasetVersion.dataset_id == dataset_id)
    )
    result = await db.execute(latest_stmt)
    latest_version = result.scalar() or 0
    new_version_number = latest_version + 1

    # --- store in MinIO (object storage) ---
    storage_path = (
        f"datasets/{dataset_id}/v{new_version_number}/{file_name}"
    )
    try:
        # Lazy import — the storage module may not be installed in every
        # test environment but we must not let that break route loading.
        from ..storage.minio_client import minio_storage  # type: ignore[import-untyped]

        await minio_storage.upload_file(
            file_data=raw_bytes,
            file_name=file_name,
            content_type=file_type,
            dataset_id=str(dataset_id),
            version=new_version_number,
        )
    except ImportError:
        logger.warning(
            "MinIO storage module not available; file stored at logical path only"
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to upload to MinIO: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store file in object storage",
        ) from exc

    # --- find parent version id (if any) ---
    parent_version_id = None
    if latest_version > 0:
        parent_stmt = (
            select(DatasetVersion.id)
            .where(
                DatasetVersion.dataset_id == dataset_id,
                DatasetVersion.version_number == latest_version,
            )
        )
        parent_result = await db.execute(parent_stmt)
        parent_version_id = parent_result.scalar()

    # --- create version record ---
    version = DatasetVersion(
        dataset_id=dataset_id,
        version_number=new_version_number,
        storage_path=storage_path,
        file_name=file_name,
        file_size=file_size,
        file_type=file_type,
        schema_hash=validation.schema_hash,
        row_count=validation.row_count,
        parent_version_id=parent_version_id,
    )
    db.add(version)
    await db.flush()
    await db.refresh(version)
    await db.refresh(dataset)


    return UploadResponse(
        dataset=DatasetResponse.model_validate(dataset),
        version=DatasetVersionResponse.model_validate(version),
        validation=validation,
    )


# ---------------------------------------------------------------------------
# GET / — List datasets
# ---------------------------------------------------------------------------


@router.get("", response_model=DatasetListResponse)
async def list_datasets(
    status_filter: Optional[str] = Query(
        None, alias="status", pattern="^(raw|processed|labeled|reviewed|ready)$"
    ),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return a paginated list of datasets, optionally filtered by status.

    Scoped to datasets the caller is allowed to see — own-uploads, same-org,
    or org-shared (single-user mode: everything is yours).
    """
    base = select(Dataset)
    count_base = select(func.count(Dataset.id))

    # Privacy guard: restrict to datasets this user can see.
    access_clause = dataset_access_filter(current_user)
    if access_clause is not None:
        base = base.where(access_clause)
        count_base = count_base.where(access_clause)

    if status_filter:
        base = base.where(Dataset.status == status_filter)
        count_base = count_base.where(Dataset.status == status_filter)

    # total count
    total_result = await db.execute(count_base)
    total = total_result.scalar() or 0

    # paginated rows
    stmt = base.order_by(Dataset.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    datasets = list(result.scalars().all())

    # Pull row counts from each dataset's LATEST version so the list response
    # can show real numbers instead of "—".
    row_count_map: dict = {}
    version_count_map: dict = {}
    if datasets:
        ids = [d.id for d in datasets]
        latest_subq = (
            select(
                DatasetVersion.dataset_id,
                func.max(DatasetVersion.version_number).label("max_ver"),
            )
            .where(DatasetVersion.dataset_id.in_(ids))
            .group_by(DatasetVersion.dataset_id)
            .subquery()
        )
        rc_stmt = (
            select(DatasetVersion.dataset_id, DatasetVersion.row_count)
            .join(
                latest_subq,
                (DatasetVersion.dataset_id == latest_subq.c.dataset_id)
                & (DatasetVersion.version_number == latest_subq.c.max_ver),
            )
        )
        for did, rc in (await db.execute(rc_stmt)).all():
            row_count_map[did] = rc

        cnt_stmt = (
            select(DatasetVersion.dataset_id, func.count(DatasetVersion.id))
            .where(DatasetVersion.dataset_id.in_(ids))
            .group_by(DatasetVersion.dataset_id)
        )
        for did, cnt in (await db.execute(cnt_stmt)).all():
            version_count_map[did] = cnt

    out = []
    for d in datasets:
        # Build the response dict explicitly so the computed row_count /
        # version_count are not lost in a later re-validation pass. The
        # model_validate + assignment pattern was silently dropping these
        # values in some Pydantic v2 setups.
        base = DatasetResponse.model_validate(d).model_dump()
        base["row_count"] = row_count_map.get(d.id)
        base["version_count"] = version_count_map.get(d.id, 0)
        out.append(DatasetResponse(**base))

    return DatasetListResponse(
        datasets=out,
        total=total,
        skip=skip,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# GET /{dataset_id} — Dataset detail (with versions + metadata)
# ---------------------------------------------------------------------------


@router.get("/{dataset_id}")
async def get_dataset(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return full dataset detail including versions and metadata."""
    stmt = (
        select(Dataset)
        .options(
            selectinload(Dataset.versions),
            selectinload(Dataset.metadata_entries),
        )
        .where(Dataset.id == dataset_id)
    )
    result = await db.execute(stmt)
    dataset = result.scalars().first()
    if dataset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )

    return {
        "dataset": DatasetResponse.model_validate(dataset),
        "versions": [
            DatasetVersionResponse.model_validate(v) for v in dataset.versions
        ],
        "metadata": [
            DatasetMetadataResponse.model_validate(m)
            for m in dataset.metadata_entries
        ],
    }


# ---------------------------------------------------------------------------
# GET /{dataset_id}/versions — List versions
# ---------------------------------------------------------------------------


@router.get(
    "/{dataset_id}/versions",
    response_model=list[DatasetVersionResponse],
)
async def list_versions(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all versions of a dataset ordered by version number."""
    await _get_dataset_or_404(db, dataset_id, current_user)

    stmt = (
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset_id)
        .order_by(DatasetVersion.version_number.desc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# GET /{dataset_id}/columns — Column names of the latest version
# ---------------------------------------------------------------------------


@router.get("/{dataset_id}/columns")
async def get_dataset_columns(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the column names of a dataset's latest version.

    Powers the column dropdowns in the labeling UIs. Returns an empty list
    (never an error) when columns cannot be determined.
    """
    await _get_dataset_or_404(db, dataset_id, current_user)

    stmt = (
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset_id)
        .order_by(DatasetVersion.version_number.desc())
        .limit(1)
    )
    version = (await db.execute(stmt)).scalars().first()
    if version is None:
        return {"columns": []}

    try:
        from ..storage.minio_client import minio_storage  # type: ignore[import-untyped]

        # Header is in the first ~64KB — no need to drag the whole file.
        raw_bytes = await minio_storage.download_head(version.storage_path, 65536)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read file for columns (dataset %s): %s", dataset_id, exc)
        return {"columns": []}

    return {"columns": _extract_columns(raw_bytes, version.file_name or "data.csv")}


# ---------------------------------------------------------------------------
# GET /{dataset_id}/column-types — Bulk dtype info for every column
# ---------------------------------------------------------------------------


@router.get("/{dataset_id}/column-types")
async def get_column_types(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return ``[{name, is_numeric}]`` for every column in the latest version.

    Used by EDA Graphs to gate column dropdowns by what each chart accepts.
    """
    dataset = await _get_dataset_or_404(db, dataset_id, current_user)
    if dataset.source_type == "image":
        return {"columns": []}

    v_stmt = (
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset_id)
        .order_by(DatasetVersion.version_number.desc())
        .limit(1)
    )
    version = (await db.execute(v_stmt)).scalars().first()
    if version is None:
        return {"columns": []}

    try:
        from data_intelligence.tasks.structuring_tasks import _load_dataset_file  # type: ignore
        df = await asyncio.to_thread(
            _load_dataset_file, str(dataset_id), version.version_number,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not load dataset for column-types: %s", exc)
        return {"columns": []}

    import pandas as _pd  # type: ignore
    out: list[dict] = []
    for c in df.columns:
        s = df[c]
        is_numeric = bool(_pd.api.types.is_numeric_dtype(s)) and not bool(_pd.api.types.is_bool_dtype(s))
        out.append({"name": str(c), "is_numeric": is_numeric})
    return {"columns": out}


# ---------------------------------------------------------------------------
# GET /{dataset_id}/column-values — Distinct values + dtype for a column
# ---------------------------------------------------------------------------


@router.get("/{dataset_id}/column-values")
async def get_column_values(
    dataset_id: UUID,
    column: str = Query(..., min_length=1, description="Column name to inspect"),
    limit: int = Query(100, ge=1, le=500, description="Max distinct values to return"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return whether a column is numeric and its distinct (non-null) values.

    Used by the Labeling UI to swap the rule "value" input for a dropdown
    when the chosen column is non-numerical (e.g. gender → male/female/other).
    """
    dataset = await _get_dataset_or_404(db, dataset_id, current_user)
    if dataset.source_type == "image":
        raise HTTPException(status_code=400, detail="Column values not available for image datasets")

    v_stmt = (
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset_id)
        .order_by(DatasetVersion.version_number.desc())
        .limit(1)
    )
    version = (await db.execute(v_stmt)).scalars().first()
    if version is None:
        raise HTTPException(status_code=400, detail="Dataset has no uploaded versions yet")

    # Reuse the same loader the EDA / structuring pipelines use so behaviour
    # is consistent across formats (csv/tsv/json/jsonl).
    try:
        from data_intelligence.tasks.structuring_tasks import _load_dataset_file  # type: ignore
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not import _load_dataset_file: %s", exc)
        raise HTTPException(status_code=500, detail="Dataset loader unavailable")

    try:
        df = await asyncio.to_thread(
            _load_dataset_file, str(dataset_id), version.version_number,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not load dataset file: {exc}")

    if column not in df.columns:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{column}' not found. Available: {list(df.columns)}",
        )

    try:
        import pandas as _pd  # type: ignore
        col = df[column]
        is_numeric = bool(_pd.api.types.is_numeric_dtype(col)) and not bool(_pd.api.types.is_bool_dtype(col))
    except Exception:  # noqa: BLE001
        is_numeric = False
        col = df[column]

    distinct: list = []
    truncated = False
    stats: dict = {}
    if not is_numeric:
        try:
            uniq = col.dropna().astype(str).unique().tolist()
        except Exception:  # noqa: BLE001
            uniq = [str(v) for v in col.tolist() if v is not None and str(v) != "nan"]
            # De-duplicate while preserving order
            seen: set = set()
            uniq = [x for x in uniq if not (x in seen or seen.add(x))]
        if len(uniq) > limit:
            truncated = True
            uniq = uniq[:limit]
        try:
            uniq.sort(key=lambda x: str(x).lower())
        except Exception:  # noqa: BLE001
            pass
        distinct = uniq
    else:
        # Numeric columns: surface min/max/mean so the labeling UI can show
        # a hint like "values range from 18 to 65 (mean 34.2)".
        try:
            clean = col.dropna()
            if len(clean) > 0:
                stats = {
                    "min": float(clean.min()),
                    "max": float(clean.max()),
                    "mean": round(float(clean.mean()), 4),
                }
        except Exception:  # noqa: BLE001
            stats = {}

    return {
        "column": column,
        "is_numeric": is_numeric,
        "values": distinct,
        "truncated": truncated,
        "stats": stats,
    }


# ---------------------------------------------------------------------------
# GET /{dataset_id}/preview — Head-of-file preview for the Datasets page
# ---------------------------------------------------------------------------


@router.get("/{dataset_id}/preview", response_model=DatasetPreviewResponse)
async def get_dataset_preview(
    dataset_id: UUID,
    limit: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return a small head-of-file preview of a dataset's latest version.

    Image datasets return an empty preview (the UI should use the gallery
    endpoint to show thumbnails for those).
    """
    dataset = await _get_dataset_or_404(db, dataset_id, current_user)
    if dataset.source_type == "image":
        return DatasetPreviewResponse(columns=[], rows=[], row_count=None, truncated=False)

    stmt = (
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset_id)
        .order_by(DatasetVersion.version_number.desc())
        .limit(1)
    )
    version = (await db.execute(stmt)).scalars().first()
    if version is None:
        return DatasetPreviewResponse(columns=[], rows=[], row_count=0, truncated=False)

    try:
        from ..storage.minio_client import minio_storage  # type: ignore[import-untyped]

        # Only pull the first ~256KB — more than enough for 10 rows of any
        # reasonable schema and avoids dragging multi-MB files over the wire
        # just to render an inline preview card.
        raw_bytes = await minio_storage.download_head(version.storage_path, 262144)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read preview for dataset %s: %s", dataset_id, exc)
        return DatasetPreviewResponse(
            columns=[], rows=[], row_count=version.row_count, truncated=False,
        )

    cols, rows = _extract_preview(raw_bytes, version.file_name or "data.csv", limit=limit)
    truncated = bool(version.row_count) and version.row_count > len(rows)
    return DatasetPreviewResponse(
        columns=cols,
        rows=rows,
        row_count=version.row_count,
        truncated=truncated,
    )


# ---------------------------------------------------------------------------
# PUT /{dataset_id}/status — Update lifecycle status
# ---------------------------------------------------------------------------


@router.put("/{dataset_id}/status", response_model=DatasetResponse)
async def update_status(
    dataset_id: UUID,
    payload: DatasetStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Transition a dataset to a new lifecycle status.

    Only reviewers and admins may perform status transitions.
    """
    dataset = await _get_dataset_or_404(db, dataset_id, current_user)
    old_status = dataset.status
    dataset.status = payload.status
    await db.flush()
    await db.refresh(dataset)


    return dataset


# ---------------------------------------------------------------------------
# PUT /{dataset_id}/metadata — Add / update metadata
# ---------------------------------------------------------------------------


@router.put(
    "/{dataset_id}/metadata",
    response_model=DatasetMetadataResponse,
)
async def upsert_metadata(
    dataset_id: UUID,
    payload: DatasetMetadataUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create or update a metadata key-value pair on a dataset."""
    await _get_dataset_or_404(db, dataset_id, current_user)

    # Check if key already exists for this dataset
    stmt = select(DatasetMetadata).where(
        DatasetMetadata.dataset_id == dataset_id,
        DatasetMetadata.key == payload.key,
    )
    result = await db.execute(stmt)
    existing = result.scalars().first()

    if existing:
        existing.value = payload.value
        await db.flush()
        await db.refresh(existing)
        meta = existing
    else:
        meta = DatasetMetadata(
            dataset_id=dataset_id,
            key=payload.key,
            value=payload.value,
        )
        db.add(meta)
        await db.flush()
        await db.refresh(meta)


    return meta



# ---------------------------------------------------------------------------
# DELETE /{dataset_id} — Delete dataset
# ---------------------------------------------------------------------------


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a dataset and all related records.  Admin only.

    Versions, metadata, and permissions are cascade-deleted by the database.
    Stored files in MinIO are cleaned up on a best-effort basis.
    """
    dataset = await _get_dataset_or_404(db, dataset_id, current_user)

    # Attempt to remove objects from MinIO
    try:
        from ..storage.minio_client import minio_storage  # type: ignore[import-untyped]

        versions_stmt = select(DatasetVersion).where(
            DatasetVersion.dataset_id == dataset_id
        )
        versions_result = await db.execute(versions_stmt)
        for version in versions_result.scalars().all():
            try:
                await minio_storage.delete_file(version.storage_path)
            except Exception:  # noqa: BLE001
                logger.warning(
                    "Failed to delete MinIO object: %s", version.storage_path
                )
    except ImportError:
        logger.warning("MinIO storage module not available; skipping object cleanup")

    dataset_name = dataset.name
    await db.delete(dataset)
    await db.flush()


    return None
