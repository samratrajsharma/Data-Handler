"""
AI-Powered EDA API — trigger and monitor exploratory data analysis pipelines.
"""

import asyncio
import math
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models.background_task import BackgroundTask
from core.models.dataset import Dataset, DatasetVersion
from core.services.auth_service import User, get_current_user
from core.services.task_service import create_task_record
from core.services.dataset_access_service import assert_dataset_access

router = APIRouter(prefix="/api/v1/eda", tags=["eda"])


# ── Schemas ──────────────────────────────────────────────────────────────


class EDARequest(BaseModel):
    dataset_id: UUID
    version_number: Optional[int] = None  # defaults to latest
    run_profiling: bool = True
    run_embeddings: bool = True
    run_clustering: bool = True
    n_clusters: int = 5


class EDAResponse(BaseModel):
    task_id: UUID
    celery_task_id: str
    message: str


# ── Routes ───────────────────────────────────────────────────────────────


@router.post("/run", response_model=EDAResponse, status_code=status.HTTP_202_ACCEPTED)
async def run_eda(
    payload: EDARequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger the AI-Powered EDA pipeline on a dataset.

    Runs data profiling, embedding generation, and clustering as a
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
        task_type="eda",
        dataset_id=payload.dataset_id,
        parameters={
            "version_number": version.version_number,
            "run_profiling": payload.run_profiling,
            "run_embeddings": payload.run_embeddings,
            "run_clustering": payload.run_clustering,
            "n_clusters": payload.n_clusters,
        },
    )


    # Commit so the row is visible to the Celery worker before dispatch
    await db.commit()

    # NOW submit the Celery task with the same pre-generated ID
    from data_intelligence.tasks.eda_tasks import run_eda_pipeline
    run_eda_pipeline.apply_async(
        kwargs={
            "dataset_id": str(payload.dataset_id),
            "version_number": version.version_number,
            "run_profiling": payload.run_profiling,
            "run_embeddings": payload.run_embeddings,
            "run_clustering": payload.run_clustering,
            "n_clusters": payload.n_clusters,
        },
        task_id=celery_task_id,
    )

    return EDAResponse(
        task_id=task_record.id,
        celery_task_id=celery_task_id,
        message=f"EDA pipeline started for dataset {dataset.name} v{version.version_number}",
    )


@router.get("/results/{dataset_id}")
async def get_eda_results(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest EDA results for a dataset."""
    await assert_dataset_access(db, dataset_id, current_user)
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "eda",
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
            detail="No completed EDA results found for this dataset",
        )

    return {
        "task_id": str(task.id),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "result": task.result,
    }


@router.get("/profile/{dataset_id}")
async def get_eda_profile(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get just the profiling section from the latest EDA results."""
    await assert_dataset_access(db, dataset_id, current_user)
    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "eda",
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
            detail="No completed EDA results found for this dataset",
        )

    profiling = task.result.get("profiling") if isinstance(task.result, dict) else None
    if profiling is None:
        raise HTTPException(
            status_code=404,
            detail="No profiling data found in the latest EDA results",
        )

    return {
        "task_id": str(task.id),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "profiling": profiling,
    }


