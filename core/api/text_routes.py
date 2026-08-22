"""
Text Labeling API — upload .txt/.md files into text datasets, browse and
annotate the resulting documents (doc-level labels + character spans), and
export the labels synchronously as JSONL / CSV / spaCy-style spans-JSONL.

Contract: frontend/Frontend/src/shared/api/text.ts — field names and shapes
here mirror that file exactly.
"""

import csv
import io
import json
import logging
import re
import uuid as _uuid
from pathlib import Path
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from minio import Minio
from pydantic import BaseModel
from sqlalchemy import delete as sa_delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models.annotation import AnnotationClass, TextAnnotation, TextDocument
from core.models.dataset import Dataset, DatasetVersion
from core.services.auth_service import User, get_current_user
from core.settings import settings
from core.storage import get_minio_client as _get_minio_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/text", tags=["text"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_MAX_TEXT_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB per file
_ALLOWED_TEXT_EXTENSIONS = {".txt", ".md", ".text"}
_SPLIT_STRATEGIES = {"auto", "file", "blank_line", "line"}
_PREVIEW_CHARS = 180
_SNIPPET_CHARS = 200
_BLANK_LINE_RE = re.compile(r"\n\s*\n+")


# ── Schemas ──────────────────────────────────────────────────────────────


class TextUploadResponse(BaseModel):
    documents_created: int
    total_documents: int
    strategy_used: str
    warnings: list[str]


class DocLabel(BaseModel):
    class_id: UUID
    name: str
    color: str


class TextDocListItem(BaseModel):
    id: UUID
    doc_index: int
    name: str
    char_count: int
    status: str
    preview: str
    doc_labels: list[DocLabel]
    span_count: int


class TextDocListResponse(BaseModel):
    items: list[TextDocListItem]
    total: int


class TextAnnotationOut(BaseModel):
    id: UUID
    class_id: UUID
    kind: str
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    snippet: Optional[str] = None


class TextAnnotationIn(BaseModel):
    class_id: UUID
    kind: Literal["doc", "span"]
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None


class SaveAnnotationsRequest(BaseModel):
    annotations: list[TextAnnotationIn]


class SaveAnnotationsResponse(BaseModel):
    annotations: list[TextAnnotationOut]
    status: str


class TextDocDetailResponse(BaseModel):
    id: UUID
    doc_index: int
    name: str
    content: str
    status: str
    annotations: list[TextAnnotationOut]
    prev_doc_id: Optional[UUID] = None
    next_doc_id: Optional[UUID] = None


class ClassCount(BaseModel):
    class_id: UUID
    name: str
    color: str
    count: int


class TextSummary(BaseModel):
    total_documents: int
    labeled: int
    unlabeled: int
    total_spans: int
    class_counts: list[ClassCount]


class TextExportRequest(BaseModel):
    format: Literal["jsonl", "csv", "spans-jsonl"]


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


def _decode_flexible(raw_bytes: bytes) -> tuple[str, str]:
    """Decode ``raw_bytes`` to text, trying common encodings.

    Returns ``(text, encoding_used)``. Tries (in order): UTF-8 with BOM,
    UTF-16 (LE/BE BOM), strict UTF-8, then CP1252 / Latin-1 as a last
    resort. Never raises — Latin-1 maps every byte 0-255, so we always get
    *something* back.
    """
    # BOM-prefixed UTF-8 (Excel and Notepad often write this).
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
    # BOM-less UTF-16: ASCII-ish UTF-16 bytes are valid UTF-8 too, but the
    # interleaved NULs would corrupt the text (and Postgres TEXT rejects
    # \x00). Detect via NUL density in a sample and pick the right variant.
    sample = raw_bytes[:4096]
    if sample and sample.count(b"\x00") > len(sample) / 3:
        # ASCII text as UTF-16-LE puts NULs at odd offsets; BE at even ones.
        odd_nuls = sample[1::2].count(0)
        even_nuls = sample[::2].count(0)
        candidates = ["utf-16-le", "utf-16-be"] if odd_nuls >= even_nuls else ["utf-16-be", "utf-16-le"]
        for enc in candidates:
            try:
                decoded = raw_bytes.decode(enc)
            except UnicodeDecodeError:
                continue
            if "\x00" not in decoded:
                return decoded, f"{enc} (no BOM)"
    # Strict UTF-8 — the common case.
    try:
        return _strip_nul(raw_bytes.decode("utf-8")), "utf-8"
    except UnicodeDecodeError:
        pass
    # Last-resort fallbacks. CP1252 is Windows' default; Latin-1 always succeeds.
    for enc in ("cp1252", "latin-1"):
        try:
            return _strip_nul(raw_bytes.decode(enc)), enc
        except UnicodeDecodeError:
            continue
    return _strip_nul(raw_bytes.decode("utf-8", errors="replace")), "utf-8 (with replacement)"


