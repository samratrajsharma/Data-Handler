"""Dataset, version, and metadata models."""
import uuid

from sqlalchemy import (
    BigInteger, Column, DateTime, ForeignKey, Integer, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from core.database import Base


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    source_type = Column(String(50), nullable=False)
    status = Column(String(50), nullable=False, default="raw")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now(), onupdate=func.now())

    versions = relationship(
        "DatasetVersion",
        back_populates="dataset",
        cascade="all, delete-orphan",
        order_by="DatasetVersion.version_number",
    )
    metadata_entries = relationship(
        "DatasetMetadata",
        back_populates="dataset",
        cascade="all, delete-orphan",
    )


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    storage_path = Column(String(1024), nullable=False)
    file_name = Column(String(512), nullable=False)
    file_size = Column(BigInteger, nullable=True)
    file_type = Column(String(100), nullable=False)
    schema_hash = Column(String(128), nullable=True)
    row_count = Column(Integer, nullable=True)
    parent_version_id = Column(UUID(as_uuid=True), ForeignKey("dataset_versions.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    dataset = relationship("Dataset", back_populates="versions")


class DatasetMetadata(Base):
    __tablename__ = "dataset_metadata"
    __table_args__ = (UniqueConstraint("dataset_id", "key", name="uq_dataset_metadata_key"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    key = Column(String(255), nullable=False)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now(), onupdate=func.now())

    dataset = relationship("Dataset", back_populates="metadata_entries")
