"""Workflow and workflow-template models."""
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from core.database import Base

LOCAL_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(512), nullable=False)
    description = Column(Text, nullable=True)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), nullable=True, default=LOCAL_USER_ID)
    status = Column(String(50), nullable=False, default="draft", server_default="draft")
    steps = Column(JSONB, nullable=False)
    current_step = Column(Integer, nullable=False, default=0)
    result = Column(JSONB, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now(), onupdate=func.now())


class WorkflowTemplate(Base):
    __tablename__ = "workflow_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(512), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    steps = Column(JSONB, nullable=False)
    category = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
