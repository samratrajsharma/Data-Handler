"""
Data Structuring Agent API — trigger and monitor data structuring pipelines.
"""

import asyncio
import re
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models.background_task import BackgroundTask
from core.models.dataset import Dataset, DatasetVersion
from core.services.auth_service import User, get_current_user
from core.services.task_service import create_task_record
from core.services.dataset_access_service import assert_dataset_access
from core.settings import settings as _settings
from core.storage import get_minio_client

router = APIRouter(prefix="/api/v1/structuring", tags=["structuring"])


# ── Schemas ──────────────────────────────────────────────────────────────


class StructuringRequest(BaseModel):
    dataset_id: UUID
    version_number: Optional[int] = None  # defaults to latest
    null_strategy: Literal["fill_mode", "fill_mean", "fill_median", "fill_empty", "drop_rows"] = "fill_mode"
    remove_duplicates: bool = True
    handle_outliers: bool = False
    drop_cols: Optional[list[str]] = None
    case_normalize: Literal["none", "lower", "upper", "title"] = "none"
    standardize_columns: bool = False
    encode_columns: Optional[list[dict]] = None


class StructuringResponse(BaseModel):
    task_id: UUID
    celery_task_id: str
    message: str


# ── Routes ───────────────────────────────────────────────────────────────


