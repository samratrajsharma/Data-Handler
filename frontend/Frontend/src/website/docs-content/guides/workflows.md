# Workflows

Chain pipeline steps into a re-runnable DAG so you can reproduce the whole process on new data.

## Step types

`structuring`, `eda`, `labeling`, `ai_labeling`, `image_embeddings`, `clustering`,
`quality_eval`, and `export`.

## What you control

- **Build** a workflow from an ordered list of steps (each with its own config).
- **Templates** — start from a built-in template, or save your own.
- **Quick-start** — generate a sensible default pipeline for a CSV/JSON or image dataset.
- **Pause / resume** — control a run mid-flight; each step is a Celery task with its own status.

## What you get

- A named, repeatable pipeline with per-step status and results.
- One-click re-runs on tomorrow's data.

## API

| Method | Endpoint |
|--------|----------|
| `POST` | `/api/v1/workflows` · `/workflows/templates` · `/workflows/quick-start/{id}` |
| `GET` | `/api/v1/workflows` · `/workflows/templates` · `/workflows/{id}` |
| `PUT` | `/api/v1/workflows/{id}/pause` · `/resume` |
| `DELETE` | `/api/v1/workflows/{id}` |
