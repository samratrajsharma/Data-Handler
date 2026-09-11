"""
Application settings loaded from environment variables.
Uses pydantic-settings for validation and .env file support.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal


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
    # Set at image build time from the git tag (Dockerfile ARG APP_VERSION,
    # supplied by CI as the ref name). Surfaced in /health and the OpenAPI
    # title so a bug report identifies the exact build it came from — the
    # version used to be hardcoded "0.1.0" in app.py and never changed,
    # which made "which version are you on?" unanswerable.
    # Local builds leave the default.
    APP_VERSION: str = "0.0.0-dev"


settings = Settings()
