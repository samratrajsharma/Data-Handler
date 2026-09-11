"""Squashed baseline: the complete Data Handler schema.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-09-11

WHY THIS REPLACES SIX MIGRATIONS
--------------------------------
The previous chain could not be run, on any database, ever:

  b30963890f73  "add background_tasks table" — upgrade() and downgrade() were
                both `pass`. An autogenerate stub nobody filled in.
  c41a8b2e1f90  created llm_configs with `sa.ForeignKey('users.id')`, but no
                migration in the chain ever created a `users` table. On a fresh
                database `alembic upgrade head` died here with UndefinedTable.
  d52b7c3f2a81  image_assets — FKs to datasets/dataset_versions, which no
                migration creates either.
  e63d8a4f5b92  workflows + workflow_templates — second `users` FK.
  f74e9b5c6d83  dropped users/orgs/audit_logs for the single-user pivot, and
                raises NotImplementedError on downgrade, so the chain was also
                un-downgradable past this point.
  a85c1d2e3f04  the five annotation tables — the only revision written
                defensively, precisely because its author knew create_all had
                usually already made them.

Four tables (datasets, dataset_versions, dataset_metadata, background_tasks)
had no migration at all. The real schema owner was `Base.metadata.create_all()`
running at app startup, which builds tables from the ORM but never writes an
`alembic_version` row and — critically — never ALTERS an existing table. So the
first time a model gained a column, every existing install would have run new
code against an old schema with no migration path and no error until a query
failed at runtime.

This revision is the true current schema, transcribed from the ORM models, so
Alembic can own DDL from here on and `alembic revision --autogenerate` produces
correct diffs.

ADOPTING AN EXISTING DATABASE
-----------------------------
Installs built by create_all already have these tables and an empty
`alembic_version`. They must be stamped, not upgraded — see
`core/db_bootstrap.py`, which stamps when the tables are already present and
upgrades when they are not. It also clears a stale `b30963890f73` stamp, which
is the one revision of the old chain that could succeed (it was a no-op) and so
is the only value that may be sitting in `alembic_version` in the wild.

FIDELITY
--------
Hand-written: this environment has no database to autogenerate against. A CI
step (`.github/workflows/smoke-test.yml`) therefore builds a database from this
revision and compares it column-by-column with `Base.metadata`, so any
transcription error fails the build rather than reaching a user.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Core dataset tables ───────────────────────────────────────────────
    op.create_table(
        "datasets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
    )

    op.create_table(
        "dataset_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(1024), nullable=False),
        sa.Column("file_name", sa.String(512), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("file_type", sa.String(100), nullable=False),
        sa.Column("schema_hash", sa.String(128), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=True),
        # Self-reference with no ondelete, matching the model.
        sa.Column("parent_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_version_id"], ["dataset_versions.id"]),
    )
    op.create_index("ix_dataset_versions_dataset_id", "dataset_versions", ["dataset_id"])

    op.create_table(
        "dataset_metadata",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("dataset_id", "key", name="uq_dataset_metadata_key"),
    )

    # ── Background tasks (also the de-facto results/document store) ───────
    op.create_table(
        "background_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("celery_task_id", sa.String(255), nullable=False),
        sa.Column("task_type", sa.String(100), nullable=False),
        sa.Column("status", sa.String(50), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("progress_message", sa.Text(), nullable=True),
        # Deliberately no FK: rule-set definitions store a placeholder id here.
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("parameters", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_background_tasks_celery_task_id", "background_tasks", ["celery_task_id"], unique=True)
    # NEW in this baseline. `(dataset_id, task_type, status)` ordered by
    # created_at DESC is the hottest filter in the codebase — roughly a dozen
    # call sites ask "newest completed task of type X for dataset Y"
    # (structuring_routes, review_routes, ai_labeling_tasks, annotation_export
    # …). None of those columns was indexed, and this table grows without bound
    # because it doubles as the rule-set store.
    op.create_index(
        "ix_background_tasks_lookup",
        "background_tasks",
        ["dataset_id", "task_type", "status", sa.text("created_at DESC")],
    )

    # ── Image assets ──────────────────────────────────────────────────────
    op.create_table(
        "image_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("original_path", sa.String(1024), nullable=False),
        sa.Column("thumbnail_path", sa.String(1024), nullable=True),
        sa.Column("file_name", sa.String(512), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("mime_type", sa.String(100), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("color_mode", sa.String(50), nullable=True),
        sa.Column("channels", sa.Integer(), nullable=True),
        sa.Column("has_exif", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("exif_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("embedding_id", sa.String(255), nullable=True),
        sa.Column("cluster_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["dataset_versions.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_image_assets_dataset_id", "image_assets", ["dataset_id"])
    op.create_index("ix_image_assets_dataset_version", "image_assets", ["dataset_id", "version_id"])

    # ── LLM provider configuration ────────────────────────────────────────
    op.create_table(
        "llm_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        # Vestigial single-user id. Kept because the ORM still declares it and
        # create_all-built databases already have the column — dropping it here
        # would desynchronise every existing install for no functional gain.
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("model_name", sa.String(255), nullable=False),
        # Name is historical: the value is stored in plaintext. Renaming it is a
        # separate change with an application-code migration attached.
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("base_url", sa.String(512), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=False),
        sa.Column("max_tokens", sa.Integer(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
        sa.UniqueConstraint("provider", name="uq_provider"),
    )

    # ── Workflows ─────────────────────────────────────────────────────────
    op.create_table(
        "workflows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(512), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
        sa.Column("steps", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("current_step", sa.Integer(), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_workflows_dataset_id", "workflows", ["dataset_id"])

    op.create_table(
        "workflow_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(512), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("steps", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # ── Annotation: classes are shared by the image and text labelers ─────
    op.create_table(
        "annotation_classes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("color", sa.String(16), nullable=False),
        sa.Column("shortcut", sa.String(8), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("dataset_id", "name", name="uq_annotation_class_name"),
    )
    op.create_index("ix_annotation_classes_dataset_id", "annotation_classes", ["dataset_id"])

    # Geometry is normalized 0..1 against the image's natural size, so exports
    # re-project using image_assets.width/height.
    op.create_table(
        "image_annotations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("x", sa.Float(), nullable=True),
        sa.Column("y", sa.Float(), nullable=True),
        sa.Column("w", sa.Float(), nullable=True),
        sa.Column("h", sa.Float(), nullable=True),
        sa.Column("points", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["asset_id"], ["image_assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["class_id"], ["annotation_classes.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_image_annotations_dataset_id", "image_annotations", ["dataset_id"])
    op.create_index("ix_image_annotations_asset_id", "image_annotations", ["asset_id"])
    op.create_index("ix_image_annotations_class_id", "image_annotations", ["class_id"])
    op.create_index("ix_image_annotations_dataset_asset", "image_annotations", ["dataset_id", "asset_id"])

    # asset_id is the primary key: one workflow state row per image.
    op.create_table(
        "image_annotation_states",
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="unannotated"),
        sa.Column("split", sa.String(10), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["asset_id"], ["image_assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_image_annotation_states_dataset_id", "image_annotation_states", ["dataset_id"])

    op.create_table(
        "text_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("doc_index", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(512), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="unlabeled"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["dataset_versions.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_text_documents_dataset_id", "text_documents", ["dataset_id"])
    op.create_index("ix_text_documents_dataset_index", "text_documents", ["dataset_id", "doc_index"])

    op.create_table(
        "text_annotations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        # Character offsets, not UTF-16 code units — the editor converts before
        # sending so Python and JavaScript agree on span boundaries.
        sa.Column("start_offset", sa.Integer(), nullable=True),
        sa.Column("end_offset", sa.Integer(), nullable=True),
        sa.Column("snippet", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["text_documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["class_id"], ["annotation_classes.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_text_annotations_dataset_id", "text_annotations", ["dataset_id"])
    op.create_index("ix_text_annotations_document_id", "text_annotations", ["document_id"])
    op.create_index("ix_text_annotations_class_id", "text_annotations", ["class_id"])


def downgrade() -> None:
    """Drop everything, children first.

    Implemented — unlike the chain this replaces, which raised
    NotImplementedError partway through and could not be rewound.
    """
    for table in (
        "text_annotations",
        "text_documents",
        "image_annotation_states",
        "image_annotations",
        "annotation_classes",
        "workflow_templates",
        "workflows",
        "llm_configs",
        "image_assets",
        "background_tasks",
        "dataset_metadata",
        "dataset_versions",
        "datasets",
    ):
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')