def _strip_nul(text: str) -> str:
    """Remove NUL characters — Postgres TEXT columns reject \\x00."""
    return text.replace("\x00", "")


def _normalize_newlines(text: str) -> str:
    """Normalize CRLF / CR line endings to bare LF."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _split_blank_line(text: str) -> list[str]:
    """Split text into blank-line-separated blocks (stripped, non-empty)."""
    blocks = [b.strip() for b in _BLANK_LINE_RE.split(text)]
    return [b for b in blocks if b]


def _split_text(text: str, strategy: str) -> tuple[list[str], str]:
    """Split normalized text per ``strategy``.

    Returns ``(pieces, resolved_strategy)`` — for 'auto', the resolved
    strategy is 'blank_line' when the text yields at least 3 blocks,
    otherwise 'file'.
    """
    if strategy == "auto":
        blocks = _split_blank_line(text)
        if len(blocks) >= 3:
            return blocks, "blank_line"
        return ([text] if text.strip() else []), "file"
    if strategy == "blank_line":
        return _split_blank_line(text), "blank_line"
    if strategy == "line":
        return [ln.strip() for ln in text.split("\n") if ln.strip()], "line"
    # 'file' — the whole file is a single document (unless it is blank).
    return ([text] if text.strip() else []), "file"


def _make_preview(content: str, length: int = _PREVIEW_CHARS) -> str:
    """First ``length`` characters of content with whitespace collapsed."""
    return " ".join(content.split())[:length]


async def _validate_dataset(db: AsyncSession, dataset_id: UUID) -> Dataset:
    """Fetch dataset or raise 404."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalars().first()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


async def _get_document(db: AsyncSession, dataset_id: UUID, doc_id: UUID) -> TextDocument:
    """Fetch a text document scoped to a dataset, or raise 404."""
    stmt = select(TextDocument).where(
        TextDocument.id == doc_id,
        TextDocument.dataset_id == dataset_id,
    )
    result = await db.execute(stmt)
    doc = result.scalars().first()
    if doc is None:
        raise HTTPException(status_code=404, detail="Text document not found")
    return doc


def _doc_filters(
    dataset_id: UUID,
    q: Optional[str],
    status_filter: Optional[str],
) -> list:
    """Build the shared WHERE clauses for document list / prev-next queries."""
    clauses = [TextDocument.dataset_id == dataset_id]
    if q:
        # Escape LIKE wildcards so a literal '%'/'_' in the query matches itself.
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped}%"
        clauses.append(
            or_(
                TextDocument.name.ilike(like, escape="\\"),
                TextDocument.content.ilike(like, escape="\\"),
            )
        )
    if status_filter:
        clauses.append(TextDocument.status == status_filter)
    return clauses


def _annotation_to_out(ann: TextAnnotation) -> TextAnnotationOut:
    return TextAnnotationOut(
        id=ann.id,
        class_id=ann.class_id,
        kind=ann.kind,
        start_offset=ann.start_offset,
        end_offset=ann.end_offset,
        snippet=ann.snippet,
    )


# ── Routes ───────────────────────────────────────────────────────────────


