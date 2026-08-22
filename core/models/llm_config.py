"""LLM provider configuration model."""
import uuid

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID

from core.database import Base

LOCAL_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


class LLMConfigRecord(Base):
    __tablename__ = "llm_configs"
    __table_args__ = (UniqueConstraint("provider", name="uq_provider"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Single-user default keeps legacy user-scoped queries matching.
    user_id = Column(UUID(as_uuid=True), nullable=True, default=LOCAL_USER_ID)
    provider = Column(String(50), nullable=False)
    model_name = Column(String(255), nullable=False)
    api_key_encrypted = Column(Text, nullable=True)
    base_url = Column(String(512), nullable=True)
    temperature = Column(Float, nullable=False, default=0.7)
    max_tokens = Column(Integer, nullable=False, default=2048)
    is_default = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now(), onupdate=func.now())
