.PHONY: up down logs migrate test lint fmt clean install install-ml xpu-check

COMPOSE_FILE := infrastructure/docker-compose.yml

up:
	docker compose -f $(COMPOSE_FILE) up -d --build

down:
	docker compose -f $(COMPOSE_FILE) down

logs:
	docker compose -f $(COMPOSE_FILE) logs -f

migrate:
	docker compose -f $(COMPOSE_FILE) exec api alembic upgrade head

test:
	docker compose -f $(COMPOSE_FILE) exec api pytest -v

lint:
	docker compose -f $(COMPOSE_FILE) exec api python -m ruff check .

fmt:
	docker compose -f $(COMPOSE_FILE) exec api python -m ruff format .

clean:
	docker compose -f $(COMPOSE_FILE) down -v --remove-orphans

# --- Local Development (outside Docker) ---
install:
	pip install -r requirements.txt

install-ml:
	pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/xpu
	pip install intel-extension-for-pytorch

xpu-check:
	python -c "import torch; print('XPU available:', torch.xpu.is_available()); print('Torch version:', torch.__version__); print('Devices:', torch.xpu.device_count() if torch.xpu.is_available() else 0)"
