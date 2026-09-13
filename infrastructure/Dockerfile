# syntax=docker/dockerfile:1
###############################################################################
# Data Handler — API / Celery worker image
#
# THE SHIPPED IMAGE IS `runtime-ml` — all three modalities, ~1.9 GB on disk /
# ~406 MB to download. It is the last stage in this file, so a plain
# `docker build` with no --target selects it, and both docker-compose.yml and
# the CI workflow name it explicitly.
#
#   docker build -f infrastructure/Dockerfile -t data-handler-api .
#
# The multi-stage split (base / builder / app-base / runtime*) is what took the
# image from 3.05 GB to 1.88 GB: compilers, -dev headers and build residue stay
# in `builder` and never reach the runtime layers.
#
# `runtime` (below runtime-ml) is a PyTorch-free variant, ~1.0 GB. It is NOT
# published — it is kept because it costs nothing (unbuilt targets are skipped)
# and it works: nothing in the codebase imports torch / transformers /
# sentence_transformers at module scope, and eda/embedder.py falls back to
# TF-IDF + TruncatedSVD when sentence-transformers is absent. Build it with
# --target runtime if a tabular/text-only image is ever wanted.
#
# WHY THE LAYERS ARE SPLIT
# Docker pulls layers in parallel (3 concurrent by default) but cannot
# parallelise within a layer. The previous single `pip install -r
# requirements.txt` produced one ~1 GB layer that downloaded on a single TCP
# stream — on a slow link that is hours. Four medium layers pull concurrently.
###############################################################################


# ─────────────────────────────────────────────────────────────────────────────
# base — runtime OS only. No compilers ever reach the final image.
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS base

# NOTE: PIP_NO_CACHE_DIR is deliberately NOT set here. It would suppress pip's
# cache directory entirely, which silently defeats the
# `--mount=type=cache,target=/root/.cache/pip` mounts below and makes every
# rebuild re-download ~1 GB of wheels. The cache mounts already keep the cache
# out of the image layers, so nothing is gained by setting it.
#
# PYTHONDONTWRITEBYTECODE is deliberately NOT set either. It exists to avoid
# littering a bind-mounted source tree with __pycache__, but our code and
# site-packages live in immutable image layers, where precompiled bytecode is
# exactly what we want: without it every container start re-compiles pandas,
# sqlalchemy, litellm and the rest from source, and nothing is ever cached.
# Bytecode is generated at build time by `compileall` below.
ENV PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

