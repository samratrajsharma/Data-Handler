"""
Shared MinIO client factory.

Every module that needs a MinIO ``Minio`` instance should call
``get_minio_client()`` from here instead of constructing one inline.
"""

from functools import lru_cache

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


@lru_cache(maxsize=1)
def get_minio_public_client() -> Minio:
    """MinIO client bound to MINIO_PUBLIC_ENDPOINT.

    Used ONLY to presign GET URLs handed to the user's browser. Presigning is
    an offline signature computation, so this client never needs to reach
    MinIO — it only controls the host baked into (and signed in) the URL.
    Cached as a singleton since it is stateless.
    """
    return Minio(
        settings.MINIO_PUBLIC_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_USE_SSL,
        region=settings.MINIO_REGION,  # avoid a live region lookup when presigning
    )
