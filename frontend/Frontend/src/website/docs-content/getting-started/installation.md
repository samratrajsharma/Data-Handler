# Installation

Orchestraty runs as a small set of services via **Docker Compose**, with a FastAPI
backend and a React dashboard.

## Prerequisites

- **Docker Desktop** (Compose v2) — runs PostgreSQL, MinIO, Redis, and Qdrant.
- **Node.js 18+** — runs the dashboard / marketing dev server.
- **Windows PowerShell** — the `setup.ps1` / `stop.ps1` helpers are PowerShell scripts. (On macOS/Linux, run the equivalent `docker compose` + `npx vite` commands directly.)
- *(Optional)* **Ollama** — for fully local, offline LLMs. Install separately and pull a model (e.g. `ollama pull llama3`).

## Get the code

```bash
git clone https://github.com/your-username/orchestraty.git
cd orchestraty/ai-operating-system
```

## Configure

Copy the example environment file and adjust if needed (the defaults work out of the box for local Docker):

```bash
cp .env.example .env
```

See the [Configuration reference](../reference/configuration.md) for every variable.

## Run

```powershell
.\setup.ps1            # backend (:8000) + dashboard at http://localhost:5173
```

`setup.ps1` cleans stale ports, brings the Docker services up, waits for Postgres / Redis
/ MinIO / Qdrant / Celery to be healthy, runs database migrations, installs `node_modules`
on first run, then starts the dashboard dev server.

Other modes:

```powershell
.\setup.ps1 -Website   # backend + marketing site at http://localhost:5273
.\setup.ps1 -Fresh     # wipe ALL Docker volumes (DB / objects / queues / vectors) and start clean
.\stop.ps1             # stop the dev server + docker compose down (volumes preserved)
```

!!! tip "Local LLMs from inside Docker"
    If the API runs in Docker and Ollama runs on your host, point `OLLAMA_BASE_URL` at
    `http://host.docker.internal:11434`. Orchestraty also rewrites `localhost` →
    `host.docker.internal` automatically when it detects it's inside a container.

!!! info "pip install"
    A `pip install orchestraty` package is planned. For now, the Docker Compose +
    `setup.ps1` flow above is the supported install path.
