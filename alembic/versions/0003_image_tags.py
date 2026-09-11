"""Add free-form per-image tags.

Revision ID: 0003_image_tags
Revises: 0002_annotation_mask
Create Date: 2026-09-12

WHY A TABLE AND NOT A JSONB ARRAY ON image_assets
-------------------------------------------------
A `tags text[]` column would be less code, and wrong for the thing tags are for.
Tags exist to answer "show me every blurry one" or "which images did we flag as
needs-review?" — queries that filter and count across a dataset. A JSONB array
makes those a sequential scan with a containment operator; a row per tag makes
them an index lookup, and gives the tag list itself (`SELECT DISTINCT tag`)
for free.

It also makes the unique constraint expressible: one row per (asset, tag) means
the database refuses a duplicate tag, rather than the application having to
de-duplicate an array on every write and hoping no concurrent request slips
past.

NORMALISATION
-------------
Tags are stored already lower-cased and trimmed (the API does this). Without it
"Blurry", "blurry" and "blurry " become three different tags that look identical
in a list, and users would never find the one they meant. Case is not worth
preserving for a filter key.

TAGS ARE NOT CLASSES
--------------------
`annotation_classes` describes what is IN an image and drives training labels.
Tags are workflow metadata about the image itself — lighting, quality, source
batch, "recheck this". They are deliberately not exported to training formats.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_image_tags"
down_revision = "0002_annotation_mask"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "image_tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        # Denormalised from the asset so "all tags in this dataset" is one
        # indexed read rather than a join through image_assets.
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tag", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["asset_id"], ["image_assets.id"], ondelete="CASCADE"),
        # The database, not the application, guarantees a tag appears once per
        # image — including against two concurrent requests.
        sa.UniqueConstraint("asset_id", "tag", name="uq_image_tag"),
    )
    op.create_index("ix_image_tags_asset_id", "image_tags", ["asset_id"])
    # Serves both "which images carry this tag" and "what tags exist here".
    op.create_index("ix_image_tags_dataset_tag", "image_tags", ["dataset_id", "tag"])


def downgrade() -> None:
    op.drop_index("ix_image_tags_dataset_tag", table_name="image_tags")
    op.drop_index("ix_image_tags_asset_id", table_name="image_tags")
    op.drop_table("image_tags")
