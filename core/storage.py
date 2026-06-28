"""
Shared MinIO client factory.

Every module that needs a MinIO ``Minio`` instance should call
``get_minio_client()`` from here instead of constructing one inline.
"""

from minio import Minio

from core.settings import settings


def get_minio_client() -> Minio:
    """Return a new MinIO client configured from application settings."""
    return Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_USE_SSL,
    )
