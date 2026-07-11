# Structuring

Clean and normalize a dataset into a new sealed version. Structuring **profiles every column
and recommends** the cleanup actions — you approve or override.

## What you control

- **Null handling** — `fill_mode`, `fill_mean`, `fill_median`, `fill_empty`, or `drop_rows`.
- **Remove duplicates** — drop exact duplicate rows.
- **Handle outliers** — IQR-based outlier removal.
- **Case normalization** — `none` / `lower` / `upper` / `title`.
- **Standardize column names** — trim + snake_case.
- **Encoding** — one-hot or label encoding for categorical columns.
- **Drop columns** — remove columns you don't need.

## The recommendation engine

For each column, Orchestraty reports its dtype, distinct count, and null ratio, then suggests
concrete actions ("Encode as one-hot (3 categories)", "Looks clean", "Fill nulls with median").
You can **Apply all** or click individual suggestions.

## What you get

- A **new cleaned version** (the raw one is never touched).
- A **before / after** preview and a per-column quality score (e.g. *99 · Grade A*).
- A cleaning pipeline log: what was encoded, deduped, filled, normalized.

## API

| Method | Endpoint |
|--------|----------|
| `POST` | `/api/v1/structuring/run` |
| `GET` | `/api/v1/structuring/recommendations/{id}` |
| `GET` | `/api/v1/structuring/results/{id}` |
| `GET` | `/api/v1/structuring/cleaned-preview/{id}` |
| `GET` | `/api/v1/structuring/download/{id}` |
