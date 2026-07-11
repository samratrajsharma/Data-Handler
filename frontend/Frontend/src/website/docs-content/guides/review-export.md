# Review & export

Human-in-the-loop quality control, then a signed export.

## Quality evaluation

Run a quality pass over the labeled dataset (optionally against a set of expected labels) to
get coverage, confidence, and conflict metrics.

## Review actions

Work the review queue per item:

- **Approve** — accept the label.
- **Relabel** — assign a corrected label.
- **Reject** — drop it.

Every correction is recorded. The dataset advances through its **status lifecycle**:

```
raw → processed → labeled → reviewed → ready
```

so you always know what is shippable.

## Export

Export to **CSV, JSON, COCO, or YOLO**. Each export is stamped with the version, rule-set, and
model it came from (lineage), so any label is traceable to its source.

## API

| Method | Endpoint |
|--------|----------|
| `POST` | `/api/v1/review/quality/{id}` · `/actions` · `/export/{id}` |
| `GET` | `/api/v1/review/quality/{id}` · `/status/{id}` · `/export/{id}` |
| `PUT` | `/api/v1/review/dataset/{id}/status` |
