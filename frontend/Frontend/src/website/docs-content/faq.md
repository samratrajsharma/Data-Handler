# FAQ

**Where does my data go?**
On your computer. Datasets land in a local MinIO bucket, metadata in local Postgres, vectors
in local Qdrant. Nothing leaves the box unless you explicitly call a hosted LLM provider. No
telemetry, no analytics.

**Which LLM providers are supported?**
OpenAI, Anthropic, Groq, Ollama, and anything OpenAI-compatible (LM Studio, vLLM, LiteLLM
proxies). You bring the key, pick the model per task, and see which model produced each label.

**Do I need Docker?**
Yes, for now — Postgres / Redis / MinIO / Qdrant come up via Docker Compose. A lighter embedded
mode may come later.

**Is it really free?**
Yes — MIT licensed, no paid tier.

**Can I run it on a remote server, not just my laptop?**
Yes. See [Deployment](deployment.md) — but mind the "no authentication" note.

**Why no accounts / login?**
Orchestraty is a tool, not a service. A login implies a backend storing credentials, which
implies a cloud, which implies someone touches your data. Single-user and local-first avoids
all of that.

**How is it different from MLflow / Label Studio / Weights & Biases?**
Those each focus on one slice. Orchestraty is opinionated end-to-end — ingest → structure →
EDA → label → review → export — with one data model the whole way, local-first, and
bring-your-own-LLM.
