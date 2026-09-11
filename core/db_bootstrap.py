"""Bring the database schema to head at startup — the single owner of DDL.

WHY THIS EXISTS
---------------
The schema used to have two competing owners:

  * `Base.metadata.create_all()`, called from the app lifespan. It builds tables
    from the ORM, never writes an `alembic_version` row, and — the part that
    matters — never ALTERS an existing table. It creates what is missing and
    silently ignores what has changed.
  * Alembic, whose chain could not actually run (a migration referenced a
    `users` table nothing created, and four tables had no migration at all).

So in practice create_all owned the schema and Alembic was decorative. That is
fine until a model gains a column: create_all does nothing to existing tables,
Alembic cannot run, and the upgrading user's app queries a column that does not
exist. The failure appears at query time, in a background job, as an
OperationalError — nowhere near the cause.

This module makes Alembic the only owner and, critically, teaches it how to
adopt the databases create_all already built.

THE FOUR STATES A DATABASE CAN BE IN
------------------------------------
  1. Empty (fresh install)             -> upgrade to head; Alembic creates all.
  2. Tables present, no version row    -> built by create_all. STAMP, do not
                                          upgrade: the tables already exist and
                                          re-creating them would fail.
  3. Tables present, stale version     -> `b30963890f73` is the only revision of
                                          the old chain that could succeed (it
                                          was a no-op `pass`), so it is the one
                                          value that may be sitting in
                                          alembic_version in the wild. Its id no
                                          longer exists, which makes Alembic
                                          raise. Clear it, then stamp.
  4. Tables present, valid version     -> ordinary upgrade.

CONCURRENCY
-----------
API and worker containers start together and both import this. DDL under a
Postgres advisory lock means whichever arrives second waits and then finds the
work already done, instead of two processes racing to create the same tables.
"""
from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

from core.settings import settings

logger = logging.getLogger(__name__)

# Any 64-bit constant; it only has to be unique within this database.
_ADVISORY_LOCK_KEY = 918_273_645

# A table that exists in every create_all-built install. Its presence is what
# distinguishes "already provisioned" from "empty database".
_SENTINEL_TABLE = "datasets"


def _sync_url() -> str:
    """Sync URL for the inspection/advisory-lock connection only.

    Alembic itself runs async via env.py. This module needs a plain synchronous
    connection to answer "what state is this database in?" before deciding
    between upgrade and stamp, and psycopg2 is already a dependency because the
    Celery workers use it.
    """
    return settings.DATABASE_URL.replace("postgresql+asyncpg", "postgresql+psycopg2")


def _assert_alembic_not_shadowed() -> None:
    """Fail with an explanation if `import alembic` resolves to our own folder.

    app.py puts the project root first on sys.path. The migrations live in
    ./alembic, so if that directory contains an `__init__.py` it becomes a
    regular package and wins the import over the installed library — and
    `from alembic import command` dies with a bare

        ImportError: cannot import name 'command' from 'alembic'
                     (/app/alembic/__init__.py)

    which says nothing about the real cause. An empty `alembic/__init__.py`
    shipped in this repo for exactly that reason. Deleting it is the fix: with
    no `__init__.py` the directory is only a namespace portion, and Python keeps
    scanning sys.path until it finds the real package in site-packages.

    The CLI (`alembic upgrade head`) is unaffected either way — its sys.path[0]
    is the console script's directory, not the project root — which is why this
    only ever broke the in-process path.
    """
    import alembic

    if not hasattr(alembic, "command") and not hasattr(alembic, "__version__"):
        location = getattr(alembic, "__file__", "<namespace package>")
        raise RuntimeError(
            "The installed 'alembic' library is being shadowed by the project's "
            f"own migrations directory (resolved to {location}). Delete "
            "alembic/__init__.py — the migrations folder must not be a Python "
            "package."
        )


def _alembic_config():
    _assert_alembic_not_shadowed()
    from alembic.config import Config

    root = Path(__file__).resolve().parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    # The URL is deliberately NOT set here. alembic/env.py overrides
    # sqlalchemy.url from settings.DATABASE_URL unconditionally and builds an
    # *async* engine from it, so anything set here would be discarded — setting
    # a psycopg2 URL would look like it worked and then be silently replaced.
    # env.py owns the connection; this module only owns the decision.
    return cfg


def _known_revisions(cfg) -> set[str]:
    from alembic.script import ScriptDirectory

    return {r.revision for r in ScriptDirectory.from_config(cfg).walk_revisions()}


def ensure_schema() -> str:
    """Make the database match the models. Returns what it did, for logging.

    Raises on failure rather than falling back to create_all: a silent fallback
    is precisely the ambiguity this module removes. A hard failure at startup is
    visible and fixable; a schema that quietly disagrees with the code is not.
    """
    from alembic import command

    cfg = _alembic_config()
    engine = create_engine(_sync_url(), pool_pre_ping=True)

    try:
        with engine.begin() as conn:
            # Serialise across api/worker. Released automatically at commit.
            conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _ADVISORY_LOCK_KEY})

            inspector = inspect(conn)
            tables = set(inspector.get_table_names())
            provisioned = _SENTINEL_TABLE in tables

            current = None
            if "alembic_version" in tables:
                row = conn.execute(text("SELECT version_num FROM alembic_version")).fetchone()
                current = row[0] if row else None

            known = _known_revisions(cfg)

            if not provisioned:
                action = "upgrade"          # state 1
            elif current is None:
                action = "stamp"            # state 2
            elif current not in known:
                action = "restamp"          # state 3
            else:
                action = "upgrade"          # state 4

            if action == "restamp":
                logger.warning(
                    "alembic_version holds unknown revision %r (left by the "
                    "pre-baseline migration chain). Clearing and re-stamping.",
                    current,
                )
                conn.execute(text("DELETE FROM alembic_version"))

        # command.* open their own connections, so they must run outside the
        # transaction above — the advisory lock has done its job by now.
        if action == "upgrade":
            command.upgrade(cfg, "head")
        else:
            command.stamp(cfg, "head")
            logger.info(
                "Existing tables detected with no migration history — stamped "
                "at head. This database was created by the old create_all path; "
                "future schema changes will now be applied as migrations."
            )

        logger.info("Database schema ready (%s).", action)
        return action
    finally:
        engine.dispose()
