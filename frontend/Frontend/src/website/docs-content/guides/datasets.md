# Datasets (ingest)

The entry point. Create a dataset, upload a file, and Orchestraty seals it as an immutable
**version 1** — raw bytes in MinIO, metadata in PostgreSQL — and shows a live preview.

## Source types

`csv`, `json` / `jsonl`, `parquet`, `tsv`, `txt`, and **image folders**. The dashboard infers
the type from the file extension; you can also set it explicitly when creating the dataset.

A flexible decoder handles the messy CSVs that spreadsheet exports produce (CP-1252 / UTF-16,
odd delimiters), so uploads "just work".

## What you get

- An immutable **v1** you can always trace back to.
- A row + column **preview** with per-column types and value statistics (min / max / mean for
  numerics, distinct values for categoricals).
- A full **version history** as the dataset moves through the pipeline.

## API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/v1/datasets` | List datasets |
| `POST` | `/api/v1/datasets` | Create a dataset |
| `POST` | `/api/v1/datasets/{id}/upload` | Upload a file (multipart) → seals a version |
| `GET` | `/api/v1/datasets/{id}/versions` | Version history |
| `GET` | `/api/v1/datasets/{id}/preview` | Row/column preview |
| `GET` | `/api/v1/datasets/{id}/columns` · `/column-types` · `/column-values` | Column introspection |
| `DELETE` | `/api/v1/datasets/{id}` | Delete a dataset |

!!! tip
    Nothing leaves your machine on ingest — bytes go to your local MinIO, metadata to your
    local Postgres.
