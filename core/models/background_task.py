"""Celery background-task tracking model. Central results store (JSONB blobs)."""
import uuid

from sqlalchemy import Column, DateTime, Float, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from core.database import Base

# Stable single-user identity (mirrors auth_service.LOCAL_USER_ID).
LOCAL_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


class BackgroundTask(Base):
    __tablename__ = "background_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    celery_task_id = Column(String(255), nullable=False, unique=True, index=True)
    task_type = Column(String(100), nullable=False)
    status = Column(String(50), nullable=False, default="pending")
    progress = Column(Float, nullable=False, default=0.0)
    progress_message = Column(Text, nullable=True)
    # No FK: some task types (e.g. rule-set definitions) use a placeholder id.
    dataset_id = Column(UUID(as_uuid=True), nullable=True)
    parameters = Column(JSONB, nullable=False, default=dict)
    result = Column(JSONB, nullable=True)
    error = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True, default=LOCAL_USER_ID)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
