"""add annotation tables (image + text labeling)

Revision ID: a85c1d2e3f04
Revises: f74e9b5c6d83
Create Date: 2026-07-19 12:00:00.000000

Adds the five manual-annotation tables: annotation_classes,
image_annotations, image_annotation_states, text_documents, and
text_annotations. Guarded with existence checks because ``init_db()``
runs ``create_all`` at app startup, so on some installs these tables
already exist before this migration runs.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a85c1d2e3f04'
down_revision: Union[str, None] = 'f74e9b5c6d83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_tables() -> set[str]:
    bind = op.get_bind()
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    existing = _existing_tables()

    if 'annotation_classes' not in existing:
        op.create_table(
            'annotation_classes',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('dataset_id', postgresql.UUID(as_uuid=True),
                      sa.ForeignKey('datasets.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('color', sa.String(16), nullable=False),
            sa.Column('shortcut', sa.String(8), nullable=True),
            sa.Column('order_index', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint('dataset_id', 'name', name='uq_annotation_class_name'),
        )

    if 'image_annotations' not in existing:
        op.create_table(
            'image_annotations',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('dataset_id', postgresql.UUID(as_uuid=True),
                      sa.ForeignKey('datasets.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('asset_id', postgresql.UUID(as_uuid=True),
                      sa.ForeignKey('image_assets.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('class_id', postgresql.UUID(as_uuid=True),
                      sa.ForeignKey('annotation_classes.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('kind', sa.String(20), nullable=False),
            sa.Column('x', sa.Float(), nullable=True),
            sa.Column('y', sa.Float(), nullable=True),
            sa.Column('w', sa.Float(), nullable=True),
            sa.Column('h', sa.Float(), nullable=True),
            sa.Column('points', postgresql.JSONB(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(timezone=True),
                      nullable=True, server_default=sa.func.now()),
        )
        op.create_index(
            'ix_image_annotations_dataset_asset',
            'image_annotations',
            ['dataset_id', 'asset_id'],
        )

    if 'image_annotation_states' not in existing:
        op.create_table(
            'image_annotation_states',
            sa.Column('asset_id', postgresql.UUID(as_uuid=True),
                      sa.ForeignKey('image_assets.id', ondelete='CASCADE'),
                      primary_key=True),
            sa.Column('dataset_id', postgresql.UUID(as_uuid=True),
                      sa.ForeignKey('datasets.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('status', sa.String(20), nullable=False,
                      server_default='unannotated'),
            sa.Column('split', sa.String(10), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True),
                      nullable=True, server_default=sa.func.now()),
        )

    if 'text_documents' not in existing:
        op.create_table(
            'text_documents',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('dataset_id', postgresql.UUID(as_uuid=True),
                      sa.ForeignKey('datasets.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('version_id', postgresql.UUID(as_uuid=True),
                      sa.ForeignKey('dataset_versions.id', ondelete='CASCADE'),
                      nullable=True),
            sa.Column('doc_index', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(512), nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('char_count', sa.Integer(), nullable=False),
            sa.Column('status', sa.String(20), nullable=False,
                      server_default='unlabeled'),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      nullable=False, server_default=sa.func.now()),
        )
        op.create_index(
            'ix_text_documents_dataset_index',
            'text_documents',
            ['dataset_id', 'doc_index'],
        )

    if 'text_annotations' not in existing:
        op.create_table(
            'text_annotations',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('dataset_id', postgresql.UUID(as_uuid=True),
                      sa.ForeignKey('datasets.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('document_id', postgresql.UUID(as_uuid=True),
                      sa.ForeignKey('text_documents.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('class_id', postgresql.UUID(as_uuid=True),
                      sa.ForeignKey('annotation_classes.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('kind', sa.String(10), nullable=False),
            sa.Column('start_offset', sa.Integer(), nullable=True),
            sa.Column('end_offset', sa.Integer(), nullable=True),
            sa.Column('snippet', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    for table in (
        'text_annotations',
        'text_documents',
        'image_annotation_states',
        'image_annotations',
        'annotation_classes',
    ):
        op.execute(sa.text(f'DROP TABLE IF EXISTS {table} CASCADE'))
