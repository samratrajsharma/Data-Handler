# Deployment

Orchestraty is designed to run **on your own machine**, but the same Docker Compose stack runs
on any box with Docker — a workstation, a homelab server, or a cloud VM.

## On a server

1. Install Docker (with Compose v2).
2. Clone the repo and copy `.env.example` to `.env`; set strong `MINIO_*` credentials and a
   real `DATABASE_URL` password for anything beyond local use.
3. `docker compose -f infrastructure/docker-compose.yml up -d` and run migrations.
4. Build and serve the dashboard (`npm run build`) behind your web server of choice.

## Important: there is no authentication

Orchestraty is single-user by design — **whoever can reach the port has full access.** If you
expose it beyond `localhost`:

- Put it behind a VPN, SSH tunnel, or an authenticating reverse proxy.
- Never expose the raw ports (`8000`, `5173`, MinIO, Postgres) to the public internet.

## Data & volumes

Postgres, MinIO, Redis, and Qdrant persist to Docker volumes. Back those up to preserve your
datasets, versions, and embeddings. `setup.ps1 -Fresh` deletes them — use with care.
