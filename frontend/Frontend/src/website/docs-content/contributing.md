# Contributing

Contributions are welcome. Orchestraty is MIT licensed.

## Local development

```bash
git clone https://github.com/your-username/orchestraty.git
cd orchestraty/ai-operating-system
cp .env.example .env
.\setup.ps1          # backend + dashboard
```

Verify before you push:

```bash
python -m compileall core app.py        # backend syntax
cd frontend/Frontend && npx tsc -b       # frontend types
```

## Where things live

| Path | What |
|------|------|
| `app.py`, `core/` | FastAPI entrypoint, settings, models, services, API routes |
| `data-intelligence-system/` | The pipeline packages (ingestion, structuring, eda, labeling, image, quality, orchestration) |
| `data_intelligence/tasks/` | Celery task definitions |
| `alembic/` | Database migrations |
| `frontend/Frontend/src/app` | Dashboard UI |
| `frontend/Frontend/src/website` | Marketing site + tour |
| `docs/` | This documentation (MkDocs) |

## Docs

```bash
pip install -r docs/requirements.txt
mkdocs serve     # preview at http://localhost:8000
```

## Style

- Keep changes scoped; one subsystem per PR where possible.
- Match the existing code style; no new linter warnings.
- Update the docs alongside features.
