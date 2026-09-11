"""Annotation models — manual image annotation (bbox / polygon /
classification) and text-document labeling (doc-level + span).

``AnnotationClass`` is dataset-scoped and modality-agnostic: the same class
list drives the image annotation canvas and the text labeler. Geometry is
stored **normalized** (0..1 relative to the image's natural size) so exports
can re-project to absolute pixels using ``ImageAsset.width/height``.
"""
import uuid

from sqlalchemy import (
    Column, DateTime, Float, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from core.database import Base


class AnnotationClass(Base):
    __tablename__ = "annotation_classes"
    __table_args__ = (
        UniqueConstraint("dataset_id", "name", name="uq_annotation_class_name"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name = Column(String(255), nullable=False)
    color = Column(String(16), nullable=False, default="#f97316")
    shortcut = Column(String(8), nullable=True)
    order_index = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ImageAnnotation(Base):
    __tablename__ = "image_annotations"
    __table_args__ = (
        Index("ix_image_annotations_dataset_asset", "dataset_id", "asset_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    asset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("image_assets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    class_id = Column(
        UUID(as_uuid=True),
        ForeignKey("annotation_classes.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 'bbox' | 'polygon' | 'classification' | 'mask'
    kind = Column(String(20), nullable=False)
    # Normalized geometry (0..1). bbox: x/y = top-left corner. Null for
    # classification; polygon uses ``points`` = [[x, y], ...].
    x = Column(Float, nullable=True)
    y = Column(Float, nullable=True)
    w = Column(Float, nullable=True)
    h = Column(Float, nullable=True)
    points = Column(JSONB, nullable=True)
    # Segmentation mask, for kind == 'mask' only. COCO compressed RLE:
    # ``{"size": [height, width], "counts": "<ascii>"}``.
    #
    # Unlike the columns above this is stored in ABSOLUTE PIXELS, because RLE is
    # defined over a pixel grid and `size` pins it to the image it was painted
    # on. Everything else here is normalized 0..1 and survives a resize; a mask
    # does not, which is why validate_rle() refuses one whose size disagrees
    # with the asset's width/height.
    mask = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=True,
        server_default=func.now(), onupdate=func.now(),
    )


class ImageAnnotationState(Base):
    """Per-image workflow state: annotate → approve/reject, plus split."""

    __tablename__ = "image_annotation_states"

    asset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("image_assets.id", ondelete="CASCADE"),
        primary_key=True,
    )
    dataset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 'unannotated' | 'annotated' | 'approved' | 'rejected'
    status = Column(String(20), nullable=False, default="unannotated", server_default="unannotated")
    # 'train' | 'valid' | 'test' | NULL (unassigned)
    split = Column(String(10), nullable=True)
    updated_at = Column(
        DateTime(timezone=True), nullable=True,
        server_default=func.now(), onupdate=func.now(),
    )


class ImageTag(Base):
    """A free-form workflow tag on one image.

    Distinct from ``AnnotationClass``: a class says what is IN the image and
    becomes a training label; a tag is metadata ABOUT the image — "blurry",
    "night", "recheck", "batch-3" — used for filtering and triage, and never
    exported to training formats.

    One row per (asset, tag) rather than an array column, so "every image
    tagged X" is an index lookup and the uniqueness is enforced by the
    database. Tags arrive already lower-cased and trimmed from the API.
    """

    __tablename__ = "image_tags"
    __table_args__ = (
        UniqueConstraint("asset_id", "tag", name="uq_image_tag"),
        Index("ix_image_tags_dataset_tag", "dataset_id", "tag"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Denormalised from the asset so dataset-wide tag queries avoid a join.
    dataset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    asset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("image_assets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    tag = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class TextDocument(Base):
    """One labelable text document, produced by splitting an uploaded .txt
    file (whole-file, blank-line blocks, or per-line)."""

    __tablename__ = "text_documents"
    __table_args__ = (
        Index("ix_text_documents_dataset_index", "dataset_id", "doc_index"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    version_id = Column(
        UUID(as_uuid=True),
        ForeignKey("dataset_versions.id", ondelete="CASCADE"),
        nullable=True,
    )
    doc_index = Column(Integer, nullable=False, default=0)
    name = Column(String(512), nullable=False)
    content = Column(Text, nullable=False)
    char_count = Column(Integer, nullable=False, default=0)
    # 'unlabeled' | 'labeled'
    status = Column(String(20), nullable=False, default="unlabeled", server_default="unlabeled")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class TextAnnotation(Base):
    __tablename__ = "text_annotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    document_id = Column(
        UUID(as_uuid=True),
        ForeignKey("text_documents.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    class_id = Column(
        UUID(as_uuid=True),
        ForeignKey("annotation_classes.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 'doc' (document-level label) | 'span' (character-offset range)
    kind = Column(String(10), nullable=False)
    start_offset = Column(Integer, nullable=True)
    end_offset = Column(Integer, nullable=True)
    # Denormalized excerpt of the covered text, for list UIs and exports.
    snippet = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