# libgomp1 is the OpenMP runtime that scikit-learn, scipy and hdbscan link
# against. python:3.11-slim does not ship it, and without it `import sklearn`
# dies with "libgomp.so.1: cannot open shared object file". ~150 KB.
#
# Deliberately NOT installed (all were in the previous single-stage image):
#   gcc, g++      -> build-time only, now confined to the builder stage
#   libpq-dev     -> psycopg2-binary bundles libpq inside its wheel
#   libjpeg-dev   -> Pillow's manylinux wheels bundle libjpeg
#   libpng-dev    -> ditto
#   curl          -> was never used; no healthcheck referenced it
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgomp1 && \
    rm -rf /var/lib/apt/lists/*


# ─────────────────────────────────────────────────────────────────────────────
# builder — compilers live here and are discarded
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS builder

# gcc/g++ are needed because hdbscan has no manylinux wheel for many releases
# and compiles from source. libpq-dev is belt-and-braces in case pip falls back
# to an sdist for psycopg2. None of this survives into the runtime stages.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc g++ libpq-dev && \
    rm -rf /var/lib/apt/lists/*

# A venv gives the runtime stages exactly one directory to COPY, and keeps our
# packages out of the system site-packages.
RUN python -m venv /opt/venv

WORKDIR /build
COPY requirements/ ./requirements/

# Three separate RUN layers — see the header note on parallel pulls.
# Ordered slow-changing first so a core dependency bump does not invalidate the
# expensive data-stack layer.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --default-timeout=120 --retries 3 -r requirements/data.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --default-timeout=120 --retries 3 -r requirements/extras.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --default-timeout=120 --retries 3 -r requirements/core.txt

# Bytecode is KEPT, not stripped.
#
# An earlier revision deleted __pycache__ from the venv to save ~180 MB. That
# was a bad trade: with no .pyc in the image, every cold start re-compiles the
# whole dependency tree from source, and PYTHONDONTWRITEBYTECODE meant the
# result was never cached either — the tenth start cost as much as the first.
# We now precompile instead, moving that work to build time where CI pays it
# once. Costs ~180 MB, buys a warm import path on every start.
#
# `|| true`: compileall exits non-zero if ANY file fails to compile, and a few
# packages legitimately ship Python-2 or otherwise non-importable samples.
RUN python -m compileall -q /opt/venv || true

# OPTIONAL, saves a further ~60 MB. Removes the bundled test suites of numpy,
# pandas, scipy and sklearn. Safe for this codebase (nothing imports them), but
# left commented out because a future dependency could import its own tests.
# RUN rm -rf /opt/venv/lib/python3.11/site-packages/{numpy,pandas,scipy,sklearn}/tests


# ─────────────────────────────────────────────────────────────────────────────
# builder-ml — adds the deep-learning stack on top of the same venv
# ─────────────────────────────────────────────────────────────────────────────
FROM builder AS builder-ml

# CPU-only PyTorch, installed BEFORE transformers/sentence-transformers so they
# resolve torch as already-satisfied instead of dragging the ~2.3 GB CUDA wheel
# from PyPI. Its own layer (~800 MB) so it pulls concurrently with the rest and
# never re-downloads when application deps change.
#
# NOTE: torch is the only unpinned dependency in the project. Pin it here
# (e.g. torch==2.5.1) before cutting a release you need to reproduce.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --default-timeout=120 --retries 3 \
      torch --index-url https://download.pytorch.org/whl/cpu

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --default-timeout=120 --retries 3 -r requirements/ml.txt

# torch/include is ~50 MB of C++ headers used only by torch.utils.cpp_extension
# (compiling custom ops), which this project never does. torch/test likewise.
RUN rm -rf /opt/venv/lib/python3.11/site-packages/torch/include \
           /opt/venv/lib/python3.11/site-packages/torch/test && \
    python -m compileall -q /opt/venv/lib/python3.11/site-packages/torch \
                            /opt/venv/lib/python3.11/site-packages/transformers || true


# ─────────────────────────────────────────────────────────────────────────────
# app-base — everything the two runtime targets share
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS app-base

# Run as a non-root user. The HF cache is a named Docker volume, and Docker
# seeds a fresh volume's ownership from the image directory — so this chown is
# what lets the unprivileged user write CLIP/MiniLM downloads into it.
# Default shell left intact (not nologin) so `docker compose exec api sh` still
# works for debugging.
RUN useradd --create-home --uid 10001 app && \
    mkdir -p /opt/hf-cache/sentence-transformers && \
    chown -R app:app /opt/hf-cache

# Model weights are downloaded on first use into this mounted volume rather
# than baked into the image — anyone who never touches embeddings never pays
# for them. (TRANSFORMERS_CACHE is deprecated in favour of HF_HOME from
# transformers 4.36; kept for older versions, drop it once the floor is raised.)
ENV HF_HOME=/opt/hf-cache \
    TRANSFORMERS_CACHE=/opt/hf-cache \
    SENTENCE_TRANSFORMERS_HOME=/opt/hf-cache/sentence-transformers

WORKDIR /app

# Build identity. CI passes the git tag (build-args: APP_VERSION=${{ github.ref_name }}).
#
# The default is EMPTY, not "0.0.0-dev". ENV is unconditional — it is set
# whether or not --build-arg was passed — so a non-empty default would always
# win over the VERSION file in the source tree, and a local `run.ps1 -Build`
# of a released checkout would report "0.0.0-dev" in the UI. Empty lets
# core/settings.py fall through to VERSION, which is the number the user
# actually downloaded.
#
# Declared here, AFTER the expensive dependency layers, so a version bump
# invalidates only the cheap tail of the build.
ARG APP_VERSION=""
ENV APP_VERSION=${APP_VERSION}

# Application source last: it changes on every commit, so keeping it after the
# dependency layers means a code edit rebuilds only this one thin layer.
# frontend/ is excluded by .dockerignore (it is built as its own image).
COPY --chown=app:app . .

# Precompile the application too, for the same reason as the venv above. This
# only helps when /app is the image layer — if a bind mount shadows it (see
# docker-compose.dev.yml) the host source is read and compiled on every start.
RUN python -m compileall -q /app || true

USER app
EXPOSE 8000

# The previous image had no healthcheck, which made the frontend's
# `depends_on: api` decorative and let nginx 502 until uvicorn was listening.
# Uses stdlib urllib so we do not need curl in the image.
#
# The Celery worker shares this image but listens on no port — compose must
# override this with `healthcheck: {disable: true}` for that service.
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]


# ─────────────────────────────────────────────────────────────────────────────
# runtime — PyTorch-free variant, ~1.0 GB. NOT published; see header.
# ─────────────────────────────────────────────────────────────────────────────
FROM app-base AS runtime
# --chown so `pip install -r requirements/dev.txt` works inside a running
# container as the unprivileged user (that is how `make test` gets pytest).
COPY --from=builder --chown=app:app /opt/venv /opt/venv


# ─────────────────────────────────────────────────────────────────────────────
# runtime-ml — THE SHIPPED IMAGE. All three modalities. ~1.9 GB on disk.
# Last stage in the file, so a plain `docker build` with no --target picks it.
# ─────────────────────────────────────────────────────────────────────────────
FROM app-base AS runtime-ml
COPY --from=builder-ml --chown=app:app /opt/venv /opt/venv
