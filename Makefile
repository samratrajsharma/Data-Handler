.PHONY: up down logs migrate test lint fmt typecheck clean build image-size install install-ml xpu-check

COMPOSE_FILE := infrastructure/docker-compose.yml

up:
	docker compose -f $(COMPOSE_FILE) up -d

down:
	docker compose -f $(COMPOSE_FILE) down

logs:
	docker compose -f $(COMPOSE_FILE) logs -f

migrate:
	docker compose -f $(COMPOSE_FILE) exec api alembic upgrade head

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
