# Orchestraty

Enterprise AI Operating System — a unified platform for data ingestion, structuring, exploratory analysis, rule-based labeling, AI-powered labeling, image intelligence, review & quality control, workflow orchestration, and multi-LLM integration.

Built by Samrat.

---

## Quick Start

### Prerequisites

- Docker Desktop (running)
- PowerShell 5.1+ (Windows) or Bash (Linux/macOS)
- Python 3.11+ with `streamlit` installed (`pip install streamlit`)
- Ollama (optional, for local LLM features) with `gemma4:e4b` or `qwen3.5:9b`

### One-Command Setup

```powershell
# First time or full reset (builds images, wipes data, starts everything)
cd ai-operating-system
.\setup.ps1 -Fresh

# Daily start (no rebuild, just boots services + Streamlit)
.\start.ps1

# Stop everything
docker compose -f infrastructure/docker-compose.yml down
```

The setup script handles Docker Compose, waits for every service to be healthy, creates the initial superuser from `.env` credentials, and launches Streamlit — all in one command.

### Access Points

| Service              | URL                             |
|----------------------|---------------------------------|
| Orchestraty App      | http://localhost:8501            |
| API + Swagger Docs   | http://localhost:8000/docs       |
| MinIO Console        | http://localhost:9001            |
| Qdrant Dashboard     | http://localhost:6333/dashboard  |

Default admin: `admin@orchestraty.com` / `Admin@12345`

---

## Architecture

```
                     +---------------------+
                     |   Streamlit App     |
                     | (unified: user +    |
                     |  admin in one app)  |
                     +--------+------------+
                              |
                     +--------v------------+
                     |   FastAPI (8000)    |
                     |  12 route modules   |
                     +--+------+------+----+
                        |      |      |
         +--------------+      |      +---------------+
         |                     |                       |
+--------v--------+  +---------v--------+  +-----------v--------+
|  PostgreSQL     |  |  Redis           |  |  MinIO (S3)        |
|  (users, tasks, |  |  (cache, Celery  |  |  (files, images,   |
|   datasets,     |  |   broker)        |  |   thumbnails)      |
|   workflows)    |  +--------+---------+  +--------------------+
+---------+-------+           |
          |          +--------v---------+
          |          |  Celery Workers  |
          |          |  (structuring,   |
          |          |   EDA, labeling, |
          |          |   AI labeling,   |
          |          |   image pipeline,|
          |          |   workflows)     |
          |          +--------+---------+
          |                   |
          |          +--------v---------+     +------------------+
          +----------+  Qdrant          |     |  Ollama / LLM    |
                     |  (text + image   |     |  (gemma4, qwen3, |
                     |   vector store)  |     |   OpenAI, etc.)  |
                     +------------------+     +------------------+
```

### Services (Docker Compose)

| Container                | Purpose                                | Port      |
|--------------------------|----------------------------------------|-----------|
| orchestraty-api          | FastAPI backend                         | 8000      |
| orchestraty-postgres     | PostgreSQL 15 (persistent data)         | 5432      |
| orchestraty-redis        | Redis 7 (cache + Celery broker)         | 6379      |
| orchestraty-minio        | MinIO (S3-compatible file storage)      | 9000/9001 |
| orchestraty-qdrant       | Qdrant (vector DB for embeddings)       | 6333      |
| orchestraty-celery-worker| Celery worker (background pipelines)    | -         |

---

## Features

### Phase 1 — Data Foundation (Complete)

**Authentication & RBAC**
- JWT-based auth with four roles: `admin`, `reviewer`, `annotator`, `viewer`
- Role-gated endpoints via `RoleChecker` middleware
- Self-registration with auto-admin detection — registering with a bootstrap admin email automatically grants admin role
- Session persistence across Streamlit reruns

**Data Ingestion & Versioning**
- Upload CSV, TSV, JSON, JSONL files with automatic validation
- Schema detection (column types, nulls, unique counts)
- Immutable version history per dataset with schema hash tracking
- File storage in MinIO with organized path structure

