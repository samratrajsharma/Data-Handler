# Orchestraty

**Orchestraty is an open-source, single-user, local-first data operating system.**
It takes a raw file all the way to a labeled, reviewed, exportable dataset — ingest,
structure, explore, label (by rules *and* by AI), search images, review, orchestrate,
and export with full lineage — and it runs entirely on your own machine.

- **Local-first.** PostgreSQL, MinIO, Redis, and Qdrant all run on your box via Docker Compose. No cloud, no accounts, no telemetry.
- **Bring your own model.** OpenAI, Anthropic, Groq, or fully local Ollama / LM Studio — routed through one LiteLLM layer.
- **Lineage throughout.** Immutable dataset versions, recorded reviews, and signed exports — trace any label back to its source.
- **Open source.** MIT licensed, free forever.

## The pipeline

```
Datasets → Structuring → EDA → Labeling (rules) → AI Labeling → Images
        → Review & Export → Workflows        (+ LLM Config · Tasks)
```

Each stage is a page in the dashboard and a set of `/api/v1/*` endpoints. You can use
the whole pipeline or just the stages you need.

## Where to go next

- New here? Start with [Installation](getting-started/installation.md) and the [Quickstart](getting-started/quickstart.md).
- Want the big picture? Read [Architecture](concepts/architecture.md) and the [Data model](concepts/data-model.md).
- Looking for a specific feature? Jump into the [pipeline guides](guides/datasets.md).

!!! note "Status"
    Orchestraty is at **Phase 3** — ingest, structure, EDA, rule + AI labeling, the image
    pipeline, review/export, and workflows are all shipped and run locally. See the
    [Roadmap](roadmap.md) for what's next (Phase 3.5: Roboflow-level image annotation and
    free-form text labelling).
