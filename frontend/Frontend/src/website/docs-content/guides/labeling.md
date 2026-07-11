# Rule-based labeling

Label rows deterministically with compound conditions, with a live, conflict-aware preview.

## What you control

- **Conditions** — `column` `operator` `value`, where operator is one of
  `=  ≠  >  <  ≥  ≤  in  between  contains`.
- **Compound logic** — combine conditions with `AND` / `OR`.
- **Priority** — order rules so the right one wins.
- **Conflict strategy** — e.g. *first match* when multiple rules fire.
- **Quick templates** — sentiment, category-by-keyword, null detection, compound examples.

## Live preview

Before committing, the preview reports how many rows are **labeled vs unlabeled**, the
**label distribution**, per-rule match counts, **conflicts**, and warnings — computed on a
sample so it's instant.

## Saved rule sets

Save a set of rules as a reusable, named **rule set** (full CRUD). Load it onto another dataset
later, or feed it into a workflow.

## API

| Method | Endpoint |
|--------|----------|
| `POST` | `/api/v1/labeling/run` |
| `POST` | `/api/v1/labeling/preview-rules` |
| `GET` | `/api/v1/labeling/rules/operators` |
| `GET` | `/api/v1/labeling/results/{id}` · `/download/{id}` |
| `GET/POST/PUT/DELETE` | `/api/v1/labeling/rule-sets[/{id}]` |
