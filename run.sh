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
#   ./run.sh --llm          Also start the bundled Ollama and pull the default model.
#   ./run.sh --dev          Live code reload (mounts the repo over the image).
#   ./run.sh --stop         Stop the stack (data volumes preserved).
#   ./run.sh --no-browser   Start, but don't auto-open the browser.
#   ./run.sh --logs         After starting, follow the API + worker logs.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="infrastructure/docker-compose.yml"
APP_URL="http://localhost:3000"
PROFILE=()
FRESH=0; BUILD=0; STOP=0; NOBROWSER=0; LOGS=0; DEV=0; LLM=0

for arg in "$@"; do
  case "$arg" in
    --fresh)      FRESH=1 ;;
    --build)      BUILD=1 ;;
    --dev)        DEV=1 ;;
    --llm)        LLM=1; PROFILE=(--profile llm) ;;
    --stop)       STOP=1 ;;
    --no-browser) NOBROWSER=1 ;;
    --logs)       LOGS=1 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# --dev layers the live-reload overlay (bind mount + uvicorn --reload) on top of
# the base file. Without it the containers run the code baked into the image.
COMPOSE_DEV="infrastructure/docker-compose.dev.yml"
COMPOSE_FILES=(-f "$COMPOSE")
[ "$DEV" -eq 1 ] && COMPOSE_FILES+=(-f "$COMPOSE_DEV")

# macOS still ships bash 3.2, where `set -u` makes "${ARR[@]}" on an EMPTY array
# an "unbound variable" error. That is the no-flag default path, so without this
# guard the script fails outright on a stock Mac. Expand to nothing when unset.
compose() { docker compose "${COMPOSE_FILES[@]}" ${PROFILE[@]+"${PROFILE[@]}"} "$@"; }

# Point the app at the bundled Ollama on the compose network. Without this the
# app keeps the .env default (host.docker.internal), which addresses an Ollama
# on the HOST - so --llm would start a container nothing talks to.
if [ "$LLM" -eq 1 ]; then
  export OLLAMA_BASE_URL="http://ollama:11434"
fi

echo ""
echo "  DATA HANDLER"
echo "  ------------"

if [ "$STOP" -eq 1 ]; then
  echo "Stopping the stack (data volumes preserved)..."
  compose down
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
  compose down -v
fi

# By default just start (the first run builds any missing images); --build /
# --fresh force a rebuild so code changes are baked in.
BUILD_ARGS=()
if [ "$BUILD" -eq 1 ] || [ "$FRESH" -eq 1 ]; then
  BUILD_ARGS=(--build)
  echo "Rebuilding images and starting all services."
  echo "  First build takes roughly 5-10 minutes (compiling hdbscan,"
  echo "  downloading wheels). Later builds reuse cached layers and"
  echo "  finish in under a minute. Live build progress follows."
  echo ""
else
  # Fast path: pull prebuilt images from GHCR if published; anything not
  # published falls back to building on the 'up' below.
  # Docker writes ALL pull output to stderr. This used to end in `2>/dev/null`,
  # which discarded Compose's own per-layer progress bars along with the errors
  # — so a healthy multi-minute pull looked identical to a freeze. Never
  # redirect this.
  #
  # Compose's default --progress=auto already renders live per-layer bars on a
  # terminal and falls back to plain line output when redirected, so we do not
  # pass --progress explicitly (older Compose builds reject the flag). What
  # Compose does NOT report is total size or elapsed time, so we add both.
  echo ""
  echo "Downloading images."
  echo "  App images ......... ~500 MB (backend + frontend)"
  echo "  Service images ..... ~300 MB (Postgres, Redis, MinIO, Qdrant)"
  echo "  Unpacked on disk ... ~1.9 GB"
  echo ""
  echo "  One-time cost - later runs start in seconds. Docker's live"
  echo "  per-layer progress follows."
  echo "  Safe to Ctrl+C - finished layers are kept and resumed."
  echo ""

  # No --progress flag: Compose's default ("auto") renders live per-layer bars
  # on a terminal and degrades to plain lines when redirected. Forcing "plain"
  # was worse — it re-prints every layer on each poll tick even when nothing
  # changed.
  pull_start=$(date +%s)
  compose pull --ignore-pull-failures || true
  pull_elapsed=$(( $(date +%s) - pull_start ))
  printf 'Download finished in %02d:%02d.\n' $(( pull_elapsed / 60 )) $(( pull_elapsed % 60 ))

  # A missing image is NOT auto-built by `up`. When a service declares both
  # `image:` and `build:`, Compose resolves the reference and fails hard if the
  # registry does not have it — it does not silently fall back to the build
  # section. So check explicitly and add --build ourselves.
  API_IMAGE="ghcr.io/samratrajsharma/data-handler-api:latest"
  if ! docker image inspect "$API_IMAGE" >/dev/null 2>&1; then
    echo "$API_IMAGE is not published yet - building it locally instead."
    echo "  First build takes roughly 5-10 minutes; later builds reuse"
    echo "  cached layers and finish in under a minute."
    echo ""
    BUILD_ARGS=(--build)
  fi
fi
# Not redirected either: if an image still has to be built here (e.g. a tag that
# isn't published yet), BuildKit's own progress output is the only feedback the
# user gets, and it can run for several minutes.
echo "Starting services..."
compose up -d ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} --remove-orphans

echo "Waiting for the API..."
ready=0
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:8000/health" 2>/dev/null | grep -q healthy; then ready=1; break; fi
  sleep 2
  [ $((i % 5)) -eq 0 ] && echo "  still starting... ($i/60)"
done
if [ "$ready" -eq 1 ]; then
  echo "API is healthy."
else
  echo "API health check timed out after 120s."
  echo ""
  echo "  Last 40 lines of the api log:"
  compose logs --tail=40 api
  echo ""
fi

# A crash-looping worker is otherwise invisible: the API answers, the UI loads,
# and every background job queues forever with no error anywhere.
echo "Checking the background worker..."
WORKER_FAILED=0
if compose ps -a --format '{{.Service}} {{.State}}' | grep -q '^celery-worker running'; then
  echo "Worker is running."
else
  echo "Celery worker is not running - background jobs will queue forever."
  echo "  Last 20 lines of the worker log:"
  compose logs --tail=20 celery-worker
  WORKER_FAILED=1
fi

echo "Waiting for the frontend..."
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "$APP_URL" 2>/dev/null; then break; fi
  sleep 2
done

echo ""
# Report honestly: this used to print "Stack is up." even when the health checks
# had timed out, exiting 0 either way.
if [ "$ready" -ne 1 ]; then
  echo "  Stack did NOT come up cleanly."
  echo "  The API never answered http://localhost:8000/health. Logs are above."
  echo "  Follow them live with:  ./run.sh --logs"
  echo ""
  exit 1
fi
[ "$WORKER_FAILED" -eq 1 ] && echo "  Warning: the background worker is down (see above)."
echo "  Stack is up."
echo "  App (UI) ......... $APP_URL"
echo "  API + Swagger .... http://localhost:8000/docs"
echo "  MinIO console .... http://localhost:9001"
echo "  Qdrant ........... http://localhost:6333/dashboard"
echo "  Flags: --build  --fresh  --llm  --dev  --stop  --no-browser  --logs"
echo ""

if [ "$NOBROWSER" -eq 0 ]; then
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$APP_URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$APP_URL" >/dev/null 2>&1 || true
  fi
fi

if [ "$LOGS" -eq 1 ]; then
  echo "Following API + worker logs (Ctrl+C to stop; stack keeps running)..."
  compose logs -f api celery-worker
fi
