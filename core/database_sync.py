"""
Synchronous database session for Celery workers.
Celery tasks run in sync context, so they need a regular (non-async) session.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.settings import settings

# Convert async URL to sync: asyncpg → psycopg2
_sync_url = settings.DATABASE_URL.replace(
    "postgresql+asyncpg", "postgresql+psycopg2"
)

sync_engine = create_engine(_sync_url, pool_pre_ping=True)
SyncSessionLocal = sessionmaker(bind=sync_engine, autocommit=False, autoflush=False)


def get_sync_db():
    """Yield a synchronous database session."""
    db = SyncSessionLocal()
    try:
        yield db
    finally:
        db.close()
