"""
Celery tasks for the Data Structuring Agent.
Runs schema detection, cleaning, and quality scoring as a background job.
"""

import io
import json
import logging
import math
import re

import core.paths  # noqa: F401

import pandas as pd
import numpy as np
from celery import current_task

from core.celery_app import app
from core.database_sync import SyncSessionLocal
from core.services.task_service import update_task_progress, complete_task

logger = logging.getLogger(__name__)


def _json_safe(obj):
    """Recursively convert a value into something PostgreSQL JSONB accepts.

    Pandas/NumPy produce types (np.int64, np.float64, np.ndarray) and special
    floats (NaN, inf) that ``json.dumps`` either cannot serialise or emits as
    invalid JSON — PostgreSQL then rejects the insert and the task fails.
    """
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [_json_safe(v) for v in obj.tolist()]
    if isinstance(obj, np.generic):
        obj = obj.item()
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
    return obj


def _detect_encoding(raw_bytes: bytes) -> str:
    """Best-effort encoding detection — matches the ingestion-side helper."""
    if raw_bytes.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    if raw_bytes[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return "utf-16"
    try:
        raw_bytes.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        pass
    try:
        from charset_normalizer import from_bytes as _cn_from_bytes  # type: ignore
        result = _cn_from_bytes(raw_bytes[:65536]).best()
        if result is not None and result.encoding:
            return result.encoding
    except ImportError:
        pass
    return "cp1252"


def _find_data_start_line(raw_bytes: bytes, delim: str, encoding: str) -> int:
    """Find the line index where the real tabular data starts.

    Some real-world CSVs (UCI ML repository style, BI exports, kaggle
    datasets bundled with a README) have several lines of free-text
    metadata before the actual header row. pandas chokes on these with
    "Expected N fields in line K, saw M". We detect this shape by finding
    the most common *multi-field* line count — if that shape covers at
    least a handful of lines, we treat its first occurrence as the real
    header and skip everything above it.

    NB: we deliberately ignore the modal count when it's 1, because a long
    descriptive prelude can outnumber the actual data rows; we want the
    most popular tabular shape, not just the popular shape overall.

    Returns 0 (no skip) when the file looks normal.
    """
    try:
        text = raw_bytes[:65536].decode(encoding, errors="replace")
    except Exception:  # noqa: BLE001
        return 0
    lines = text.splitlines()[:200]
    if len(lines) < 3:
        return 0
    counts = [(i, line.count(delim) + 1) for i, line in enumerate(lines) if line.strip()]
    if not counts:
        return 0
    from collections import Counter
    # Only consider multi-field shapes — single-field lines are almost
    # always metadata when we have a real CSV.
    multi_field = [c for _, c in counts if c >= 2]
    if not multi_field:
        return 0
    target_count, target_freq = Counter(multi_field).most_common(1)[0]
    # The target shape needs at least 3 occurrences to be trusted as the
    # real table, otherwise we might be looking at a one-off bad line.
    if target_freq < 3:
        return 0
    # If the very first non-empty line already matches the target, no skip.
    if counts[0][1] == target_count:
        return 0
    # Find the first line whose field count matches the target shape.
    for idx, cnt in counts:
        if cnt == target_count:
            return idx
    return 0


def _sniff_csv_delimiter(raw_bytes: bytes, ext: str) -> str:
    """Detect the most likely CSV delimiter for the given file bytes.

    Mirrors the ingestion-side sniffer (kept in two places because Celery
    workers don't import the FastAPI ingestion module). Tries
    :class:`csv.Sniffer` first, then falls back to "whichever delimiter
    splits the header into the most fields", preferring comma if no
    candidate clearly wins.
    """
    import csv as _csv
    default = "\t" if ext == ".tsv" else ","
    try:
        enc = _detect_encoding(raw_bytes[:16384])
        text = raw_bytes[:16384].decode(enc, errors="replace")
    except Exception:  # noqa: BLE001
        return default
    if not text:
        return default
    # Trim to a complete line boundary so partial-line snippets don't fool
    # the sniffer.
    last_nl = text.rfind("\n")
    sample = text[:last_nl] if last_nl > 200 else text
    candidates = (",", ";", "\t", "|")
    try:
        dialect = _csv.Sniffer().sniff(sample, delimiters="".join(candidates))
        if dialect.delimiter in candidates:
            return dialect.delimiter
    except Exception:  # noqa: BLE001
        pass
    first_line = sample.split("\n", 1)[0]
    best_delim, best_count = default, first_line.count(default) + 1
    for cand in candidates:
        cnt = first_line.count(cand) + 1
        if cnt > best_count and cnt >= 2:
            best_count, best_delim = cnt, cand
    return best_delim


def _load_dataset_file(dataset_id: str, version_number: int) -> pd.DataFrame:
    """Download the dataset file from MinIO and load as DataFrame.

    Auto-detects the field delimiter for CSV-style files so semicolon-
    delimited / pipe-delimited files load as proper multi-column tables
    instead of one giant text column.
    """
    from core.settings import settings
    from core.storage import get_minio_client

    client = get_minio_client()

    # Prefer the DB-recorded storage_path (the canonical original file) so
    # we never accidentally pick up a `cleaned_*.csv` that a previous run
    # wrote into the same prefix. Falls back to listing objects only when
    # the version row can't be read.
    object_name = None
    try:
        from core.database_sync import SyncSessionLocal
        from core.models.dataset import DatasetVersion
        from sqlalchemy import select as _sa_select
        import uuid as _uuid

        with SyncSessionLocal() as _db:
            row = _db.execute(
                _sa_select(DatasetVersion.storage_path)
                .where(
                    DatasetVersion.dataset_id == _uuid.UUID(dataset_id),
                    DatasetVersion.version_number == version_number,
                )
                .limit(1)
            ).first()
            if row and row[0]:
                object_name = row[0]
    except Exception:  # noqa: BLE001
        pass  # fall back to listing

    if not object_name:
        prefix = f"datasets/{dataset_id}/v{version_number}/"
        objects = list(client.list_objects(settings.MINIO_BUCKET_NAME, prefix=prefix))
        # Skip files this pipeline itself produces so we always reload the
        # original source — protects against re-running structuring after a
        # cleaned file has already landed in the same prefix.
        objects = [o for o in objects if not o.object_name.split("/")[-1].startswith("cleaned_")]
        if not objects:
            raise FileNotFoundError(f"No source files found at {prefix}")
        object_name = objects[0].object_name

    response = client.get_object(settings.MINIO_BUCKET_NAME, object_name)
    raw_bytes = response.read()
    response.close()
    response.release_conn()

    # Detect file type, encoding, and delimiter. Excel exports often produce
    # CP-1252 or UTF-16 BOM files; sniff so the loader doesn't choke.
    file_name = object_name.split("/")[-1].lower()
    encoding = _detect_encoding(raw_bytes[:65536])
    if file_name.endswith(".csv") or file_name.endswith(".txt"):
        ext = ".csv" if file_name.endswith(".csv") else ".txt"
        delim = _sniff_csv_delimiter(raw_bytes, ext)
        skip = _find_data_start_line(raw_bytes, delim, encoding)
        return _read_csv_tolerant(raw_bytes, sep=delim, encoding=encoding, skiprows=skip)
    elif file_name.endswith(".tsv"):
        skip = _find_data_start_line(raw_bytes, "\t", encoding)
        return _read_csv_tolerant(raw_bytes, sep="\t", encoding=encoding, skiprows=skip)
    elif file_name.endswith(".json"):
        return pd.read_json(io.BytesIO(raw_bytes))
    elif file_name.endswith(".jsonl"):
        return pd.read_json(io.BytesIO(raw_bytes), lines=True)
    else:
        delim = _sniff_csv_delimiter(raw_bytes, ".csv")
        skip = _find_data_start_line(raw_bytes, delim, encoding)
        return _read_csv_tolerant(raw_bytes, sep=delim, encoding=encoding, skiprows=skip)


def _count_data_lines(raw_bytes: bytes, encoding: str, skiprows: int = 0) -> int | None:
    """Best-effort count of *data* rows in a delimited file.

    Counts non-empty physical lines, then subtracts the prelude rows we skip
    and the single header row. Used only to estimate how many rows a tolerant
    parse dropped, so it never raises (returns ``None`` on failure). It can
    over-count when a file legitimately contains quoted newlines, so callers
    should only trust it on the tolerant path (which already implies the file
    is malformed).
    """
    try:
        text = raw_bytes.decode(encoding, errors="replace")
    except Exception:  # noqa: BLE001
        return None
    non_empty = sum(1 for ln in text.splitlines() if ln.strip())
    # minus the skipped prelude, minus the header row
    return max(0, non_empty - max(0, skiprows) - 1)


_LEADING_ZERO_RE = re.compile(r"^0\d")


def _preserve_leading_zeros(
    df: pd.DataFrame, raw_bytes: bytes, sep: str, encoding: str, skiprows: int = 0
) -> pd.DataFrame:
    """Keep zero-padded identifier columns (zip / SKU / account codes) as text.

    pandas type-inference reads ``"007"`` as the integer ``7``, silently dropping
    the leading zeros. To preserve fidelity we detect — on a small sample — which
    of the *integer* columns actually contain zero-padded values, and re-read only
    those columns as strings. Every genuinely-numeric column is left untouched, so
    downstream numeric operations (EDA, outliers, comparisons) are unaffected. The
    whole thing is best-effort and never breaks an otherwise-successful load.
    """
    try:
        int_cols = [c for c in df.columns if pd.api.types.is_integer_dtype(df[c])]
        if not int_cols:
            return df
        sample = pd.read_csv(
            io.BytesIO(raw_bytes), sep=sep, encoding=encoding, skiprows=skiprows,
            usecols=int_cols, dtype=str, nrows=500, low_memory=False,
        )
        padded = [
            c for c in int_cols
            if c in sample.columns
            and sample[c].dropna().astype(str).str.match(_LEADING_ZERO_RE).any()
        ]
        if not padded:
            return df
        full = pd.read_csv(
            io.BytesIO(raw_bytes), sep=sep, encoding=encoding, skiprows=skiprows,
            usecols=padded, dtype=str, low_memory=False,
        )
        for c in padded:
            if c in full.columns and len(full[c]) == len(df):
                df[c] = full[c].values
    except Exception:  # noqa: BLE001
        return df
    return df


def _read_csv_tolerant(raw_bytes: bytes, sep: str, encoding: str, skiprows: int = 0) -> pd.DataFrame:
    """Read a CSV with graceful degradation.

    First tries the fast C engine with strict parsing. If that fails with
    "Expected N fields in line K, saw M" or similar, retries with the
    Python engine + ``on_bad_lines='skip'`` so partially-malformed files
    still load. The Python engine is slower but handles ragged rows,
    quoted text spanning lines, and other oddities.

    If even the tolerant pass fails, raises a friendlier RuntimeError
    that names the problem and points at the offending line.

    FIX: ``on_bad_lines='skip'`` silently discards malformed rows, so we now
    record how many rows were dropped and the pre-parse data-line count on the
    returned frame's ``.attrs`` (``skipped_rows`` / ``preparse_rows``). The
    pipeline surfaces these so users see "N rows skipped" instead of quietly
    losing data.
    """
    # Pass 1: strict, fast C engine. Nothing is skipped on this path.
    try:
        df = pd.read_csv(
            io.BytesIO(raw_bytes), sep=sep, encoding=encoding,
            skiprows=skiprows, low_memory=False,
        )
        df.attrs["skipped_rows"] = 0
        df.attrs["preparse_rows"] = len(df)
        return _preserve_leading_zeros(df, raw_bytes, sep, encoding, skiprows)
    except Exception as exc:  # noqa: BLE001
        first_error = str(exc)

    # Pass 2: tolerant Python engine — skips ragged rows.
    try:
        df = pd.read_csv(
            io.BytesIO(raw_bytes), sep=sep, encoding=encoding,
            skiprows=skiprows, engine="python", on_bad_lines="skip",
        )
        # Estimate how many rows the tolerant reader dropped so the pipeline
        # can report it. Best-effort only — never let the accounting crash the
        # actual (successful) load.
        try:
            preparse = _count_data_lines(raw_bytes, encoding, skiprows)
            skipped = max(0, preparse - len(df)) if preparse is not None else 0
        except Exception:  # noqa: BLE001
            preparse, skipped = None, 0
        df.attrs["skipped_rows"] = skipped
        df.attrs["preparse_rows"] = preparse if preparse is not None else len(df)
        if skipped:
            logger.warning(
                "Tolerant CSV parse skipped %d malformed row(s) "
                "(%s data lines detected, %d parsed).",
                skipped, preparse, len(df),
            )
        return _preserve_leading_zeros(df, raw_bytes, sep, encoding, skiprows)
    except Exception as exc:  # noqa: BLE001
        # Re-raise with a message that points the user at the actual issue
        # rather than the cryptic C tokenizer error.
        raise RuntimeError(
            f"CSV parse failed even with tolerant mode. "
            f"First error: {first_error}. "
            f"This usually means the file has multiple header rows, mixed delimiters, "
            f"or text values containing unescaped quotes/newlines. "
            f"Open it in Excel / a text editor and re-save as a plain CSV."
        ) from exc


def _save_cleaned_file(
    df: pd.DataFrame,
    dataset_id: str,
    version_number: int,
    original_filename: str,
) -> str:
    """Upload cleaned DataFrame back to MinIO as a new file."""
    from core.settings import settings
    from core.storage import get_minio_client

    client = get_minio_client()

    # Save as CSV
    buffer = io.BytesIO()
    df.to_csv(buffer, index=False)
    buffer.seek(0)
    data_length = buffer.getbuffer().nbytes

    clean_name = f"cleaned_{original_filename}"
    if not clean_name.endswith(".csv"):
        clean_name = clean_name.rsplit(".", 1)[0] + ".csv"

    object_name = f"datasets/{dataset_id}/v{version_number}/{clean_name}"

    client.put_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=object_name,
        data=buffer,
        length=data_length,
        content_type="text/csv",
    )

    logger.info("Saved cleaned file: %s (%d bytes)", object_name, data_length)
    return object_name


