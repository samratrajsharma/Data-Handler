"""
Application settings loaded from environment variables.
Uses pydantic-settings for validation and .env file support.
"""

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal

# Repo root: core/settings.py -> core/ -> <root>. The VERSION file next to it
# is the single place the product's version number is written down; the git
# tag, the image tag and this file are expected to agree, and the release
# checklist in the README says to bump it in the same commit that is tagged.
_VERSION_FILE = Path(__file__).resolve().parent.parent / "VERSION"


def _repo_version() -> str:
    """Read VERSION, or fall back to a clearly-not-a-release marker.

    Deliberately forgiving: a missing or unreadable VERSION file must degrade
    to a placeholder, never stop the app booting. Version reporting is
    diagnostic — it is not worth a crash loop, and this runs at import time
    before any logging is configured.
    """
    try:
        version = _VERSION_FILE.read_text(encoding="utf-8").strip()
        return version or "0.0.0-dev"
    except OSError:
        return "0.0.0-dev"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────────
    DATABASE_URL: str = (
        "postgresql+asyncpg://datahandler:datahandler_dev@localhost:5432/datahandler"
    )

    # ── MinIO / S3-compatible object storage ──────────────────────────────
    MINIO_ENDPOINT: str = "localhost:9000"
    # Browser-reachable MinIO address, used ONLY when presigning download
    # URLs. Inside Docker the app reaches MinIO at "minio:9000", but the
    # browser must use a host-reachable address (the published port).
    MINIO_PUBLIC_ENDPOINT: str = "localhost:9000"
    # Explicit region so presigning never needs a live GetBucketLocation
    # call (the public client cannot reach MinIO from inside the container).
    MINIO_REGION: str = "us-east-1"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET_NAME: str = "datahandler"
    MINIO_USE_SSL: bool = False

    # ── Redis ─────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Qdrant (Vector DB) ──────────────────────────────────────────────
    QDRANT_HOST: str = "qdrant"
    QDRANT_PORT: int = 6333
    QDRANT_COLLECTION: str = "datahandler_embeddings"

    # ── Celery ───────────────────────────────────────────────────────────
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/2"

    # ── Embedding Model ──────────────────────────────────────────────────
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"

    # ── LLM Providers ────────────────────────────────────────────────────
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    DEFAULT_LLM_PROVIDER: str = "ollama"
    DEFAULT_LLM_MODEL: str = "gemma4:e4b"

    # ── Image Pipeline ───────────────────────────────────────────────────
    IMAGE_THUMBNAIL_SIZE: int = 256
    IMAGE_MAX_UPLOAD_MB: int = 50
    IMAGE_BATCH_MAX_COUNT: int = 100
    CLIP_MODEL_NAME: str = "openai/clip-vit-base-patch32"
    QDRANT_IMAGE_COLLECTION: str = "datahandler_image_embeddings"
    IMAGE_ALLOWED_EXTENSIONS: str = ".png,.jpg,.jpeg,.webp,.tiff,.tif,.bmp"

    # ── Image embedding performance (CPU-friendly) ────────────────────────
    CLIP_QUANTIZE: bool = True           # int8 dynamic quantization on CPU (2-4x faster, ~half RAM)
    CLIP_NUM_THREADS: int = 0            # torch CPU threads (0 = auto = all cores)
    CLIP_BATCH_SIZE: int = 32            # images per inference batch
    CLIP_DOWNLOAD_CONCURRENCY: int = 8   # parallel MinIO downloads per batch
    CLIP_PRELOAD: bool = False           # warm CLIP at Celery worker boot (off = lazy on first task)


    # ── Runtime environment ───────────────────────────────────────────────
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"

    # ── Build identity ────────────────────────────────────────────────────
    # Resolution order, highest first:
    #
    #   1. APP_VERSION in the environment — set by the Dockerfile from the
    #      build arg CI fills with the git tag. A published image therefore
    #      reports the exact tag it was built from.
    #   2. The repo's VERSION file (see _repo_version at the top of this file).
    #   3. "0.0.0-dev", which now only happens if VERSION is missing.
    #
    # Step 2 is the one that was absent. Without it, anything not built by CI
    # — a local `run.ps1 -Build`, a contributor's checkout — reported
    # "0.0.0-dev" in the sidebar while the source tree was a released
    # version. The number a user reads and the number they downloaded
    # disagreed, which makes "which version are you on?" unanswerable in
    # exactly the case where you need the answer.
    APP_VERSION: str = _repo_version()

    @field_validator("APP_VERSION")
    @classmethod
    def _version_or_repo_file(cls, value: str) -> str:
        """Treat an empty APP_VERSION as absent rather than as a value.

        The Dockerfile sets ENV APP_VERSION unconditionally, so the variable
        exists even when no --build-arg was given. Without this, that empty
        string would satisfy the field and the app would report a blank
        version instead of falling through to VERSION.
        """
        cleaned = (value or "").strip()
        return cleaned or _repo_version()


settings = Settings()
