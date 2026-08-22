#!/usr/bin/env bash
# Data Handler - single-command launcher (Linux / macOS).
#
# Starts the ENTIRE stack in Docker with one command:
# frontend (nginx) + API + Celery worker + Postgres + Redis + MinIO + Qdrant.
#
# By default it does NOT rebuild — the first run builds the images, later runs
# just start them (fast). Pass --build after changing code, or --fresh for a
# clean slate.
#
# Flags (combine freely, e.g.  ./run.sh --build --llm):
#   ./run.sh                Start everything (builds only if images are missing), open the app.
#   ./run.sh --build        Rebuild the images first (use after changing code).
#   ./run.sh --fresh        Wipe ALL data volumes, rebuild, and start (clean slate).
#   ./run.sh --llm          Also start the bundled Ollama container (local LLM).
#   ./run.sh --stop         Stop the stack (data volumes preserved).
#   ./run.sh --no-browser   Start, but don't auto-open the browser.
#   ./run.sh --logs         After starting, follow the API + worker logs.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="infrastructure/docker-compose.yml"
APP_URL="http://localhost:3000"
PROFILE=()
FRESH=0; BUILD=0; STOP=0; NOBROWSER=0; LOGS=0

for arg in "$@"; do
  case "$arg" in
    --fresh)      FRESH=1 ;;
    --build)      BUILD=1 ;;
    --llm)        PROFILE=(--profile llm) ;;
    --stop)       STOP=1 ;;
    --no-browser) NOBROWSER=1 ;;
    --logs)       LOGS=1 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

echo ""
echo "  DATA HANDLER"
echo "  ------------"

if [ "$STOP" -eq 1 ]; then
  echo "Stopping the stack (data volumes preserved)..."
  docker compose -f "$COMPOSE" "${PROFILE[@]}" down
  echo "Stopped."
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker and try again." >&2
  exit 1
fi

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example."
  else
    echo "No .env / .env.example - continuing with compose defaults."
  fi
fi

if [ "$FRESH" -eq 1 ]; then
  echo "FRESH: removing all containers and data volumes..."
  docker compose -f "$COMPOSE" "${PROFILE[@]}" down -v
fi

# By default just start (the first run builds any missing images); --build /
# --fresh force a rebuild so code changes are baked in.
BUILD_ARGS=()
if [ "$BUILD" -eq 1 ] || [ "$FRESH" -eq 1 ]; then
  BUILD_ARGS=(--build); echo "Rebuilding images and starting all services..."
else
  # Fast path: pull prebuilt images from GHCR if published; anything not
  # published falls back to building on the 'up' below.
  echo "Pulling prebuilt images (builds any that aren't published yet)..."
  docker compose -f "$COMPOSE" "${PROFILE[@]}" pull --ignore-pull-failures 2>/dev/null || true
fi
docker compose -f "$COMPOSE" "${PROFILE[@]}" up -d "${BUILD_ARGS[@]}" --remove-orphans

echo "Waiting for the API..."
ready=0
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:8000/health" 2>/dev/null | grep -q healthy; then ready=1; break; fi
  sleep 2
  [ $((i % 5)) -eq 0 ] && echo "  still starting... ($i/60)"
done
[ "$ready" -eq 1 ] && echo "API is healthy." || echo "API timed out - check: docker compose -f $COMPOSE logs -f api"

echo "Waiting for the frontend..."
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "$APP_URL" 2>/dev/null; then break; fi
  sleep 2
done

echo ""
echo "  Stack is up."
echo "  App (UI) ......... $APP_URL"
echo "  API + Swagger .... http://localhost:8000/docs"
echo "  MinIO console .... http://localhost:9001"
echo "  Qdrant ........... http://localhost:6333/dashboard"
echo "  Flags: --build  --fresh  --llm  --stop  --no-browser  --logs"
echo ""

if [ "$NOBROWSER" -eq 0 ]; then
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$APP_URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$APP_URL" >/dev/null 2>&1 || true
  fi
fi

if [ "$LOGS" -eq 1 ]; then
  echo "Following API + worker logs (Ctrl+C to stop; stack keeps running)..."
  docker compose -f "$COMPOSE" logs -f api celery-worker
fi