**Audit Logging**
- Every write action logged with user, action type, resource, timestamp
- Queryable by user, action, resource type, and date range

### Phase 2 — Intelligence Pipeline (Complete)

**Data Structuring Agent**
- Schema inference with type detection (numeric, categorical, datetime, text, boolean)
- Automated cleaning: null handling (5 strategies), duplicate removal, outlier detection (IQR)
- Quality scoring on 5 dimensions (completeness, consistency, validity, uniqueness, accuracy)
- Letter-grade output (A-F) with actionable recommendations

**AI-Powered EDA**
- Statistical profiling: per-column stats, correlations, skewness/kurtosis, data warnings
- Embedding generation: sentence-transformers (GPU) with TF-IDF + SVD fallback
- Clustering analysis: K-Means with PCA dimensionality reduction and silhouette scoring
- Qdrant vector storage for semantic search

**Rule-Based Labeling Engine**
- 14 operators: `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `greater_than`, `less_than`, `greater_equal`, `less_equal`, `regex_match`, `in_list`, `is_null`, `is_not_null`
- 3 conflict resolution strategies: `first_match`, `highest_priority`, `all`
- Priority-based rule ordering with per-rule match statistics

**Background Task System**
- Celery-powered async pipelines with Redis broker
- Real-time progress tracking (percentage + status message)
- Race-condition-safe: task records committed before Celery dispatch
- Frontend auto-polls for results

### Phase 3 — Advanced AI & ML Operations (Complete)

**Multi-LLM Provider System**
- Supports Ollama (local), OpenAI, Anthropic, and Groq
- Hot-swappable providers — change models without code changes
- Default: `gemma4:e4b` via Ollama (also supports `qwen3.5:9b`)
- Connection testing and provider health checks from the UI
- API key management through environment variables

**Image Intelligence Pipeline**
- Batch image upload with validation (PNG, JPG, JPEG, WebP, TIFF, BMP)
- Automatic metadata extraction (dimensions, color mode, EXIF)
- Thumbnail generation and MinIO storage
- CLIP embedding generation (Intel XPU, CUDA, or CPU)
- Image clustering via HDBSCAN on CLIP vectors
- Text-to-image similarity search using Qdrant
- Visual gallery with cluster filtering

**Intelligent Labeling System**
- AI-powered label prediction using connected LLM providers
- Similarity-based label propagation via vector embeddings
- Label aggregation across multiple sources (rules, AI, manual)
- Confidence scoring and conflict resolution

**Review & Quality System**
- Dataset quality assessment with multi-dimensional scoring
- Review workflow API for human-in-the-loop validation
- Export pipeline for labeled datasets

**Workflow Orchestration**
- Multi-step pipeline engine: structuring → EDA → labeling → review → export
- Built-in workflow templates (Standard Data Pipeline, Quick Label Pipeline)
- Custom workflow creation with step-by-step execution
- Workflow status tracking, pause/resume controls
- Celery-based async execution with per-step progress

**Unified Streamlit App**
- Single app for all users — admin features appear as an extra nav section for admin-role users
- No separate admin app needed
- Role-based UI: viewers see pipeline tools, admins see user management, system health, audit trail
- LLM provider configuration page
- Image pipeline gallery with embedding and clustering controls

### Phase 4 — Enterprise Features (Planned)

- Active learning feedback loops
- Multi-tenant organization support
- Model training pipelines (AutoML + custom)
- Model registry and versioning
- One-click deployment with A/B testing
- Performance monitoring and drift detection
- API rate limiting and usage analytics

---

## Project Structure

```
ai-operating-system/
├── app.py                            # FastAPI entry point (12 routers, lifespan hooks)
├── setup.ps1                         # First-time setup (build + start + Streamlit)
├── start.ps1                         # Daily launcher (start + Streamlit)
├── manage.py                         # CLI admin commands
├── .env                              # Environment config (not in git)
├── requirements.txt                  # Python dependencies
│
├── core/                             # Shared platform core
│   ├── settings.py                   # Pydantic-settings config (reads .env)
│   ├── database.py                   # Async SQLAlchemy engine + session factory
│   ├── database_sync.py              # Sync session for Celery workers + CLI
│   ├── celery_app.py                 # Celery configuration
│   ├── storage.py                    # Centralized MinIO client factory
│   ├── paths.py                      # Centralized sys.path setup
│   ├── models/                       # ORM models
│   │   ├── user.py                   #   User (id, email, role, is_active)
│   │   ├── dataset.py                #   Dataset, DatasetVersion, DatasetMetadata
│   │   ├── background_task.py        #   BackgroundTask (celery tracking)
│   │   ├── audit_log.py              #   AuditLog (action trail)
│   │   ├── image_asset.py            #   ImageAsset (images, embeddings, clusters)
│   │   └── workflow.py               #   Workflow, WorkflowTemplate
│   ├── api/                          # Route modules (12 total)
│   │   ├── auth_routes.py            #   /api/v1/auth (register, login, me)
│   │   ├── admin_routes.py           #   /api/v1/admin (users, stats)
│   │   ├── task_routes.py            #   /api/v1/tasks (list, get, filter)
│   │   ├── audit_routes.py           #   /api/v1/audit (query logs)
│   │   ├── structuring_routes.py     #   /api/v1/structuring (run, results)
│   │   ├── eda_routes.py             #   /api/v1/eda (run, results, profile)
│   │   ├── labeling_routes.py        #   /api/v1/labeling (run, results, operators)
│   │   ├── ai_labeling_routes.py     #   /api/v1/ai-labeling (predict, propagate, aggregate)
│   │   ├── image_routes.py           #   /api/v1/images (upload, gallery, embed, cluster, search)
│   │   ├── review_routes.py          #   /api/v1/review (quality, reviews, export)
│   │   └── workflow_routes.py        #   /api/v1/workflows (create, list, templates)
│   ├── middleware/
│   │   └── rbac.py                   #   RoleChecker + require_admin/reviewer/annotator/viewer
│   └── services/
│       ├── auth_service.py           #   JWT create/verify, password hash, get_current_user
│       ├── audit_service.py          #   log_action()
│       └── task_service.py           #   create_task_record, update/complete task
│
├── data-intelligence-system/         # Processing modules
│   ├── ingestion/                    # File upload, validation, MinIO storage
│   │   ├── api/                      #   routes.py, schemas.py
│   │   ├── storage/                  #   minio_client.py
│   │   └── services/                 #   validation, versioning
│   ├── structuring/                  # Schema detection + cleaning + quality
│   │   ├── schema_detector.py
│   │   ├── cleaning_pipeline.py
│   │   └── quality_scorer.py
│   ├── eda/                          # Exploratory data analysis
│   │   ├── profiler.py
│   │   ├── embedder.py
│   │   └── clusterer.py
│   ├── labeling/                     # Rule-based + AI labeling
│   │   ├── rule_engine.py
│   │   ├── rule_store.py
│   │   ├── ai_labeler.py            #   LLM-powered label prediction
│   │   └── similarity_propagator.py  #   Vector-based label propagation
│   ├── image_pipeline/               # Image intelligence
│   │   ├── metadata_extractor.py     #   Image validation + EXIF extraction
│   │   ├── thumbnail_generator.py    #   Thumbnail creation
│   │   ├── clip_embedder.py          #   CLIP embeddings + Qdrant storage
│   │   └── image_clusterer.py        #   HDBSCAN clustering
│   ├── orchestration/                # Workflow engine
│   │   ├── workflow_engine.py        #   Step execution + state management
│   │   └── templates.py              #   Built-in pipeline templates
│   └── llm/                          # Multi-LLM provider system
│       └── llm_provider.py           #   Ollama, OpenAI, Anthropic, Groq
│
├── data_intelligence/                # Celery task definitions
│   └── tasks/
│       ├── structuring_tasks.py
│       ├── eda_tasks.py
│       ├── labeling_tasks.py
│       ├── ai_labeling_tasks.py
│       ├── image_tasks.py            #   CLIP embeddings + clustering
│       ├── review_tasks.py
│       └── workflow_tasks.py         #   Multi-step pipeline execution
│
├── frontend/
│   └── app.py                        #   Unified Streamlit app (user + admin)
│
└── infrastructure/
    ├── docker-compose.yml            #   6-service stack
    ├── Dockerfile                    #   Python 3.11 API image
    ├── k8s/                          #   Kubernetes manifests (planned)
    └── terraform/                    #   IaC templates (planned)
