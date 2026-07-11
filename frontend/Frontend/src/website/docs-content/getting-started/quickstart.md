# Quickstart

This walks the "Teen" sample dataset from upload to an exported, labeled file in a few minutes.

## 1. Create a dataset and upload a file

Open the dashboard (`http://localhost:5173`), go to **Datasets → New Dataset**, give it a
name, and drop in a CSV, JSON/JSONL, Parquet, or a folder of images. Orchestraty seals the
upload as an immutable **version 1** and shows a live row/column preview.

## 2. Structure it

Go to **Structuring**. Orchestraty profiles every column and *recommends* cleanup actions
(fill nulls, encode categoricals, fix casing, drop columns). Apply the recommendations or
override them, then **Run** — the result is written as a new sealed version. The raw upload
is never mutated.

## 3. Explore

Go to **EDA**, tick *Profiling*, *Embeddings*, and *Clustering*, set the cluster count, and
**Run EDA**. Browse the column stats, correlation matrix, distributions, and charts; embeddings
land in Qdrant for later search and propagation. You can download the report as JSON / PDF / DOCX.

## 4. Label

- **Rule-based labeling** — build IF / AND / OR conditions, preview how many rows each rule
  touches (and where they conflict), then run.
- **AI labeling** — pick a provider/model, add labels, optionally a few examples and
  instructions, preview on a sample, then run the batch. You can also propagate labels over
  embeddings, aggregate multiple sources, generate synthetic data, and surface uncertain rows.

## 5. Review & export

Go to **Review & Export** — run a quality evaluation, work the review queue (approve / relabel
/ reject), advance the dataset status, then export to CSV / JSON / COCO with lineage attached.

## 6. Save it as a workflow (optional)

Go to **Workflows** to chain those steps into a reusable pipeline you can re-run on tomorrow's
data.

Next: dig into any stage via the [pipeline guides](../guides/datasets.md).
