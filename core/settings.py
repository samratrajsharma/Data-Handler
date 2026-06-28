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
        "postgresql+asyncpg://orchestraty:orchestraty_dev@localhost:5432/orchestraty"
    )

    # ── MinIO / S3-compatible object storage ──────────────────────────────
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET_NAME: str = "orchestraty"
    MINIO_USE_SSL: bool = False

    # ── Redis ─────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Qdrant (Vector DB) ──────────────────────────────────────────────
    QDRANT_HOST: str = "qdrant"
    QDRANT_PORT: int = 6333
    QDRANT_COLLECTION: str = "orchestraty_embeddings"

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
    QDRANT_IMAGE_COLLECTION: str = "orchestraty_image_embeddings"
    IMAGE_ALLOWED_EXTENSIONS: str = ".png,.jpg,.jpeg,.webp,.tiff,.tif,.bmp"

    # ── Image embedding performance (CPU-friendly) ────────────────────────
    CLIP_QUANTIZE: bool = True           # int8 dynamic quantization on CPU (2-4x faster, ~half RAM)
    CLIP_NUM_THREADS: int = 0            # torch CPU threads (0 = auto = all cores)
    CLIP_BATCH_SIZE: int = 32            # images per inference batch
    CLIP_DOWNLOAD_CONCURRENCY: int = 8   # parallel MinIO downloads per batch
    CLIP_PRELOAD: bool = False           # warm CLIP at Celery worker boot (off = lazy on first task)


    # ── Runtime environment ───────────────────────────────────────────────
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"


settings = Settings()
