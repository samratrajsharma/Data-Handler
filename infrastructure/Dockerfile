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
RUN pip install --no-cache-dir --default-timeout=120 --retries 3 -r requirements.txt

# Pre-bake ML models into the image so they never download at runtime. HF_HOME
# is a stable path; docker-compose mounts a named volume here so the cache also
# survives image rebuilds. The "|| echo" keeps offline builds from failing —
# the model then downloads once on first use and is persisted by the volume.
ENV HF_HOME=/opt/hf-cache \
    TRANSFORMERS_CACHE=/opt/hf-cache \
    SENTENCE_TRANSFORMERS_HOME=/opt/hf-cache/sentence-transformers
RUN python -c "from transformers import CLIPModel, CLIPProcessor; m='openai/clip-vit-base-patch32'; CLIPProcessor.from_pretrained(m); CLIPModel.from_pretrained(m)" \
    || echo "WARN: CLIP prefetch skipped (no network at build); will fetch on first use"
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')" \
    || echo "WARN: sentence-transformer prefetch skipped"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
