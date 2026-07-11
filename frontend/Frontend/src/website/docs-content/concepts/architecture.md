# Architecture

Orchestraty is a FastAPI backend, a React frontend, and a handful of open-source data
services — all orchestrated locally with Docker Compose.

## Components

| Component | Role |
|-----------|------|
| **FastAPI** (`:8000`) | Async API server. All routes are under `/api/v1/*`. |
| **React dashboard** (`:5173`) | The single-user app — one page per pipeline stage. |
| **Marketing site** (`:5273`) | Separate Vite entry for the public landing + `/tour`. |
| **PostgreSQL** | Primary database — datasets, versions, tasks, labels, workflows, LLM config. |
| **MinIO** | S3-compatible object storage for raw and processed dataset bytes. |
| **Redis + Celery** | Task broker and async workers for every long-running pipeline step. |
| **Qdrant** | Vector database for text and image embeddings (search + propagation). |
| **LiteLLM** | One interface in front of OpenAI, Anthropic, Groq, Ollama, and LM Studio. |
| **CLIP / SentenceTransformers** | Image and text embedding models. |

## Request flow

1. A route under `/api/v1/*` validates the request and writes a `BackgroundTask` row.
2. It dispatches a **Celery** task (`.apply_async`) and returns a `task_id` immediately.
3. The worker runs the pipeline step, streaming progress back into the task row.
4. The dashboard **polls** the task until it completes, then loads the results.

This keeps the UI responsive while heavy work (embeddings, clustering, LLM batches) runs in
the background.

## Single-user by design

There is no authentication, no accounts, and no multi-tenant surface. Every request resolves
to one fixed local user. Whoever can reach the port has full access — which is the point of a
local-first tool. See the [FAQ](../faq.md) for the reasoning.

## The two frontends

The same `frontend/Frontend` directory builds two independent Vite apps:

- `index.html` → the dashboard (`src/app/`), served at `:5173`.
- `website.html` → the marketing site (`src/website/`), served at `:5273`.

Their import graphs are disjoint; shared code lives in `src/shared/`.
