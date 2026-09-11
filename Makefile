.PHONY: up down logs migrate revision check-schema check-mask-codec check-ui test lint fmt typecheck clean build image-size install install-ml xpu-check

COMPOSE_FILE := infrastructure/docker-compose.yml

up:
	docker compose -f $(COMPOSE_FILE) up -d

down:
	docker compose -f $(COMPOSE_FILE) down

logs:
	docker compose -f $(COMPOSE_FILE) logs -f

# The app migrates itself at startup (core/db_bootstrap.py), so this is only
# needed to apply a migration without restarting the API.
migrate:
	docker compose -f $(COMPOSE_FILE) exec api alembic upgrade head

# Create a migration from model changes. Review the generated file before
# committing — autogenerate misses server defaults and some constraint changes.
revision:
	docker compose -f $(COMPOSE_FILE) exec api alembic revision --autogenerate -m "$(m)"

# Same check CI runs: does the migrated database still match the models?
check-schema:
	docker compose -f $(COMPOSE_FILE) exec api python scripts/check_schema_drift.py

# The browser encodes segmentation masks and Python decodes them for export.
# A divergence corrupts data without erroring, so the two are pinned to shared
# vectors. Needs Node 22.6+ (type stripping); no npm install required.
check-mask-codec:
	node --experimental-strip-types scripts/check_mask_codec_parity.mjs
	node --experimental-strip-types scripts/check_mask_paint.mjs

# Guards for failures that are silent rather than loud: a help sheet listing a
# shortcut the editor no longer implements, and a collapsed sidebar whose
# labels still reserve width and push the icons out of view. Both are pure
# source checks — no build, no npm install, no running stack.
check-ui:
	node scripts/check_shortcuts.mjs
	node scripts/check_sidebar_rail.mjs

# pytest / ruff / mypy are no longer baked into the published image (they cost
# ~80 MB and have no business in a runtime container). These targets install
# them into the running container on demand — pip is a no-op after the first
# run, so this only costs time once per container lifetime.
DEV_DEPS := pip install -q -r requirements/dev.txt

test:
	docker compose -f $(COMPOSE_FILE) exec api sh -c "$(DEV_DEPS) && pytest -v"

lint:
	docker compose -f $(COMPOSE_FILE) exec api sh -c "$(DEV_DEPS) && python -m ruff check ."

fmt:
	docker compose -f $(COMPOSE_FILE) exec api sh -c "$(DEV_DEPS) && python -m ruff format ."

typecheck:
	docker compose -f $(COMPOSE_FILE) exec api sh -c "$(DEV_DEPS) && python -m mypy core data_intelligence"

clean:
	docker compose -f $(COMPOSE_FILE) down -v --remove-orphans

# --- Image builds ---
build:
	DOCKER_BUILDKIT=1 docker build -f infrastructure/Dockerfile \
		--target runtime-ml -t data-handler-api:latest .

# Print the layer breakdown so image growth is visible, not a surprise.
image-size:
	docker images data-handler-api --format "table {{.Tag}}\t{{.Size}}"
	docker history data-handler-api:latest --human --format "table {{.Size}}\t{{.CreatedBy}}" | head -20

# --- Local Development (outside Docker) ---
install:
	pip install -r requirements.txt -r requirements/dev.txt

install-ml:
	pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/xpu
	pip install intel-extension-for-pytorch

xpu-check:
	python -c "import torch; print('XPU available:', torch.xpu.is_available()); print('Torch version:', torch.__version__); print('Devices:', torch.xpu.device_count() if torch.xpu.is_available() else 0)"
