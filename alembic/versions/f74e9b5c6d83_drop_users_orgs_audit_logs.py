"""drop users orgs audit_logs permissions and FK columns

Single-user migration: drops every multi-tenant artifact:
* tables: users, audit_logs, dataset_permissions
* columns: datasets.created_by, datasets.org_id, dataset_versions.created_by,
  background_tasks.created_by, workflows.created_by, llm_configs.user_id
* enum types: user_role (if present)

The migration is idempotent — it checks for the existence of each FK
constraint, column, table, and enum before dropping it, so running it
against a partially-migrated database (or a fresh one) does the right
thing.

Downgrade is intentionally unimplemented: the user / audit / permission
data destroyed here cannot be reconstructed.

Revision ID: f74e9b5c6d83
Revises: e63d8a4f5b92
Create Date: 2026-06-14 19:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f74e9b5c6d83"
down_revision: Union[str, None] = "e63d8a4f5b92"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# Reflection helpers — make every drop idempotent so the migration is safe
# on a fresh DB (where the objects never existed) and on an old DB (where
# they all do).
# ---------------------------------------------------------------------------

def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def _has_column(table: str, col: str) -> bool:
    if not _has_table(table):
        return False
    cols = sa.inspect(op.get_bind()).get_columns(table)
    return any(c["name"] == col for c in cols)


def _fk_name(table: str, col: str) -> str | None:
    """Return the name of the FK on ``table.col`` if one exists, else None."""
    if not _has_table(table):
        return None
    fks = sa.inspect(op.get_bind()).get_foreign_keys(table)
    for fk in fks:
        if col in (fk.get("constrained_columns") or []):
            return fk.get("name")
    return None


def _drop_column_if_exists(table: str, col: str) -> None:
    if not _has_column(table, col):
        return
    fk = _fk_name(table, col)
    if fk:
        op.drop_constraint(fk, table, type_="foreignkey")
    op.drop_column(table, col)


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:
    # 1) Drop FK-bearing columns on dependent tables FIRST so the users
    #    table can be dropped without constraint violations.
    _drop_column_if_exists("datasets", "created_by")
    _drop_column_if_exists("datasets", "org_id")
    _drop_column_if_exists("dataset_versions", "created_by")
    _drop_column_if_exists("background_tasks", "created_by")
    _drop_column_if_exists("workflows", "created_by")
    _drop_column_if_exists("llm_configs", "user_id")

    # The old llm_configs unique constraint was (user_id, provider). Re-create
    # it as just (provider) — the table is workspace-global now.
    if _has_table("llm_configs"):
        try:
            op.drop_constraint("uq_user_provider", "llm_configs", type_="unique")
        except Exception:
            pass
        try:
            op.create_unique_constraint("uq_provider", "llm_configs", ["provider"])
        except Exception:
            pass

    # 2) Drop the now-orphaned multi-tenant tables.
    for tbl in ("audit_logs", "dataset_permissions", "users"):
        if _has_table(tbl):
            op.drop_table(tbl)

    # 3) Drop the user_role enum type if it was created (Postgres only).
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        bind.exec_driver_sql("DROP TYPE IF EXISTS user_role")


def downgrade() -> None:
    """This migration is a one-way change. Restoring the users / audit_logs /
    permissions tables would require synthesising data that no longer
    exists in the codebase, so downgrade is intentionally unsupported."""
    raise NotImplementedError(
        "This drop migration cannot be reversed — see migration docstring."
    )
