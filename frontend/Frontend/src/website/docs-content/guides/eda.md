# Exploratory Data Analysis (EDA)

Profile, embed, cluster, and visualize a dataset. The compute steps run in parallel as Celery
tasks; charts render in the dashboard and embeddings land in Qdrant for downstream search and
label propagation.

## What you control

- **Run profiling** — statistics, distributions, quality warnings.
- **Run embeddings** — sentence-transformer vectors → Qdrant.
- **Run clustering** — HDBSCAN, with a configurable **number of clusters**.

## What you get

Tabs in the dashboard:

- **Overview** — column-type split, missing-value summary, data-quality warnings.
- **Columns** — per-column cards (rows, nulls, unique, mean/std/skew; category bars).
- **Correlations** — numeric correlation matrix + strongest correlations.
- **Distributions / Graphs** — histograms, scatter, bar, line.
- **Report download** — JSON, PDF, or DOCX.

## API

| Method | Endpoint |
|--------|----------|
| `POST` | `/api/v1/eda/run` |
| `GET` | `/api/v1/eda/results/{id}` · `/profile/{id}` · `/columns-data/{id}` |
| `GET` | `/api/v1/eda/download/{id}?format=json\|pdf\|docx` |

!!! note
    Run EDA with **embeddings enabled** before using AI-label *propagation* — propagation needs
    the vectors in Qdrant to find similar rows.
