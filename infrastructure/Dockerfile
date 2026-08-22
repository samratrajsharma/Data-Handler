# syntax=docker/dockerfile:1
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libpq-dev \
        gcc \
        curl \
        libjpeg-dev \
        libpng-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# Install CPU-only PyTorch first. transformers / sentence-transformers pull torch
# transitively, and the default wheel is the ~2.3 GB CUDA build — pure waste on a
# CPU-targeted image (users with a GPU can swap in a CUDA build). The BuildKit
# cache mount keeps downloaded wheels between builds so rebuilds are fast.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --default-timeout=120 --retries 3 \
      torch --index-url https://download.pytorch.org/whl/cpu
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --default-timeout=120 --retries 3 -r requirements.txt

# ML models (CLIP, MiniLM) are NOT baked into the image — they download once on
# first use and persist in the mounted hf-cache volume. This keeps the image
# small and the build fast; anyone who never uses embeddings never downloads them.
ENV HF_HOME=/opt/hf-cache \
    TRANSFORMERS_CACHE=/opt/hf-cache \
    SENTENCE_TRANSFORMERS_HOME=/opt/hf-cache/sentence-transformers

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