@router.get("/download/{dataset_id}")
async def download_eda_report(
    dataset_id: UUID,
    format: str = Query("json", pattern="^(json|pdf|docx)$",
        description="Output format: json | pdf | docx"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download the latest EDA result in JSON, PDF or DOCX.

    The PDF and DOCX formats render a human-readable summary of profiling
    stats, warnings, and cluster info; the JSON format is the raw result
    payload for programmatic consumption.
    """
    import json as _json

    await assert_dataset_access(db, dataset_id, current_user)

    stmt = (
        select(BackgroundTask)
        .where(
            BackgroundTask.dataset_id == dataset_id,
            BackgroundTask.task_type == "eda",
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
            detail="No completed EDA result found for this dataset",
        )

    short_id = str(dataset_id)[:8]

    if format == "json":
        body = _json.dumps(task.result, indent=2, default=str).encode("utf-8")
        return Response(
            content=body,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="eda_report_{short_id}.json"'},
        )

    # Fetch the dataset name for nicer headings in the document outputs.
    ds_res = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = ds_res.scalars().first()
    dataset_name = dataset.name if dataset else f"Dataset {short_id}"

    if format == "pdf":
        body = _render_eda_pdf(dataset_name, task.result)
        return Response(
            content=body,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="eda_report_{short_id}.pdf"'},
        )
    if format == "docx":
        body = _render_eda_docx(dataset_name, task.result)
        return Response(
            content=body,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="eda_report_{short_id}.docx"'},
        )

    raise HTTPException(status_code=400, detail=f"Unsupported format: {format}")


# ── Report renderers ────────────────────────────────────────────────────


def _render_eda_pdf(dataset_name: str, result: dict) -> bytes:
    """Render the EDA result as a PDF using reportlab.

    Designed to fail soft — if reportlab isn't installed or the result has
    an unexpected shape, an informative 500 is raised so the user can fall
    back to JSON download rather than getting a broken file.
    """
    try:
        from io import BytesIO
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
        )
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="PDF export requires the 'reportlab' package on the server.",
        ) from exc

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=18 * mm, bottomMargin=18 * mm,
        leftMargin=18 * mm, rightMargin=18 * mm,
        title=f"EDA Report — {dataset_name}",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "T", parent=styles["Title"], fontSize=22, textColor=colors.HexColor("#5B5FE3"),
        spaceAfter=4,
    )
    h2 = ParagraphStyle(
        "H2", parent=styles["Heading2"], fontSize=14,
        textColor=colors.HexColor("#181426"), spaceBefore=14, spaceAfter=6,
    )
    body = ParagraphStyle("B", parent=styles["BodyText"], fontSize=10.5, leading=14)

    story: list = []
    story.append(Paragraph("EDA Report", title_style))
    story.append(Paragraph(f"Dataset: <b>{dataset_name}</b>", body))
    story.append(Spacer(1, 6))

    profiling = (result or {}).get("profiling") or {}
    # The profiler emits ``columns`` as a list of per-column stat dicts (each
    # carrying its own ``name``). Older code paths may emit a dict keyed by
    # name — support both shapes so this renderer doesn't blow up on the
    # other.
    columns_raw = profiling.get("columns") or []
    if isinstance(columns_raw, dict):
        columns_iter = [
            {**(v if isinstance(v, dict) else {}), "name": k}
            for k, v in columns_raw.items()
        ]
    else:
        columns_iter = [c for c in columns_raw if isinstance(c, dict)]
    warnings = profiling.get("warnings") or []

    # Overview table
    story.append(Paragraph("Overview", h2))
    overview_rows = [
        ["Rows", str(profiling.get("row_count", "—"))],
        ["Columns", str(profiling.get("column_count", "—"))],
        ["Memory", f"{profiling.get('memory_usage_mb', '—')} MB"],
        ["Warnings", str(len(warnings))],
    ]
    t = Table(overview_rows, colWidths=[60 * mm, 60 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F3F0FF")),
        ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 10),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#D9D8E3")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E6E5EF")),
        ("ROWBACKGROUNDS", (1, 0), (-1, -1), [colors.white, colors.HexColor("#FAFAFE")]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t)

    # Warnings
    if warnings:
        story.append(Paragraph("Warnings", h2))
        for w in warnings:
            story.append(Paragraph(f"• {str(w)}", body))

    # Per-column stats
    if columns_iter:
        story.append(Paragraph("Columns", h2))
        col_rows = [["Column", "Type", "Nulls", "Distinct"]]
        for cstats in columns_iter:
            cname = cstats.get("name", "—")
            col_rows.append([
                str(cname)[:38],
                str(cstats.get("dtype", "—")),
                str(cstats.get("null_count", "—")),
                str(cstats.get("distinct_count", cstats.get("unique_count", "—"))),
            ])
        ct = Table(col_rows, colWidths=[60 * mm, 35 * mm, 30 * mm, 30 * mm])
        ct.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#5B5FE3")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 10),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#D9D8E3")),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E6E5EF")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFE")]),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(ct)

    # Clustering block (if present)
    clustering = (result or {}).get("clustering") or {}
    if isinstance(clustering, dict) and clustering:
        story.append(Paragraph("Clustering", h2))
        story.append(Paragraph(
            f"Cluster count: {clustering.get('n_clusters', '—')}", body,
        ))
        sizes = clustering.get("cluster_sizes") or {}
        if isinstance(sizes, dict) and sizes:
            for cid, count in sorted(sizes.items(), key=lambda kv: -int(kv[1])):
                story.append(Paragraph(f"• Cluster {cid}: {count} rows", body))

    doc.build(story)
    return buf.getvalue()


def _render_eda_docx(dataset_name: str, result: dict) -> bytes:
    """Render the EDA result as a Word document using python-docx."""
    try:
        from io import BytesIO
        from docx import Document
        from docx.shared import Pt, RGBColor, Inches
        from docx.enum.text import WD_ALIGN_PARAGRAPH
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="DOCX export requires the 'python-docx' package on the server.",
        ) from exc

    profiling = (result or {}).get("profiling") or {}
    columns_raw = profiling.get("columns") or []
    if isinstance(columns_raw, dict):
        columns_iter = [
            {**(v if isinstance(v, dict) else {}), "name": k}
            for k, v in columns_raw.items()
        ]
    else:
        columns_iter = [c for c in columns_raw if isinstance(c, dict)]
    warnings = profiling.get("warnings") or []

    doc = Document()

    # Title
    title = doc.add_heading("EDA Report", level=0)
    for run in title.runs:
        run.font.color.rgb = RGBColor(0x5B, 0x5F, 0xE3)

    p = doc.add_paragraph()
    p.add_run("Dataset: ").bold = True
    p.add_run(dataset_name)

    # Overview
    doc.add_heading("Overview", level=2)
    table = doc.add_table(rows=4, cols=2)
    table.style = "Light Grid Accent 1"
    rows_data = [
        ("Rows", str(profiling.get("row_count", "—"))),
        ("Columns", str(profiling.get("column_count", "—"))),
        ("Memory", f"{profiling.get('memory_usage_mb', '—')} MB"),
        ("Warnings", str(len(warnings))),
    ]
    for row_idx, (k, v) in enumerate(rows_data):
        cells = table.rows[row_idx].cells
        cells[0].text = k
        cells[1].text = v
        # Bold key column
        for r in cells[0].paragraphs[0].runs:
            r.bold = True

    # Warnings
    if warnings:
        doc.add_heading("Warnings", level=2)
        for w in warnings:
            doc.add_paragraph(str(w), style="List Bullet")

    # Per-column stats
    if columns_iter:
        doc.add_heading("Columns", level=2)
        ct = doc.add_table(rows=1, cols=4)
        ct.style = "Light Grid Accent 1"
        hdr = ct.rows[0].cells
        for i, h in enumerate(("Column", "Type", "Nulls", "Distinct")):
            hdr[i].text = h
            for r in hdr[i].paragraphs[0].runs:
                r.bold = True
        for cstats in columns_iter:
            row = ct.add_row().cells
            row[0].text = str(cstats.get("name", "—"))
            row[1].text = str(cstats.get("dtype", "—"))
            row[2].text = str(cstats.get("null_count", "—"))
            row[3].text = str(cstats.get("distinct_count", cstats.get("unique_count", "—")))

    # Clustering
    clustering = (result or {}).get("clustering") or {}
    if isinstance(clustering, dict) and clustering:
        doc.add_heading("Clustering", level=2)
        doc.add_paragraph(f"Cluster count: {clustering.get('n_clusters', '—')}")
        sizes = clustering.get("cluster_sizes") or {}
        if isinstance(sizes, dict) and sizes:
            for cid, count in sorted(sizes.items(), key=lambda kv: -int(kv[1])):
                doc.add_paragraph(f"Cluster {cid}: {count} rows", style="List Bullet")

    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


@router.get("/columns-data/{dataset_id}")
async def get_columns_data(
    dataset_id: UUID,
    cols: str = Query(..., description="Comma-separated column names"),
    limit: int = Query(1000, ge=10, le=5000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return raw values for the requested columns — used by the Graphs tab."""
    dataset = await assert_dataset_access(db, dataset_id, current_user)
    if dataset.source_type == "image":
        raise HTTPException(status_code=400, detail="Column data is not available for image datasets")

    v_stmt = (
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset_id)
        .order_by(DatasetVersion.version_number.desc())
        .limit(1)
    )
    version = (await db.execute(v_stmt)).scalars().first()
    if version is None:
        raise HTTPException(status_code=400, detail="Dataset has no uploaded versions yet")

    # Split on comma but preserve the user's exact spelling — datasets
    # parsed from semicolon-delimited CSVs often carry leading whitespace
    # in their column names (e.g. ' sex' rather than 'sex'), so blindly
    # stripping here would break the lookup. We still trim *if* nothing
    # matches the verbatim name.
    col_list = [c for c in cols.split(",") if c.strip()]
    if not col_list:
        raise HTTPException(status_code=400, detail="Specify at least one column")

    from data_intelligence.tasks.structuring_tasks import _load_dataset_file

    try:
        df = await asyncio.to_thread(
            _load_dataset_file, str(dataset_id), version.version_number,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not load dataset file: {exc}")

    available = list(df.columns)
    # Map stripped-name -> real column so the user can pass either form.
    stripped_lookup = {str(c).strip(): c for c in available}
    resolved: list = []
    missing: list[str] = []
    for c in col_list:
        if c in available:
            resolved.append(c)
        elif c.strip() in stripped_lookup:
            resolved.append(stripped_lookup[c.strip()])
        else:
            missing.append(c)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Columns not found: {missing}. Available: {available}",
        )

    sub = df[resolved].head(limit)
    data: dict = {}
    for c in resolved:
        out: list = []
        for v in sub[c].tolist():
            if v is None:
                out.append(None)
            elif isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                out.append(None)
            elif isinstance(v, (int, float, bool, str)):
                out.append(v)
            else:
                out.append(str(v))
        data[str(c)] = out

    return {"data": data, "count": len(sub), "total": int(len(df))}
