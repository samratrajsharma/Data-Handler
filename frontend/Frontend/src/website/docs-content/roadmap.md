# Roadmap

Orchestraty ships in usable phases.

## Phase 1 — Ingestion + Structuring *(shipped)*
CSV / JSON / Parquet upload, schema inference, null handling, quality scoring, versioned MinIO
storage.

## Phase 2 — EDA + Rule labeling *(shipped)*
Statistical profiling, distribution plots, downloadable reports, and a compound rule editor
with AND / OR / ranges.

## Phase 3 — AI labeling, Vision & Local-first *(current)*
Multi-provider LLM labels, similarity propagation, synthetic data, and CLIP image search — plus
the single-user pivot: pip-installable direction, runs entirely on your machine, no accounts.

## Phase 3.5 — Image & free-text labelling *(next)*
- **Roboflow-level image annotation** — bounding boxes, polygons, and class labels on top of
  the existing CLIP pipeline.
- **Free-form text labelling** — label and structure whole paragraphs of text, not just
  spreadsheet cells. This is the differentiator: tabular labelling is the easy case; rich image
  and document labelling is where Orchestraty is headed.
