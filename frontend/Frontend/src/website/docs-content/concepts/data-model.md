# Data model & versioning

## Datasets and versions

A **Dataset** is a named data asset with a `source_type` (`csv`, `json`, `image`, …) and a
`status` that advances through a lifecycle:

```
raw → processed → labeled → reviewed → ready
```

Every operation that changes the data writes a new **DatasetVersion** rather than mutating the
previous one. A version records its storage path (in MinIO), row count, file metadata, a schema
hash, and a link to its parent version. This makes the whole pipeline reproducible — you can
always trace a result back to the exact bytes it came from.

## Other core records

| Record | Purpose |
|--------|---------|
| **DatasetMetadata** | Arbitrary key/value metadata attached to a dataset. |
| **BackgroundTask** | Tracks a Celery job — type, status, progress, parameters, result. |
| **LLMConfigRecord** | A saved provider configuration (provider, model, base URL, temperature, max tokens, default flag). Workspace-global. |
| **ImageAsset** | One image in an image dataset — EXIF, thumbnail, embedding, cluster id. |
| **Workflow / WorkflowTemplate** | A multi-step pipeline definition (a DAG of steps) and reusable templates. |

## Storage split

- **PostgreSQL** holds metadata and structured records (the tables above).
- **MinIO** holds the actual dataset bytes, versioned.
- **Qdrant** holds the vectors (text + image embeddings).

Nothing leaves your machine unless you explicitly call a hosted LLM provider.