@router.post(
    "/{dataset_id}/upload",
    response_model=TextUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_text_files(
    dataset_id: UUID,
    files: list[UploadFile] = File(...),
    split_strategy: str = Form("auto"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload one or more .txt/.md files and split them into labelable
    documents.

    Each original file is stored raw in MinIO and recorded as a new
    ``DatasetVersion``; the split pieces become ``TextDocument`` rows whose
    ``doc_index`` continues from the dataset's current maximum.
    """
    if split_strategy not in _SPLIT_STRATEGIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown split_strategy '{split_strategy}'. Accepted: {sorted(_SPLIT_STRATEGIES)}",
        )

    dataset = await _validate_dataset(db, dataset_id)
    if dataset.source_type != "text":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Dataset source_type is '{dataset.source_type}' — only text "
                "datasets accept document uploads."
            ),
        )

    # Continue doc_index from the dataset's current maximum.
    max_index = (
        await db.execute(
            select(func.max(TextDocument.doc_index)).where(TextDocument.dataset_id == dataset_id)
        )
    ).scalar()
    next_index = 0 if max_index is None else max_index + 1

    # Version numbers continue from the dataset's latest version.
    base_version = (
        await db.execute(
            select(func.max(DatasetVersion.version_number)).where(
                DatasetVersion.dataset_id == dataset_id
            )
        )
    ).scalar() or 0

    mc = _get_minio_client()
    warnings: list[str] = []
    documents_created = 0
    strategy_used = split_strategy if split_strategy != "auto" else "file"

    # ---- Pass 1: validate + decode + split every file BEFORE any side
    # effects, so a bad file in the batch cannot leave partial state.
    prepared: list[tuple[str, bytes, list[str], str]] = []
    for file_ordinal, file in enumerate(files):
        filename = file.filename or "unknown"
        ext = Path(filename).suffix.lower()
        if ext not in _ALLOWED_TEXT_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Extension '{ext}' is not allowed for '{filename}'. "
                    f"Accepted: {sorted(_ALLOWED_TEXT_EXTENSIONS)}"
                ),
            )

        raw = await file.read()
        if len(raw) > _MAX_TEXT_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File '{filename}' exceeds the 50 MB upload limit",
            )

        text, enc_used = _decode_flexible(raw)
        if enc_used != "utf-8":
            warnings.append(f"'{filename}' decoded as {enc_used} (not UTF-8).")
        text = _normalize_newlines(text)

        pieces, resolved = _split_text(text, split_strategy)
        if file_ordinal == 0:
            strategy_used = resolved
        if not pieces:
            warnings.append(f"'{filename}' produced no documents (file is empty).")
        prepared.append((filename, raw, pieces, resolved))

    # ---- Pass 2: store originals + create rows. If the DB work fails, the
    # transaction rolls back — remove the already-uploaded MinIO objects so
    # storage doesn't accumulate orphans.
    uploaded_keys: list[str] = []
    try:
        for file_ordinal, (filename, raw, pieces, resolved) in enumerate(prepared):
            object_key = f"datasets/{dataset_id}/text/{_uuid.uuid4()}_{filename}"
            _upload_bytes_to_minio(mc, raw, object_key, content_type="text/plain")
            uploaded_keys.append(object_key)

            version = DatasetVersion(
                dataset_id=dataset_id,
                version_number=base_version + file_ordinal + 1,
                storage_path=object_key,
                file_name=filename,
                file_size=len(raw),
                file_type="text/plain",
                row_count=len(pieces),
            )
            db.add(version)
            await db.flush()

            for piece_ordinal, piece in enumerate(pieces):
                name = filename if len(pieces) == 1 else f"{filename} · {piece_ordinal + 1}"
                db.add(
                    TextDocument(
                        dataset_id=dataset_id,
                        version_id=version.id,
                        doc_index=next_index,
                        name=name[:512],
                        content=piece,
                        char_count=len(piece),
                        status="unlabeled",
                    )
                )
                next_index += 1
            documents_created += len(pieces)

            logger.info(
                "Uploaded text file '%s' to dataset %s: %d document(s) (strategy=%s)",
                filename, dataset_id, len(pieces), resolved,
            )

        await db.flush()
        total_documents = (
            await db.execute(
                select(func.count(TextDocument.id)).where(TextDocument.dataset_id == dataset_id)
            )
        ).scalar() or 0
        await db.commit()
    except Exception:
        for key in uploaded_keys:
            try:
                mc.remove_object(settings.MINIO_BUCKET_NAME, key)
            except Exception as cleanup_exc:  # noqa: BLE001
                logger.warning("Failed to clean up MinIO object '%s': %s", key, cleanup_exc)
        raise

    return TextUploadResponse(
        documents_created=documents_created,
        total_documents=total_documents,
        strategy_used=strategy_used,
        warnings=warnings,
    )


@router.get("/{dataset_id}/summary", response_model=TextSummary)
async def get_text_summary(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Labeling progress summary: document counts, span total, and per-class
    annotation counts."""
    await _validate_dataset(db, dataset_id)

    total_documents = (
        await db.execute(
            select(func.count(TextDocument.id)).where(TextDocument.dataset_id == dataset_id)
        )
    ).scalar() or 0

    labeled = (
        await db.execute(
            select(func.count(TextDocument.id)).where(
                TextDocument.dataset_id == dataset_id,
                TextDocument.status == "labeled",
            )
        )
    ).scalar() or 0

    total_spans = (
        await db.execute(
            select(func.count(TextAnnotation.id)).where(
                TextAnnotation.dataset_id == dataset_id,
                TextAnnotation.kind == "span",
            )
        )
    ).scalar() or 0

    class_stmt = (
        select(
            TextAnnotation.class_id,
            AnnotationClass.name,
            AnnotationClass.color,
            func.count(TextAnnotation.id).label("count"),
        )
        .join(AnnotationClass, TextAnnotation.class_id == AnnotationClass.id)
        .where(TextAnnotation.dataset_id == dataset_id)
        .group_by(TextAnnotation.class_id, AnnotationClass.name, AnnotationClass.color)
        .order_by(func.count(TextAnnotation.id).desc(), AnnotationClass.name)
    )
    class_rows = (await db.execute(class_stmt)).all()

    return TextSummary(
        total_documents=total_documents,
        labeled=labeled,
        unlabeled=total_documents - labeled,
        total_spans=total_spans,
        class_counts=[
            ClassCount(class_id=row.class_id, name=row.name, color=row.color, count=row.count)
            for row in class_rows
        ],
    )


@router.get("/{dataset_id}/documents", response_model=TextDocListResponse)
async def list_text_documents(
    dataset_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    q: Optional[str] = Query(None),
    status_filter: Optional[Literal["unlabeled", "labeled"]] = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Paginated document list with previews, doc-level labels, and span
    counts. Annotation lookups are batched over the page (no N+1)."""
    await _validate_dataset(db, dataset_id)

    clauses = _doc_filters(dataset_id, q, status_filter)

    total = (
        await db.execute(select(func.count(TextDocument.id)).where(*clauses))
    ).scalar() or 0

    stmt = (
        select(TextDocument)
        .where(*clauses)
        .order_by(TextDocument.doc_index.asc())
        .offset(skip)
        .limit(limit)
    )
    docs = (await db.execute(stmt)).scalars().all()

    # One batched annotation query over the page's document ids.
    doc_labels_map: dict[UUID, list[DocLabel]] = {}
    span_count_map: dict[UUID, int] = {}
    if docs:
        doc_ids = [d.id for d in docs]
        ann_stmt = (
            select(
                TextAnnotation.document_id,
                TextAnnotation.kind,
                TextAnnotation.class_id,
                AnnotationClass.name,
                AnnotationClass.color,
            )
            .join(AnnotationClass, TextAnnotation.class_id == AnnotationClass.id)
            .where(TextAnnotation.document_id.in_(doc_ids))
        )
        for row in (await db.execute(ann_stmt)).all():
            if row.kind == "doc":
                doc_labels_map.setdefault(row.document_id, []).append(
                    DocLabel(class_id=row.class_id, name=row.name, color=row.color)
                )
            elif row.kind == "span":
                span_count_map[row.document_id] = span_count_map.get(row.document_id, 0) + 1

    items = [
        TextDocListItem(
            id=d.id,
            doc_index=d.doc_index,
            name=d.name,
            char_count=d.char_count,
            status=d.status,
            preview=_make_preview(d.content),
            doc_labels=doc_labels_map.get(d.id, []),
            span_count=span_count_map.get(d.id, 0),
        )
        for d in docs
    ]
    return TextDocListResponse(items=items, total=total)


@router.get("/{dataset_id}/documents/{doc_id}", response_model=TextDocDetailResponse)
async def get_text_document(
    dataset_id: UUID,
    doc_id: UUID,
    q: Optional[str] = Query(None),
    status_filter: Optional[Literal["unlabeled", "labeled"]] = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Full document content plus its annotations, with prev/next document
    ids computed over the same optional q/status filters."""
    doc = await _get_document(db, dataset_id, doc_id)

    ann_stmt = (
        select(TextAnnotation)
        .where(TextAnnotation.document_id == doc.id)
        .order_by(TextAnnotation.created_at.asc())
    )
    annotations = (await db.execute(ann_stmt)).scalars().all()

    clauses = _doc_filters(dataset_id, q, status_filter)
    prev_doc_id = (
        await db.execute(
            select(TextDocument.id)
            .where(*clauses, TextDocument.doc_index < doc.doc_index)
            .order_by(TextDocument.doc_index.desc())
            .limit(1)
        )
    ).scalar()
    next_doc_id = (
        await db.execute(
            select(TextDocument.id)
            .where(*clauses, TextDocument.doc_index > doc.doc_index)
            .order_by(TextDocument.doc_index.asc())
            .limit(1)
        )
    ).scalar()

    return TextDocDetailResponse(
        id=doc.id,
        doc_index=doc.doc_index,
        name=doc.name,
        content=doc.content,
        status=doc.status,
        annotations=[_annotation_to_out(a) for a in annotations],
        prev_doc_id=prev_doc_id,
        next_doc_id=next_doc_id,
    )


@router.put("/{dataset_id}/documents/{doc_id}/annotations", response_model=SaveAnnotationsResponse)
async def save_text_annotations(
    dataset_id: UUID,
    doc_id: UUID,
    payload: SaveAnnotationsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Replace all annotations for a document.

    Validates class ownership and span offsets, computes span snippets
    server-side, and flips the document's status to 'labeled' / 'unlabeled'.
    """
    doc = await _get_document(db, dataset_id, doc_id)
    content_len = len(doc.content)

    valid_class_ids = set(
        (
            await db.execute(
                select(AnnotationClass.id).where(AnnotationClass.dataset_id == dataset_id)
            )
        ).scalars().all()
    )

    new_rows: list[TextAnnotation] = []
    for ann in payload.annotations:
        if ann.class_id not in valid_class_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"class_id '{ann.class_id}' does not belong to this dataset",
            )
        if ann.kind == "span":
            if (
                ann.start_offset is None
                or ann.end_offset is None
                or not (0 <= ann.start_offset < ann.end_offset <= content_len)
            ):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        f"Invalid span offsets (start={ann.start_offset}, "
                        f"end={ann.end_offset}) for document of length {content_len}. "
                        "Required: 0 <= start < end <= length."
                    ),
                )
            snippet = doc.content[ann.start_offset:ann.end_offset][:_SNIPPET_CHARS]
            new_rows.append(
                TextAnnotation(
                    dataset_id=dataset_id,
                    document_id=doc.id,
                    class_id=ann.class_id,
                    kind="span",
                    start_offset=ann.start_offset,
                    end_offset=ann.end_offset,
                    snippet=snippet,
                )
            )
        else:  # kind == "doc"
            if ann.start_offset is not None or ann.end_offset is not None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Doc-level annotations must not carry start/end offsets",
                )
            new_rows.append(
                TextAnnotation(
                    dataset_id=dataset_id,
                    document_id=doc.id,
                    class_id=ann.class_id,
                    kind="doc",
                    start_offset=None,
                    end_offset=None,
                    snippet=None,
                )
            )

    # Replace-all: delete existing rows, insert the new set.
    await db.execute(sa_delete(TextAnnotation).where(TextAnnotation.document_id == doc.id))
    for row in new_rows:
        db.add(row)
    doc.status = "labeled" if new_rows else "unlabeled"
    await db.flush()
    for row in new_rows:
        await db.refresh(row)
    await db.commit()

    return SaveAnnotationsResponse(
        annotations=[_annotation_to_out(r) for r in new_rows],
        status=doc.status,
    )


@router.delete("/{dataset_id}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_text_document(
    dataset_id: UUID,
    doc_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a text document (its annotations cascade)."""
    doc = await _get_document(db, dataset_id, doc_id)
    await db.execute(sa_delete(TextDocument).where(TextDocument.id == doc.id))
    await db.commit()


@router.post("/{dataset_id}/export")
async def export_text_labels(
    dataset_id: UUID,
    payload: TextExportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Synchronous export of all documents + labels as a file download.

    Formats: 'jsonl' (doc labels + spans per line), 'csv' (name,text,labels
    with pipe-joined labels), 'spans-jsonl' (spaCy-style entities).
    """
    await _validate_dataset(db, dataset_id)

    docs = (
        await db.execute(
            select(TextDocument)
            .where(TextDocument.dataset_id == dataset_id)
            .order_by(TextDocument.doc_index.asc())
        )
    ).scalars().all()
    if not docs:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Dataset has no text documents to export",
        )

    ann_stmt = (
        select(
            TextAnnotation.document_id,
            TextAnnotation.kind,
            TextAnnotation.start_offset,
            TextAnnotation.end_offset,
            AnnotationClass.name,
        )
        .join(AnnotationClass, TextAnnotation.class_id == AnnotationClass.id)
        .where(TextAnnotation.dataset_id == dataset_id)
        .order_by(TextAnnotation.created_at.asc())
    )
    doc_labels_map: dict[UUID, list[str]] = {}
    spans_map: dict[UUID, list[tuple[int, int, str]]] = {}
    for row in (await db.execute(ann_stmt)).all():
        if row.kind == "doc":
            doc_labels_map.setdefault(row.document_id, []).append(row.name)
        elif row.kind == "span":
            spans_map.setdefault(row.document_id, []).append(
                (row.start_offset, row.end_offset, row.name)
            )

    fmt = payload.format
    if fmt == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["name", "text", "labels", "spans"])
        for d in docs:
            span_json = json.dumps(
                [{"start": s, "end": e, "label": label} for s, e, label in spans_map.get(d.id, [])],
                ensure_ascii=False,
            )
            writer.writerow([d.name, d.content, "|".join(doc_labels_map.get(d.id, [])), span_json])
        data = buf.getvalue().encode("utf-8")
        media_type = "text/csv"
        filename = "text_labels_csv.csv"
    elif fmt == "spans-jsonl":
        lines = [
            json.dumps(
                {
                    "text": d.content,
                    "entities": [[s, e, label] for s, e, label in spans_map.get(d.id, [])],
                },
                ensure_ascii=False,
            )
            for d in docs
        ]
        data = ("\n".join(lines) + "\n").encode("utf-8")
        media_type = "application/x-ndjson"
        filename = "text_labels_spans-jsonl.jsonl"
    else:  # jsonl
        lines = [
            json.dumps(
                {
                    "name": d.name,
                    "text": d.content,
                    "labels": doc_labels_map.get(d.id, []),
                    "spans": [
                        {"start": s, "end": e, "label": label}
                        for s, e, label in spans_map.get(d.id, [])
                    ],
                },
                ensure_ascii=False,
            )
            for d in docs
        ]
        data = ("\n".join(lines) + "\n").encode("utf-8")
        media_type = "application/x-ndjson"
        filename = "text_labels_jsonl.jsonl"

    logger.info("Exported %d text documents from dataset %s as %s", len(docs), dataset_id, fmt)
    return StreamingResponse(
        io.BytesIO(data),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
