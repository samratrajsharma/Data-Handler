#!/usr/bin/env python
"""Fail if the migrated database disagrees with the ORM models.

WHY THIS EXISTS
---------------
`alembic/versions/0001_baseline_schema.py` was written by hand, because the
environment it was authored in had no database to run `--autogenerate` against.
Hand transcription of 13 tables is exactly the kind of work that silently drops
a column, and the symptom would appear much later as an OperationalError inside
a background job.

So the baseline is not trusted — it is verified. CI brings up a clean Postgres,
lets Alembic build the schema, and then runs this script to compare the result
with `Base.metadata` column by column. A typo fails the build instead of
reaching a user.

It keeps earning its place after the baseline: any future migration that drifts
from the models — a column added to a model with no migration written, or the
reverse — fails here too. That is the failure mode this whole phase exists to
remove.

WHAT IT COMPARES
----------------
Table names, column names, and nullability. Deliberately NOT types: SQLAlchemy
reflects `String(50)` back as `VARCHAR(50)`, `JSONB` as `JSONB`, server defaults
get normalised by Postgres, and comparing those faithfully produces noise that
trains people to ignore the check. Names and nullability catch the mistakes that
actually break queries.

Usage (inside the api container, where the app's deps and DB URL live):
    python scripts/check_schema_drift.py
Exits 0 when they match, 1 with a report when they do not.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, inspect  # noqa: E402

from core.models import Base  # noqa: E402  (imports every model)
from core.settings import settings  # noqa: E402

# Alembic's own bookkeeping table is not part of the ORM and is expected.
IGNORED_TABLES = {"alembic_version"}


def main() -> int:
    url = settings.DATABASE_URL.replace("postgresql+asyncpg", "postgresql+psycopg2")
    engine = create_engine(url)
    problems: list[str] = []

    try:
        inspector = inspect(engine)
        db_tables = set(inspector.get_table_names()) - IGNORED_TABLES
        orm_tables = set(Base.metadata.tables)

        missing = orm_tables - db_tables
        extra = db_tables - orm_tables

        for t in sorted(missing):
            problems.append(f"table MISSING from database: {t}")
        for t in sorted(extra):
            problems.append(f"table in database but not in the models: {t}")

        for table_name in sorted(orm_tables & db_tables):
            orm_cols = {c.name: c for c in Base.metadata.tables[table_name].columns}
            db_cols = {c["name"]: c for c in inspector.get_columns(table_name)}

            for name in sorted(set(orm_cols) - set(db_cols)):
                problems.append(f"{table_name}.{name}: in the model, MISSING from the database")
            for name in sorted(set(db_cols) - set(orm_cols)):
                problems.append(f"{table_name}.{name}: in the database, not in the model")

            for name in sorted(set(orm_cols) & set(db_cols)):
                orm_nullable = bool(orm_cols[name].nullable)
                db_nullable = bool(db_cols[name]["nullable"])
                # A primary key is NOT NULL in the database regardless of how
                # the model declares it; that difference is expected, not drift.
                if orm_cols[name].primary_key:
                    continue
                if orm_nullable != db_nullable:
                    problems.append(
                        f"{table_name}.{name}: nullable differs "
                        f"(model={orm_nullable}, database={db_nullable})"
                    )
    finally:
        engine.dispose()

    if problems:
        print("SCHEMA DRIFT — the migrated database does not match the ORM models:\n")
        for p in problems:
            print(f"  - {p}")
        print(
            "\nFix the baseline/migration to match the models (or the models to "
            "match the intended schema). Do NOT paper over this with create_all: "
            "it cannot alter existing tables, which is the bug this check exists "
            "to prevent."
        )
        return 1

    print(f"Schema matches the models — {len(Base.metadata.tables)} tables verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