@app.task(bind=True, name="structuring.run_pipeline")
def run_structuring_pipeline(
    self,
    dataset_id: str,
    version_number: int,
    null_strategy: str = "fill_mode",
    remove_dupes: bool = True,
    handle_outliers: bool = False,
    drop_cols: list | None = None,
    case_normalize: str = "none",
    standardize_columns: bool = False,
    encode_columns: list | None = None,
):
    """Run the full data structuring pipeline: detect → clean → score.

    Args:
        dataset_id: UUID of the dataset.
        version_number: Which version's file to process.
        null_strategy: How to handle nulls.
        remove_dupes: Whether to deduplicate.
        handle_outliers: Whether to remove outliers.
    """
    celery_task_id = self.request.id
    db = SyncSessionLocal()

    try:
        # ── Step 1: Load data ────────────────────────────────────────────
        update_task_progress(db, celery_task_id, 0.1, "Loading dataset from storage...")

        df = _load_dataset_file(dataset_id, version_number)
        logger.info("Loaded dataset %s v%d: %d rows, %d columns",
                     dataset_id, version_number, len(df), len(df.columns))

        # FIX: the tolerant CSV reader may have silently dropped malformed rows.
        # Capture the count now (before the pipeline mutates the frame) so we
        # can surface it and reconcile the reported original row count.
        skipped_rows = int(df.attrs.get("skipped_rows", 0) or 0)

        # ── Step 2: Schema detection ─────────────────────────────────────
        update_task_progress(db, celery_task_id, 0.3, "Detecting column types...")

        # Import from the hyphenated directory (path set up by core.paths)
        from structuring.schema_detector import detect_schema
        schema = detect_schema(df)

        # ── Step 3: Clean data ───────────────────────────────────────────
        update_task_progress(db, celery_task_id, 0.5, "Cleaning data...")

        from structuring.cleaning_pipeline import run_cleaning_pipeline
        cleaned_df, cleaning_report = run_cleaning_pipeline(
            df,
            null_strategy=null_strategy,
            remove_dupes=remove_dupes,
            handle_outliers=handle_outliers,
            drop_cols=drop_cols,
            case_normalize=case_normalize,
            standardize_columns=standardize_columns,
            encode_columns=encode_columns,
        )

        # ── Step 4: Quality scoring ──────────────────────────────────────
        update_task_progress(db, celery_task_id, 0.7, "Scoring data quality...")

        from structuring.quality_scorer import score_quality
        quality_report = score_quality(cleaned_df)

        # ── Step 5: Save cleaned file ────────────────────────────────────
        update_task_progress(db, celery_task_id, 0.85, "Saving cleaned dataset...")

        # Get original filename
        from core.settings import settings
        from core.storage import get_minio_client
        client = get_minio_client()
        prefix = f"datasets/{dataset_id}/v{version_number}/"
        objects = list(client.list_objects(settings.MINIO_BUCKET_NAME, prefix=prefix))
        original_filename = objects[0].object_name.split("/")[-1] if objects else "data.csv"

        cleaned_path = _save_cleaned_file(cleaned_df, dataset_id, version_number, original_filename)

        # ── Step 6: Update dataset status ────────────────────────────────
        update_task_progress(db, celery_task_id, 0.95, "Updating dataset status...")

        from sqlalchemy import update as sql_update
        from core.models.dataset import Dataset
        db.execute(
            sql_update(Dataset)
            .where(Dataset.id == dataset_id)
            .values(status="processed")
        )
        db.commit()

        # ── Done ─────────────────────────────────────────────────────────
        # Fold any silently-skipped malformed rows into the cleaning report so
        # they are visible to the user, and set original_rows from the pre-parse
        # line count (parsed rows + skipped) so the accounting reconciles:
        #   original_rows == final_rows + rows_removed + skipped_rows
        cleaning_dict = cleaning_report.to_dict()
        cleaning_dict["skipped_rows"] = skipped_rows
        if skipped_rows:
            warnings = cleaning_dict.get("warnings") or []
            warnings.append(
                f"{skipped_rows} malformed row(s) were skipped while parsing the "
                f"source file and are not present in the cleaned output."
            )
            cleaning_dict["warnings"] = warnings

        result = _json_safe({
            "schema": schema.to_dict(),
            "cleaning": cleaning_dict,
            "quality": quality_report.to_dict(),
            "cleaned_file_path": cleaned_path,
            "original_rows": schema.row_count + skipped_rows,
            "skipped_rows": skipped_rows,
            "final_rows": cleaning_report.final_rows,
        })

        complete_task(db, celery_task_id, result=result)
        logger.info(
            "Structuring complete for dataset %s: quality=%.1f (%s)",
            dataset_id, quality_report.overall_score, quality_report.grade,
        )
        return result

    except Exception as exc:
        logger.error("Structuring failed for dataset %s: %s", dataset_id, exc, exc_info=True)
        complete_task(db, celery_task_id, error=str(exc))
        raise
    finally:
        db.close()
