"""
Alembic environment configuration for async PostgreSQL migrations.

This file is executed by Alembic whenever a migration command is run.
It configures the migration context to use the async SQLAlchemy engine
from our application so that ``--autogenerate`` can detect model changes.
"""

import asyncio
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# Ensure project root is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.settings import settings  # noqa: E402

# Import ALL models so Base.metadata is fully populated for autogenerate
from core.models import Base  # noqa: E402, F401
from core.models import (  # noqa: E402, F401
    Dataset,
    DatasetVersion,
    DatasetMetadata,
)

# Alembic Config object — gives access to values in alembic.ini
config = context.config

# Interpret the config file for Python logging (if present)
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# MetaData target for 'autogenerate' support
target_metadata = Base.metadata

# Override sqlalchemy.url from application settings so we have a single
# source of truth for the connection string.
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)


# ---------------------------------------------------------------------------
# Offline migrations (emit SQL to stdout, no live DB connection)
# ---------------------------------------------------------------------------


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Configures the context with just a URL and not an Engine.
    Calls to ``context.execute()`` emit the given SQL string to the script
    output.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


# ---------------------------------------------------------------------------
# Online (async) migrations
# ---------------------------------------------------------------------------


def do_run_migrations(connection: Connection) -> None:
    """Run migrations within a synchronous connection callback."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Create an async engine and run migrations."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode using an async engine."""
    asyncio.run(run_async_migrations())


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
