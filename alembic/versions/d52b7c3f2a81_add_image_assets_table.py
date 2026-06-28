"""add image_assets table

Revision ID: d52b7c3f2a81
Revises: c41a8b2e1f90
Create Date: 2026-05-17 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd52b7c3f2a81'
down_revision: Union[str, None] = 'c41a8b2e1f90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'image_assets',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('dataset_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('datasets.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('version_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('dataset_versions.id', ondelete='CASCADE'),
                  nullable=True),
        sa.Column('original_path', sa.String(1024), nullable=False),
        sa.Column('thumbnail_path', sa.String(1024), nullable=True),
        sa.Column('file_name', sa.String(512), nullable=False),
        sa.Column('file_size', sa.BigInteger(), nullable=True),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('color_mode', sa.String(50), nullable=True),
        sa.Column('channels', sa.Integer(), nullable=True),
        sa.Column('has_exif', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('exif_data', postgresql.JSONB(), nullable=True),
        sa.Column('embedding_id', sa.String(255), nullable=True),
        sa.Column('cluster_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        'ix_image_assets_dataset_version',
        'image_assets',
        ['dataset_id', 'version_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_image_assets_dataset_version', table_name='image_assets')
    op.drop_table('image_assets')