@router.post("/run", response_model=StructuringResponse, status_code=status.HTTP_202_ACCEPTED)
async def run_structuring(
    payload: StructuringRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger the Data Structuring Agent on a dataset.

    Runs schema detection, data cleaning, and quality scoring as a
    background task. Returns immediately with a task ID to track progress.
    """
    # Verify dataset exists AND the caller is allowed to touch it.
    dataset = await assert_dataset_access(db, payload.dataset_id, current_user)

    # Get the version to process
    if payload.version_number:
        version_stmt = select(DatasetVersion).where(
            DatasetVersion.dataset_id == payload.dataset_id,
            DatasetVersion.version_number == payload.version_number,
        )
    else:
        # Get latest version
        version_stmt = (
            select(DatasetVersion)
            .where(DatasetVersion.dataset_id == payload.dataset_id)
            .order_by(DatasetVersion.version_number.desc())
            .limit(1)
        )

    version_result = await db.execute(version_stmt)
    version = version_result.scalars().first()
    if version is None:
        msg = (
            f"Version {payload.version_number} not found for this dataset."
            if payload.version_number
            else "No file versions found for this dataset. Upload a file first."
        )
        raise HTTPException(status_code=400, detail=msg)

    # Pre-generate a Celery task ID so the DB record and Celery job share it
    import uuid as _uuid
    celery_task_id = str(_uuid.uuid4())

    # Create tracking record FIRST with the known ID
    task_record = await create_task_record(
        db=db,
        celery_task_id=celery_task_id,
        task_type="structuring",
        dataset_id=payload.dataset_id,
        parameters={
            "version_number": version.version_number,
            "null_strategy": payload.null_strategy,
            "remove_duplicates": payload.remove_duplicates,
            "handle_outliers": payload.handle_outliers,
        },
    )


    # Commit so the row is visible to the Celery worker before dispatch
    await db.commit()

    # NOW submit the Celery task with the same pre-generated ID
    from data_intelligence.tasks.structuring_tasks import run_structuring_pipeline
    run_structuring_pipeline.apply_async(
        kwargs={
            "dataset_id": str(payload.dataset_id),
            "version_number": version.version_number,
            "null_strategy": payload.null_strategy,
            "remove_dupes": payload.remove_duplicates,
            "handle_outliers": payload.handle_outliers,
            "drop_cols": payload.drop_cols,
            "case_normalize": payload.case_normalize,
            "standardize_columns": payload.standardize_columns,
            "encode_columns": payload.encode_columns,
        },
        task_id=celery_task_id,
    )

    return StructuringResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"Structuring pipeline started for dataset {dataset.name} v{version.version_number}",
    )


@router.get("/results/{dataset_id}")
async def get_structuring_results(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest structuring results for a dataset."""
    await assert_dataset_access(db, dataset_id, current_user)
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "structuring",
            BackgroundTask.status == "completed",
        )
        .order_by(BackgroundTask.completed_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    task = result.scalars().first()

    if task is None:
        raise HTTPException(
            status_code=404,
            detail="No completed structuring results found for this dataset",
        )

    return {
        "task_id": str(task.id),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "result": task.result,
    }


@router.get("/recommendations/{dataset_id}")
async def get_structuring_recommendations(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Compute backend-side recommendations for the Structuring tab.

    Looks at the latest version of the dataset and returns hints such as:
    columns worth dropping (all-null, single-value, ID-like), columns suited
    for one-hot vs label encoding (based on cardinality), whether column
    names need standardising, and whether text case normalisation makes
    sense for the data. The UI surfaces these as one-click chips so the
    user doesn't have to guess.
    """
    dataset = await assert_dataset_access(db, dataset_id, current_user)
    if dataset.source_type == "image":
        raise HTTPException(status_code=400, detail="Recommendations not available for image datasets")

    v_stmt = (
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset_id)
        .order_by(DatasetVersion.version_number.desc())
        .limit(1)
    )
    version = (await db.execute(v_stmt)).scalars().first()
    if version is None:
        raise HTTPException(status_code=400, detail="Dataset has no uploaded versions yet")

    try:
        from data_intelligence.tasks.structuring_tasks import _load_dataset_file  # type: ignore
        df = await asyncio.to_thread(
            _load_dataset_file, str(dataset_id), version.version_number,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not load dataset file: {exc}")

    import pandas as _pd  # type: ignore

    total = int(len(df))
    drop_suggestions: list[dict] = []
    encode_suggestions: list[dict] = []
    needs_standardize_columns = False
    text_case_hint: Optional[dict] = None
    null_strategy_hint: Optional[str] = None
    has_text_columns = False
    bad_name_re = re.compile(r"[^a-zA-Z0-9_]")

    for col in df.columns:
        series = df[col]
        non_null = int(series.notna().sum())
        null_pct = 0.0 if total == 0 else (1.0 - non_null / total)
        is_numeric = bool(_pd.api.types.is_numeric_dtype(series)) and not bool(_pd.api.types.is_bool_dtype(series))
        try:
            uniq = series.dropna().nunique()
        except Exception:  # noqa: BLE001
            uniq = 0

        # --- column-name sanity ---
        col_str = str(col)
        if col_str.strip() != col_str or bad_name_re.search(col_str) or any(ch.isupper() for ch in col_str):
            needs_standardize_columns = True

        # --- drop suggestions ---
        if null_pct >= 0.7 and total > 0:
            drop_suggestions.append({
                "column": col_str,
                "reason": f"{round(null_pct * 100)}% of values are missing",
            })
            continue
        if uniq <= 1 and total > 1:
            drop_suggestions.append({
                "column": col_str,
                "reason": "Only one distinct value — adds no signal",
            })
            continue
        if uniq == total and total >= 10 and not is_numeric:
            # Looks like an ID column (every row unique, text)
            drop_suggestions.append({
                "column": col_str,
                "reason": "Looks like an identifier (every value is unique)",
            })
            continue

        # --- encoding suggestions (non-numeric, low/medium cardinality) ---
        if not is_numeric and uniq >= 2 and total > 0:
            has_text_columns = True
            if uniq <= 10:
                encode_suggestions.append({
                    "column": col_str,
                    "mode": "onehot",
                    "reason": f"{uniq} categories — one-hot keeps signal without dimension blowup",
                    "cardinality": int(uniq),
                })
            elif uniq <= 50:
                encode_suggestions.append({
                    "column": col_str,
                    "mode": "label",
                    "reason": f"{uniq} categories — label encoding keeps the column count low",
                    "cardinality": int(uniq),
                })
            # >50 categories: don't recommend automatic encoding

    # --- case normalisation hint: only if we have text columns where the
    # casing is inconsistent (mixed-case values for the same lowercase form).
    if has_text_columns:
        for col in df.columns:
            try:
                s = df[col]
                if _pd.api.types.is_numeric_dtype(s) or _pd.api.types.is_bool_dtype(s):
                    continue
                sample = s.dropna().astype(str).head(500)
                if len(sample) == 0:
                    continue
                if sample.str.lower().nunique() < sample.nunique():
                    text_case_hint = {
                        "mode": "lower",
                        "reason": f"Column '{col}' has inconsistent casing — normalising helps grouping",
                    }
                    break
            except Exception:  # noqa: BLE001
                continue

    # --- null strategy hint ---
    overall_null_pct = 0.0
    if total > 0 and len(df.columns) > 0:
        overall_null_pct = float(df.isna().mean().mean())
    if overall_null_pct == 0:
        null_strategy_hint = None
    elif overall_null_pct < 0.05:
        null_strategy_hint = "fill_mode"
    elif overall_null_pct < 0.20:
        null_strategy_hint = "fill_median"
    else:
        null_strategy_hint = "drop_rows"

    # ── Per-column recommendations ──────────────────────────────────────
    # Every column gets its own card on the UI describing what the system
    # thinks should happen to it. Even "looks clean" columns get an entry so
    # the user sees the full audit.
    per_column: list[dict] = []
    dropped_cols = {d["column"] for d in drop_suggestions}
    encoded_cols = {e["column"]: e for e in encode_suggestions}
    for col in df.columns:
        col_str = str(col)
        series = df[col]
        non_null = int(series.notna().sum())
        null_count = int(series.isna().sum())
        null_pct = 0.0 if total == 0 else null_count / total
        is_numeric = bool(_pd.api.types.is_numeric_dtype(series)) and not bool(_pd.api.types.is_bool_dtype(series))
        is_bool = bool(_pd.api.types.is_bool_dtype(series))
        try:
            uniq = int(series.dropna().nunique())
        except Exception:  # noqa: BLE001
            uniq = 0

        dtype_label = (
            "numeric" if is_numeric
            else "boolean" if is_bool
            else "text"
        )

        actions: list[dict] = []

        # --- Drop ---
        if col_str in dropped_cols:
            reason = next((d["reason"] for d in drop_suggestions if d["column"] == col_str), "Drop")
            actions.append({"kind": "drop", "label": "Drop column", "reason": reason, "priority": 1})

        # --- Null handling per column ---
        if null_count > 0 and col_str not in dropped_cols:
            if is_numeric:
                actions.append({
                    "kind": "fill_nulls", "mode": "median",
                    "label": f"Fill {null_count} null{'s' if null_count != 1 else ''} with median",
                    "reason": f"{round(null_pct * 100, 1)}% missing — median is robust to outliers",
                    "priority": 3,
                })
            else:
                actions.append({
                    "kind": "fill_nulls", "mode": "mode",
                    "label": f"Fill {null_count} null{'s' if null_count != 1 else ''} with mode",
                    "reason": f"{round(null_pct * 100, 1)}% missing — most common value is the safe default",
                    "priority": 3,
                })

        # --- Encoding (already computed above) ---
        if col_str in encoded_cols:
            spec = encoded_cols[col_str]
            actions.append({
                "kind": "encode",
                "mode": spec["mode"],
                "label": f"Encode as {spec['mode']} ({spec['cardinality']} categories)",
                "reason": spec["reason"],
                "priority": 2,
            })

        # --- Outliers (numeric, non-dropped, enough samples) ---
        if is_numeric and col_str not in dropped_cols and non_null >= 20:
            try:
                q1 = float(series.quantile(0.25))
                q3 = float(series.quantile(0.75))
                iqr = q3 - q1
                lo, hi = q1 - 3 * iqr, q3 + 3 * iqr
                outliers = int(((series < lo) | (series > hi)).sum())
                if outliers > 0 and iqr > 0:
                    pct = outliers / non_null
                    if pct >= 0.005:  # ≥0.5% outliers worth flagging
                        actions.append({
                            "kind": "handle_outliers",
                            "label": f"Review {outliers} potential outlier{'s' if outliers != 1 else ''}",
                            "reason": f"Outside [{lo:.2g}, {hi:.2g}] (Q1±3·IQR)",
                            "priority": 4,
                        })
            except Exception:  # noqa: BLE001
                pass

        # --- Whitespace trim (text columns with leading/trailing space) ---
        if not is_numeric and not is_bool and col_str not in dropped_cols:
            try:
                sample = series.dropna().astype(str).head(500)
                strippable = int((sample != sample.str.strip()).sum())
                if strippable > 0:
                    actions.append({
                        "kind": "trim_whitespace",
                        "label": "Trim whitespace",
                        "reason": f"~{strippable} of {len(sample)} sampled values have leading/trailing spaces",
                        "priority": 5,
                    })
            except Exception:  # noqa: BLE001
                pass

        # --- Date parsing (text that looks like dates) ---
        if not is_numeric and not is_bool and col_str not in dropped_cols and non_null > 0:
            try:
                sample = series.dropna().astype(str).head(50)
                parsed = _pd.to_datetime(sample, errors="coerce")
                date_hit_rate = parsed.notna().mean() if len(sample) > 0 else 0.0
                if date_hit_rate >= 0.8:
                    actions.append({
                        "kind": "parse_date",
                        "label": "Parse as datetime",
                        "reason": f"{round(date_hit_rate * 100)}% of sampled values look like dates",
                        "priority": 6,
                    })
            except Exception:  # noqa: BLE001
                pass

        # --- Numeric coercion (text columns that look numeric) ---
        if not is_numeric and not is_bool and col_str not in dropped_cols and non_null > 0:
            try:
                sample = series.dropna().astype(str).head(50)
                num_parsed = _pd.to_numeric(sample, errors="coerce")
                num_hit_rate = num_parsed.notna().mean() if len(sample) > 0 else 0.0
                if num_hit_rate >= 0.9 and uniq >= 5:
                    actions.append({
                        "kind": "coerce_numeric",
                        "label": "Convert to numeric",
                        "reason": f"{round(num_hit_rate * 100)}% of values are numeric-looking — store as numbers",
                        "priority": 2,
                    })
            except Exception:  # noqa: BLE001
                pass

        # If nothing else surfaced, give the user an explicit "looks clean".
        if not actions:
            actions.append({
                "kind": "noop",
                "label": "Looks clean",
                "reason": (
                    f"{dtype_label} column, {uniq} distinct value{'s' if uniq != 1 else ''}, "
                    f"no nulls" if null_count == 0 else f"{null_count} null{'s' if null_count != 1 else ''}"
                ),
                "priority": 9,
            })
        actions.sort(key=lambda a: a.get("priority", 99))

        per_column.append({
            "column": col_str,
            "dtype": dtype_label,
            "distinct": uniq,
            "null_count": null_count,
            "null_pct": round(null_pct, 4),
            "actions": actions,
        })

    return {
        "total_rows": total,
        "total_columns": int(len(df.columns)),
        "drop_columns": drop_suggestions,
        "encode_columns": encode_suggestions,
        "standardize_columns": needs_standardize_columns,
        "case_normalize": text_case_hint,
        "null_strategy": null_strategy_hint,
        "per_column": per_column,
    }


@router.get("/cleaned-preview/{dataset_id}")
async def cleaned_preview(
    dataset_id: UUID,
    limit: int = Query(5, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the first ``limit`` rows of the latest cleaned file.

    Powers the "Before / After" panel under the structuring results.
    """
    await assert_dataset_access(db, dataset_id, current_user)
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "structuring",
            BackgroundTask.status == "completed",
        )
        .order_by(BackgroundTask.completed_at.desc())
        .limit(1)
    )
    task = (await db.execute(stmt)).scalars().first()
    if task is None or not task.result:
        raise HTTPException(status_code=404, detail="No completed structuring result")
    path = (task.result or {}).get("cleaned_file_path")
    if not path:
        raise HTTPException(status_code=404, detail="Cleaned file path missing")

    mc = get_minio_client()
    try:
        resp = mc.get_object(_settings.MINIO_BUCKET_NAME, path, offset=0, length=262144)
        raw = resp.read(262144)
        resp.close()
        resp.release_conn()
    except TypeError:
        # Older minio client without offset/length kwargs.
        resp = mc.get_object(_settings.MINIO_BUCKET_NAME, path)
        raw = resp.read(262144)
        resp.close()
        resp.release_conn()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to read cleaned file: {exc}")

    import csv as _csv
    import io as _io
    text = raw.decode("utf-8", errors="replace")
    reader = _csv.reader(_io.StringIO(text))
    header = next(reader, [])
    rows: list[list[str]] = []
    for i, row in enumerate(reader):
        if i >= limit:
            break
        rows.append([str(v) for v in row])
    return {"columns": [c.strip() for c in header], "rows": rows}


@router.get("/download/{dataset_id}")
async def download_structuring_result(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream the cleaned dataset file from the latest successful structuring run."""
    await assert_dataset_access(db, dataset_id, current_user)
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "structuring",
            BackgroundTask.status == "completed",
        )
        .order_by(BackgroundTask.completed_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    task = result.scalars().first()
    if task is None or not task.result:
        raise HTTPException(
            status_code=404,
            detail="No completed structuring result found for this dataset",
        )
    path = (task.result or {}).get("cleaned_file_path")
    if not path:
        raise HTTPException(
            status_code=404,
            detail="Cleaned file path missing from result",
        )

    mc = get_minio_client()
    try:
        response = mc.get_object(_settings.MINIO_BUCKET_NAME, path)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve cleaned file: {exc}",
        )

    filename = path.rsplit("/", 1)[-1]
    return StreamingResponse(
        response,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
