# Configuration

Orchestraty reads settings from environment variables (a local `.env` file in development).
Copy `.env.example` to `.env` and adjust. Unknown variables are ignored.

## Database & storage

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql+asyncpg://orchestraty:orchestraty_dev@postgres:5432/orchestraty` | Use `postgres` host in Docker, `localhost` outside. |
| `MINIO_ENDPOINT` | `minio:9000` | S3-compatible object store. |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | `minioadmin` / `minioadmin` | Local dev defaults — change for any shared deployment. |
| `MINIO_BUCKET_NAME` | `orchestraty` | |
| `MINIO_USE_SSL` | `false` | |
| `REDIS_URL` | `redis://redis:6379/0` | App cache. |

## Queues & vectors

| Variable | Default | Notes |
|----------|---------|-------|
| `CELERY_BROKER_URL` | `redis://redis:6379/1` | Task broker. |
| `CELERY_RESULT_BACKEND` | `redis://redis:6379/2` | Task results. |
| `QDRANT_HOST` / `QDRANT_PORT` | `qdrant` / `6333` | Vector DB. |
| `QDRANT_COLLECTION` | `orchestraty_embeddings` | Text embeddings. |
| `QDRANT_IMAGE_COLLECTION` | `orchestraty_image_embeddings` | Image embeddings. |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Sentence-transformer model. |

## LLM providers

| Variable | Default | Notes |
|----------|---------|-------|
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Reach host Ollama from inside Docker. |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GROQ_API_KEY` | *(empty)* | Bring your own. |
| `DEFAULT_LLM_PROVIDER` | `ollama` | |
| `DEFAULT_LLM_MODEL` | `llama3` | |

## Image pipeline

| Variable | Default |
|----------|---------|
| `IMAGE_THUMBNAIL_SIZE` | `256` |
| `IMAGE_MAX_UPLOAD_MB` | `50` |
| `IMAGE_BATCH_MAX_COUNT` | `100` |
| `CLIP_MODEL_NAME` | `openai/clip-vit-base-patch32` |
| `IMAGE_ALLOWED_EXTENSIONS` | `.png,.jpg,.jpeg,.webp,.tiff,.tif,.bmp` |

## Runtime

| Variable | Default | Notes |
|----------|---------|-------|
| `ENVIRONMENT` | `development` | `development` enables SQL echo; use `production` to quiet it. |

!!! warning "Secrets"
    Keep real keys in `.env` only — it is gitignored. Never commit `.env`. The committed
    `.env.example` should contain placeholders, not real secrets.
