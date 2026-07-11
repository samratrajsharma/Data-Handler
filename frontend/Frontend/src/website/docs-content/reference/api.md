# API reference

The backend is a FastAPI app. Every route lives under `/api/v1/*`, and interactive docs are
generated automatically.

## Interactive docs

With the stack running:

- **Swagger UI** — <http://localhost:8000/docs>
- **ReDoc** — <http://localhost:8000/redoc>
- **OpenAPI schema** — <http://localhost:8000/openapi.json>

You can export `openapi.json` and embed it in these docs, or generate a typed client from it.

## Route groups

| Prefix | Area |
|--------|------|
| `/api/v1/datasets` | Ingest, versions, preview, columns |
| `/api/v1/structuring` | Cleaning + recommendations |
| `/api/v1/eda` | Profiling, embeddings, clustering, reports |
| `/api/v1/labeling` | Rule-based labeling + saved rule sets |
| `/api/v1/labeling/ai` | AI predict, propagate, aggregate, synthetic, active-learning |
| `/api/v1/images` | Upload, embed, cluster, search |
| `/api/v1/review` | Quality eval, review actions, export, status |
| `/api/v1/workflows` | Workflow DAGs + templates |
| `/api/v1/llm` | Provider config + connection test |
| `/api/v1/tasks` | Background task status (polled by the UI) |

## Async pattern

Long-running endpoints return a `task_id` immediately and run the work in Celery. Poll
`GET /api/v1/tasks/{task_id}` (the dashboard does this for you) for progress and results.

There is no authentication — every request resolves to the single local user.
