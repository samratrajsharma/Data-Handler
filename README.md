<div align="center">

# Data Handler

**A self-hosted, single-user platform for turning raw data into clean, labelled, training-ready datasets — tabular, image, and text, in one place.**

![License](https://img.shields.io/badge/license-MIT-black)
![Self-hosted](https://img.shields.io/badge/self--hosted-Docker-black)
![API](https://img.shields.io/badge/API-FastAPI-black)
![UI](https://img.shields.io/badge/UI-React%2019-black)

</div>

---

Data Handler runs entirely on your own machine. It needs no accounts and no sign-in, ships with a minimal light/dark interface, and starts with a single command. It takes a raw file all the way from ingestion, through cleaning and exploration, to rule-based and AI-assisted labelling, human review, and export — running every long operation as a tracked background job so the UI never blocks.

It handles three kinds of data through one consistent pipeline:

> **Data in → Prepare → Label → Review → Export**

The sidebar is organised by data type (**Tabular · Image · Text**); pick a mode and you only see that type's tools.

> **Project status:** early and actively developed — single-user and pre-1.0 today. A lighter one-command personal install and an optional team mode are on the [roadmap](#roadmap), and the project is [open to contributors](#contributing).

## Features

### Datasets & ingestion

- Create datasets of type **CSV, JSON, image, or text**; each upload is stored as an immutable, versioned artifact.
- Robust tabular loading: automatic detection of **encoding** (UTF-8/16, cp1252…), **delimiter** (`, ; \t |`), and junk prelude rows above the real header.
- Live previews (thumbnails for images, rows for tables) and cheap column/type/value endpoints that power the rest of the app.

### Tabular

- **Structuring** — schema/type detection, then configurable cleaning: null handling (mode/mean/median/fill/drop), duplicate removal, IQR outlier removal, `snake_case` column standardization, case normalization, and one-hot / label encoding. Produces a cleaned file plus an **A–F quality score** across completeness, uniqueness, consistency, and validity.
- **EDA** — per-column profiling, Pearson correlations, text embeddings (`all-MiniLM-L6-v2`), and `KMeans` clustering with a silhouette score; interactive charts and JSON/PDF/DOCX export.
- **Rule-based labeling** — assign labels with boolean rules over 15 operators (`equals`, `contains`, `regex_match`, `between`, `in_list`, …), AND/OR logic, priorities, conflict strategies, and a dry-run preview.
- **AI labeling** — classify rows with an LLM using your labels, plain-English instructions, and few-shot examples; preview on a few rows before the full run. Bring your own provider (OpenAI, Anthropic, Groq, local Ollama, or any OpenAI-compatible endpoint).

### Image

- **CLIP pipeline** — CLIP `ViT-B/32` embeddings (512-dim) and HDBSCAN clustering to explore and group images before labelling.
- **Annotation editor** — draw **bounding boxes and polygons** on a pan/zoom canvas with normalized geometry, class colours and keyboard shortcuts, undo/redo, and auto-save. Assign **train/valid/test** splits and export to **YOLO, COCO, Pascal VOC, or folder-classification**.

### Text

- **Document classes and character-level spans** — label whole documents and exact character ranges (with correct Unicode offset handling). Split uploaded `.txt` files by file, blank line, or line. Export to **JSONL, CSV, or spaCy-style spans**.

### Review & platform

- **Review & Export** — a quality evaluation (coverage, balance, confidence, consistency, completeness → A–F grade), approve/reject/relabel actions, and dataset export.
- **Background jobs** — every heavy operation runs as a tracked job with live progress on a Tasks page.
- **Self-hosted & single-user** — no external services required; all data stays local.

## Architecture

One command builds and starts the whole stack in Docker. The browser talks only to nginx; everything else is internal.

```
Browser (React SPA, nginx :3000)
        │  /api  (reverse-proxied)
        ▼
FastAPI (:8000) ──queue──► Celery worker
        │                      │
        ▼                      ▼
   PostgreSQL   MinIO (S3)   Qdrant   Redis        LLM providers (optional)
   metadata,    files &      vectors  job queue    OpenAI · Anthropic ·
   annotations, exports                            Groq · Ollama
   job results
```

| Layer | Technology |
| --- | --- |
| Frontend | React 19 · Vite · TypeScript · nginx |
| API | FastAPI (async) · SQLAlchemy · Alembic |
| Jobs | Celery · Redis |
| Database | PostgreSQL 15 |
| Object storage | MinIO (S3-compatible) |
| Vectors | Qdrant |
| Vision / LLM | CLIP `ViT-B/32` · litellm |

## Quick start

### Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose (Docker Desktop on Windows/macOS).

### Run

**Windows:** double-click **`run.cmd`**, or from a terminal:

```
run.cmd
```

Flags pass straight through — `run.cmd -Build`, `run.cmd -Fresh -Llm`.

> **Why `run.cmd` and not `run.ps1`?** Windows marks files extracted from a
> downloaded ZIP as untrusted, and PowerShell refuses to run an untrusted
> `.ps1` ("*is not digitally signed*"). `run.cmd` is a three-line wrapper that
> isn't subject to that policy — it starts `run.ps1` with the policy bypassed
> for that one process, changing nothing about your machine. `.\run.ps1` still
> works if you cloned with git rather than downloading the ZIP.

**macOS / Linux:**

```bash
./run.sh
```

The first run **downloads** the prebuilt images — roughly 800 MB, a few minutes on a normal connection — then starts everything and opens the app. Later runs reuse what's on disk and start in seconds. (`-Build` / `--build` is the build-from-source path; you only need it after changing code.) Once it's up:

| Service | URL |
| --- | --- |
| App | http://localhost:3000 |
| API docs (Swagger) | http://localhost:8000/docs |
| MinIO console | http://localhost:9001 |
| Qdrant dashboard | http://localhost:6333/dashboard |

> **Prebuilt images:** once a release tag is published, `run.ps1` / `run.sh` **pull** the prebuilt backend + frontend images from GHCR instead of building locally, so a fresh install is a quick download rather than a long build. Pass `-Build` / `--build` only when you've changed the code and want to rebuild.

### Command flags

Combine freely (e.g. `.\run.ps1 -Fresh -Llm`):

| PowerShell | Bash | Effect |
| --- | --- | --- |
| `-Build` | `--build` | Rebuild the images (use after changing code) |
| `-Dev` | `--dev` | Live code reload — for contributors editing Python (see [Development](#development)) |
| `-Fresh` | `--fresh` | Wipe all data volumes first, then rebuild (clean slate) |
| `-Llm` | `--llm` | Also start the bundled Ollama container (local LLM) |
| `-Stop` | `--stop` | Stop the stack (data volumes preserved) |
| `-NoBrowser` | `--no-browser` | Start without auto-opening the browser |
| `-Logs` | `--logs` | Follow the API + worker logs after starting |

## Usage

1. **Create a dataset** on the Datasets page and upload a file (CSV/JSON, images, or `.txt`).
2. **Pick a mode** (Tabular / Image / Text) — the sidebar shows only that type's tools.
3. **Prepare** — clean and profile tabular data, or embed and cluster images.
4. **Label** — write rules, run an LLM, draw boxes, or mark text spans.
5. **Review & Export** — check quality, then export (YOLO / COCO / VOC / JSONL / CSV).

To use AI labelling, add a provider under **Settings** (or start Ollama with the `-Llm` flag).

## Configuration

Configuration is read from a `.env` file (created automatically from `.env.example` on first run). Key variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection | `…@postgres:5432/datahandler` |
| `MINIO_ENDPOINT` / `MINIO_PUBLIC_ENDPOINT` | Object storage (internal / browser-reachable) | `minio:9000` / `localhost:9000` |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Object storage credentials | `minioadmin` |
| `REDIS_URL` / `CELERY_BROKER_URL` | Cache and job queue | `redis://redis:6379/…` |
| `QDRANT_HOST` / `QDRANT_PORT` | Vector database | `qdrant` / `6333` |
| `EMBEDDING_MODEL` | Text embedding model | `all-MiniLM-L6-v2` |
| `CLIP_MODEL_NAME` | Image embedding model | `openai/clip-vit-base-patch32` |
| `OLLAMA_BASE_URL` | Local LLM endpoint | `http://host.docker.internal:11434` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GROQ_API_KEY` | Hosted LLM keys | *(empty)* |
| `DEFAULT_LLM_PROVIDER` / `DEFAULT_LLM_MODEL` | Default provider/model | `ollama` / `llama3` |

The bundled defaults are meant for local use. If you expose any service beyond `localhost`, change the default MinIO and PostgreSQL credentials first.

## Project structure

```
Data Handler/
├── app.py                     # FastAPI entry point
├── core/                      # API routes, models, services, storage, LLM
├── data-intelligence-system/  # Domain logic (ingestion, structuring, eda, labeling, image_pipeline, quality)
├── data_intelligence/         # Celery task modules
├── frontend/                  # React + Vite SPA (served by nginx)
├── infrastructure/            # Dockerfile & docker-compose.yml
├── alembic/                   # Database migrations
├── tests/                     # Test suite
├── run.ps1 / run.sh           # One-command launchers
└── requirements.txt
```

## Development

The full stack runs in Docker via `run.ps1` / `run.sh`.

By default the containers run the code **baked into the image**, so what you pulled is exactly what executes. For live reload while editing Python, pass `-Dev` / `--dev`:

```powershell
.\run.ps1 -Dev          # Windows
```
```bash
./run.sh --dev          # macOS / Linux
```

That layers `infrastructure/docker-compose.dev.yml` on top, which mounts this repo over `/app` and runs uvicorn with `--reload`.

Two things to know about dev mode:

- **It is noticeably slower to start**, especially on Docker Desktop for Windows/macOS. Every import crosses the host↔VM filesystem bridge, and the mount masks the image's precompiled bytecode. On Windows, keeping the repo inside the WSL2 filesystem rather than under `C:\Users\...` avoids the bridge and is much faster.
- **The Celery worker still does not auto-reload.** After changing task code:
  ```bash
  docker compose -f infrastructure/docker-compose.yml -f infrastructure/docker-compose.dev.yml restart celery-worker
  ```

- **Backend tests:** `pytest`
- **Frontend:** `cd frontend/Frontend && npm install && npm run dev`

## Roadmap

Data Handler is early and moving quickly. Here's where it's headed — priorities may shift, and feedback is welcome.

**Available now**

- Full Docker stack: tabular, image, and text pipelines end to end, with background jobs and local-only storage, for a single user.
- Prebuilt backend and frontend images published to GHCR on each release tag, so a fresh install downloads images instead of building them locally.

**Next**

- **Lite mode for personal use** — a much lighter install built on **SQLite** and the local filesystem, with no Docker and no PostgreSQL / MinIO / Qdrant / Redis to run. Aimed at individuals who want the fastest possible personal setup; the Docker stack stays the path for the full feature set.
- **Faster cold starts** — models still download on first use; caching them better is the next win.

**Later / exploring**

- **Team mode** — optional accounts and roles on the Docker version, for small groups who want to label together.
- **Active learning and label-error detection** — surface the rows most worth labelling next, and flag likely mislabels.
- **More exporters and integrations**, driven by what people actually need.

The two-tier intent is simple: the **Docker** version for the full, collaboration-ready system, and a lightweight **SQLite "lite"** version for quick personal use.

## Contributing

Contributions, bug reports, and ideas are all welcome — this is an open project and collaborators are encouraged.

- **Found a bug or have an idea?** [Open an issue](https://github.com/samratrajsharma/Data-Handler/issues) describing what you saw or what you'd like to see.
- **Want to build something?** Fork the repo, make your change on a branch, and open a pull request. For anything large, open an issue first so we can talk through the approach.
- **Good places to start:** documentation, new import/export formats, additional cleaning and labeling rules, and UI polish.

Local development setup is in [Development](#development) above (`pytest` for the backend, `npm run dev` for the frontend). Please keep pull requests focused, and describe the change and how you tested it. By contributing, you agree your contributions are licensed under the project's MIT License.

If Data Handler is useful to you, a star on the repo helps others find it.

### Releasing (maintainers)

Publishing a version tag builds and pushes the prebuilt images so users install by download instead of build:

```bash
# 1. Bump the version in the SAME commit you are about to tag. Three files,
#    and they must agree — the app reads VERSION to report its own build:
#      VERSION                                  -> 0.1.7   (no leading "v")
#      frontend/Frontend/package.json           -> 0.1.7
#      frontend/Frontend/package-lock.json      -> 0.1.7   (both fields)
#    npm ci refuses to run if the last two disagree, so a half-done bump
#    fails the frontend image build rather than shipping quietly.

# 2. The commit must be ON THE REMOTE FIRST. A tag names a commit; tagging
#    before pushing publishes whatever origin/main already pointed at, and the
#    build silently ships the previous release's code under a new version.
git push origin main
git log --oneline -1 origin/main     # confirm this is the commit you mean

# 3. Then tag that commit and push the tag.
git tag v0.1.7
git push origin v0.1.7
```

The tag carries the `v`; `VERSION` does not. CI passes the tag to the image as
`APP_VERSION`, which takes precedence over `VERSION` at runtime, so
`/api/v1/version` returns `v0.1.7` from a released image and `0.1.7` from a
local `-Build` of the same source. The sidebar strips any leading `v` before
rendering, so both display as **v0.1.7** — the difference is only visible in
the raw endpoint.

Check `git tag --list` first — reusing a version that already exists is refused
by the remote, and a tag pointing at the wrong commit has to be deleted on both
sides (`git tag -d`, `git push origin :refs/tags/vX.Y.Z`) before it can be
moved.

This triggers the **Build & publish images** workflow, which pushes `data-handler-api` (~406 MB download) and `data-handler-frontend` (~94 MB) to GHCR, each tagged `latest`, the version tag, and a short SHA.

The first time, set both packages to **Public** (repo → Packages → each package → Package settings → Change visibility) so anyone can pull without authenticating.

## License

Released under the [MIT License](LICENSE).
