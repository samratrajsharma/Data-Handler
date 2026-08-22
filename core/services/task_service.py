"""
Task service — submit background tasks and track them in the database.
"""

import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.models.background_task import BackgroundTask

logger = logging.getLogger(__name__)


async def create_task_record(
    db: AsyncSession,
    celery_task_id: str,
    task_type: str,
    dataset_id: UUID,
    parameters: dict | None = None,
) -> BackgroundTask:
    """Create a BackgroundTask record to track a Celery job."""
    task = BackgroundTask(
        celery_task_id=celery_task_id,
        task_type=task_type,
        status="pending",
        progress=0.0,
        dataset_id=dataset_id,
        parameters=parameters or {},
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    logger.info(
        "Created task record %s (celery=%s, type=%s, dataset=%s)",
        task.id, celery_task_id, task_type, dataset_id,
    )
    return task


def update_task_progress(
    db_session,
    celery_task_id: str,
    progress: float,
    message: str = "",
    status: str = "progress",
):
    """Update task progress — called from within Celery tasks (sync)."""
    from sqlalchemy import update
    from core.models.background_task import BackgroundTask

    stmt = (
        update(BackgroundTask)
        .where(BackgroundTask.celery_task_id == celery_task_id)
        .values(progress=progress, progress_message=message, status=status)
    )
    db_session.execute(stmt)
    db_session.commit()


def _sanitize_for_json(value):
    """Recursively coerce ``value`` into something safe for JSONB storage.

    Postgres JSONB (via asyncpg/psycopg) rejects NaN/inf floats and any
    non-JSON-native Python object. Task results routinely contain such values
    (numpy scalars from pandas/sklearn, NaN from empty aggregations, datetimes),
    which otherwise crash the *final* result write after all work is done —
    stranding tasks near progress≈0.95 regardless of task type.

    Conversions:
      * NaN / +/-inf floats                     -> None
      * numpy scalars / 0-d arrays              -> native Python scalar
      * numpy ndarray                           -> list
      * datetime / date / time / Timestamp /
        Timedelta (anything with isoformat())   -> ISO-8601 string
      * set / frozenset / tuple                 -> list
      * bytes / bytearray                       -> decoded str
      * anything else non-native                -> str(value)

    Kept dependency-light (no hard numpy/pandas import) so it runs anywhere.
    """
    import math
    from datetime import date, datetime, time

    # JSON-native scalars (bool is an int subclass; both pass straight through).
    if value is None or isinstance(value, (bool, int, str)):
        return value

    # Floats: drop non-finite values, coerce numpy float64 (a float subclass)
    # down to a plain Python float.
    if isinstance(value, float):
        return float(value) if math.isfinite(value) else None

    # Mappings — recurse, stringifying any non-string keys.
    if isinstance(value, dict):
        return {
            (k if isinstance(k, str) else str(_sanitize_for_json(k))): _sanitize_for_json(v)
            for k, v in value.items()
        }

    # Datetime-likes -> ISO string. pandas Timestamp subclasses datetime, so
    # this catches it too.
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()

    # Sequences / set-likes -> list.
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_sanitize_for_json(v) for v in value]

    # bytes -> text.
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", "replace")

    # Objects exposing isoformat() (e.g. pandas Timedelta).
    iso = getattr(value, "isoformat", None)
    if callable(iso):
        try:
            return iso()
        except Exception:
            return str(value)

    # numpy ndarray / scalar -> list / native scalar (recurse to sanitize).
    to_list = getattr(value, "tolist", None)
    if callable(to_list):
        try:
            return _sanitize_for_json(to_list())
        except Exception:
            return str(value)
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return _sanitize_for_json(item())
        except Exception:
            return str(value)

    # Anything else: last-resort string.
    return str(value)


def complete_task(
    db_session,
    celery_task_id: str,
    result: dict | None = None,
    error: str | None = None,
):
    """Mark a task as completed or failed — called from Celery tasks (sync)."""
    from datetime import datetime
    from sqlalchemy import update
    from core.models.background_task import BackgroundTask

    values = {
        "completed_at": datetime.utcnow(),
        "progress": 1.0 if error is None else BackgroundTask.progress,
    }
    if error:
        # A failed task usually leaves this Celery DB session in an aborted
        # transaction (the exception that produced `error` may have poisoned an
        # in-flight statement). Roll back first so this failure-state UPDATE can
        # actually execute instead of erroring on the broken transaction.
        db_session.rollback()
        values["status"] = "failed"
        values["error"] = _sanitize_for_json(error)
    else:
        values["status"] = "completed"
        values["result"] = _sanitize_for_json(result or {})

    stmt = (
        update(BackgroundTask)
        .where(BackgroundTask.celery_task_id == celery_task_id)
        .values(**values)
    )
    db_session.execute(stmt)
    db_session.commit()
