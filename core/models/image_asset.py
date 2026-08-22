"""Image asset model (curation pipeline)."""
import uuid

from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from core.database import Base


class ImageAsset(Base):
    __tablename__ = "image_assets"
    __table_args__ = (Index("ix_image_assets_dataset_version", "dataset_id", "version_id"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id = Column(UUID(as_uuid=True), ForeignKey("dataset_versions.id", ondelete="CASCADE"), nullable=True)
    original_path = Column(String(1024), nullable=False)
    thumbnail_path = Column(String(1024), nullable=True)
    file_name = Column(String(512), nullable=False)
    file_size = Column(BigInteger, nullable=True)
    mime_type = Column(String(100), nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    color_mode = Column(String(50), nullable=True)
    channels = Column(Integer, nullable=True)
    has_exif = Column(Boolean, nullable=False, default=False, server_default="false")
    exif_data = Column(JSONB, nullable=True)
    embedding_id = Column(String(255), nullable=True)
    cluster_id = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