```

---

## API Endpoints

### Authentication (`/api/v1/auth`)

| Method | Endpoint   | Role   | Description                              |
|--------|-----------|--------|------------------------------------------|
| POST   | /register  | public | Create account (auto-admin if bootstrap) |
| POST   | /login     | public | Get JWT access token                     |
| GET    | /me        | any    | Current user profile                     |

### Datasets (`/api/v1/datasets`)

| Method | Endpoint            | Role      | Description              |
|--------|---------------------|-----------|--------------------------|
| POST   | /                   | annotator | Create dataset           |
| GET    | /                   | viewer    | List datasets            |
| GET    | /{id}               | viewer    | Get dataset + versions   |
| POST   | /{id}/upload        | annotator | Upload file version      |
| PUT    | /{id}/status        | reviewer  | Update dataset status    |
| PUT    | /{id}/metadata      | annotator | Upsert metadata          |
| DELETE | /{id}               | admin     | Delete dataset           |

### Structuring (`/api/v1/structuring`)

| Method | Endpoint      | Role      | Description               |
|--------|--------------|-----------|---------------------------|
| POST   | /run          | annotator | Start structuring pipeline|
| GET    | /results/{id} | viewer    | Get results for dataset   |

### EDA (`/api/v1/eda`)

| Method | Endpoint      | Role      | Description             |
|--------|--------------|-----------|-------------------------|
| POST   | /run          | annotator | Start EDA pipeline      |
| GET    | /results/{id} | viewer    | Get EDA results         |
| GET    | /profile/{id} | viewer    | Get column profiles     |

### Labeling (`/api/v1/labeling`)

| Method | Endpoint         | Role      | Description              |
|--------|------------------|-----------|--------------------------|
| POST   | /run              | annotator | Start labeling pipeline  |
| GET    | /results/{id}     | viewer    | Get labeling results     |
| GET    | /rules/operators  | viewer    | List supported operators |

### AI Labeling (`/api/v1/ai-labeling`)

| Method | Endpoint       | Role      | Description                    |
|--------|---------------|-----------|--------------------------------|
| POST   | /predict       | annotator | AI-powered label prediction    |
| POST   | /propagate     | annotator | Similarity-based propagation   |
| POST   | /aggregate     | annotator | Aggregate labels from sources  |

### Images (`/api/v1/images`)

| Method | Endpoint               | Role   | Description                      |
|--------|------------------------|--------|----------------------------------|
| POST   | /{id}/upload           | viewer | Upload single image              |
| POST   | /{id}/upload-batch     | viewer | Batch upload images              |
| GET    | /{id}/gallery          | viewer | Paginated gallery + thumbnails   |
| GET    | /{id}/{asset_id}       | viewer | Single image metadata            |
| POST   | /{id}/embeddings       | viewer | Trigger CLIP embedding generation|
| POST   | /{id}/cluster          | viewer | Trigger HDBSCAN clustering       |
| GET    | /{id}/clusters         | viewer | Get cluster results              |
| POST   | /{id}/search           | viewer | Text-to-image similarity search  |

### Review & Quality (`/api/v1/review`)

| Method | Endpoint          | Role     | Description                |
|--------|-------------------|----------|----------------------------|
| POST   | /quality          | reviewer | Run quality assessment     |
| POST   | /reviews          | reviewer | Create review              |
| POST   | /export           | reviewer | Export labeled dataset     |

### Workflows (`/api/v1/workflows`)

| Method | Endpoint      | Role      | Description               |
|--------|--------------|-----------|---------------------------|
| POST   | /             | annotator | Create and start workflow  |
| GET    | /             | viewer    | List user's workflows      |
| GET    | /templates    | viewer    | List workflow templates    |
| GET    | /{id}         | viewer    | Get workflow details       |

### Admin (`/api/v1/admin`)

| Method | Endpoint           | Role  | Description              |
|--------|--------------------|-------|--------------------------|
| GET    | /users             | admin | List all users           |
| PUT    | /users/{id}/role   | admin | Change user role         |
| PUT    | /users/{id}/status | admin | Activate/deactivate user |
| DELETE | /users/{id}        | admin | Delete user              |
| GET    | /stats             | admin | System-wide statistics   |

### Tasks & Audit

| Method | Endpoint           | Role   | Description                        |
|--------|-------------------|--------|------------------------------------|
| GET    | /api/v1/tasks/     | viewer | List tasks (filter by type/status) |
| GET    | /api/v1/tasks/{id} | viewer | Get single task                    |
| GET    | /api/v1/audit/     | admin  | Query audit logs                   |

---

## Configuration

All configuration is via environment variables (`.env` file).

Key settings:

| Variable                    | Default                    | Description                   |
|-----------------------------|----------------------------|-------------------------------|
| DATABASE_URL                | postgresql+asyncpg://...   | PostgreSQL connection string  |
| MINIO_ENDPOINT              | minio:9000                 | MinIO server address          |
| REDIS_URL                   | redis://redis:6379/0       | Redis connection              |
| SECRET_KEY                  | (change in production)     | JWT signing key               |
| ACCESS_TOKEN_EXPIRE_MINUTES | 60                         | Token lifetime                |
| QDRANT_HOST                 | qdrant                     | Vector DB host                |
| EMBEDDING_MODEL             | all-MiniLM-L6-v2           | Sentence-transformers model   |
| CLIP_MODEL_NAME             | openai/clip-vit-base-patch32 | CLIP model for images       |
| DEFAULT_LLM_PROVIDER        | ollama                     | LLM provider (ollama/openai/anthropic/groq) |
| DEFAULT_LLM_MODEL           | gemma4:e4b                 | Default LLM model             |
| ADMIN_EMAIL                 | admin@orchestraty.com      | Initial superuser email       |
| ADMIN_PASSWORD              | Admin@12345                | Initial superuser password    |
| ADMIN_EMAILS                | admin@orchestraty.com      | Bootstrap admin emails (comma-separated) |

---

## CLI Management

```powershell
docker exec -it orchestraty-api python manage.py list-users
docker exec -it orchestraty-api python manage.py promote-admin user@example.com
docker exec -it orchestraty-api python manage.py set-role user@example.com reviewer
docker exec -it orchestraty-api python manage.py deactivate-user user@example.com
docker exec -it orchestraty-api python manage.py reset-password user@example.com
docker exec -it orchestraty-api python manage.py create-superuser
```

---

## Useful Commands

```powershell
# Daily start
.\start.ps1

# First-time setup / full rebuild
.\setup.ps1

# Full reset (wipes all databases, storage, and cache)
.\setup.ps1 -Fresh

# View API logs
docker compose -f infrastructure/docker-compose.yml logs -f api

# View Celery worker logs
docker compose -f infrastructure/docker-compose.yml logs -f celery-worker

# Stop all services
docker compose -f infrastructure/docker-compose.yml down

# Rebuild just the API after code changes
docker compose -f infrastructure/docker-compose.yml up -d --build api celery-worker
```

---

## License

Proprietary — All rights reserved. Thoughtrons.
