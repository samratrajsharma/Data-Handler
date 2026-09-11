"""Add segmentation mask storage to image_annotations.

Revision ID: 0002_annotation_mask
Revises: 0001_baseline
Create Date: 2026-09-12

Adds ``image_annotations.mask`` (JSONB, nullable) and admits a new annotation
kind, ``'mask'``.

WHY A NEW COLUMN RATHER THAN REUSING `points`
---------------------------------------------
`points` means "polygon vertices, [[x, y], ...]". Storing a different shape in
it — an RLE object — would make the column's meaning depend on the sibling
`kind` value, which is how a schema starts lying about itself. A separate
nullable column keeps both readable, and keeps the frontend's TypeScript types
honest instead of forcing a union.

WHY RLE IN POSTGRES AND NOT A PNG IN MINIO
------------------------------------------
Masks in object storage mean a second fetch to render each one and an object
lifecycle to maintain — the same class of bug as the soft-deleted datasets that
leave their MinIO objects behind. Measured: a 640x480 blob encodes to ~607
characters of compressed COCO RLE (0.6 KB), so a mask costs about as much as a
long description field. See data-intelligence-system/labeling/mask_codec.py.

SHAPE
-----
COCO's own: ``{"size": [height, width], "counts": "<compressed ascii>"}``, which
means export writes it straight into `segmentation` with no lossy conversion.

NO DATA MIGRATION
-----------------
Nullable with no backfill: existing bbox/polygon/classification rows keep
``mask = NULL`` and are untouched. Downgrade drops the column, which discards
mask annotations — they have nowhere else to live.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_annotation_mask"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "image_annotations",
        sa.Column("mask", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("image_annotations", "mask")
