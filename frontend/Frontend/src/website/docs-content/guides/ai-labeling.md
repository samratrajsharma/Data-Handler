# AI labeling

A full labeling studio backed by any LLM (via LiteLLM), not just a single prompt box.

## AI Predict

Classify each row into your labels. You control:

- **Provider & model** — OpenAI, Anthropic, Groq, Ollama, or LM Studio.
- **Labels** and the **text column** to read.
- **Few-shot examples** — text → label pairs to boost accuracy.
- **Instructions** — plain-English guidance on how to decide.

**Preview on a sample** before running the full batch. Each result carries a label,
confidence, and the model's reasoning.

## Propagation

Spread a handful of high-confidence labels across similar rows using embedding similarity
(Qdrant kNN). Pick an aggressiveness preset — **Conservative** (threshold 0.85, 3 neighbors),
**Balanced** (0.7 / 5), **Aggressive** (0.55 / 7) — or set thresholds manually. *Requires EDA
embeddings.*

## Aggregation

Combine rule-based, AI, and propagated labels into one final label per row. Choose
**confidence-weighted** (recommended) or **majority vote**, and toggle which sources to include.

## Synthetic data

Generate realistic example texts for a label to balance a small or skewed class (5 / 20 / 50 /
100, or custom).

## Active learning

Surface the rows the model was **least confident** about — the highest-value candidates for
manual review.

## API

All under `/api/v1/labeling/ai/`: `predict`, `preview`, `predict-images`, `propagate`,
`aggregate`, `synthetic`, `active-learning`, plus `GET predictions/{id}`, `propagation/{id}`,
`aggregation/{id}`.
