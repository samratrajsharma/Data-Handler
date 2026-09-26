"""Diagnose CLIP model re-downloads and clustering failures.

Run INSIDE the worker container, which is where both actually happen:

    docker compose -f infrastructure/docker-compose.yml exec celery-worker \
        python scripts/diagnose_clip.py

Read-only. Downloads nothing, changes nothing.

WHY A SCRIPT RATHER THAN READING THE CONFIG
The cache configuration reads correctly in docker-compose.yml and the
Dockerfile: the named volume is mounted on both api and celery-worker, and
HF_HOME points into it. So the re-download is not a missing mount — it is
something only visible at runtime. The four candidates below are all invisible
from the source tree, and they need different fixes, so guessing between them
is how you end up "fixing" it three times.
"""

import os
import shutil
import sys
from pathlib import Path

# Running `python scripts/diagnose_clip.py` sets sys.path[0] to .../scripts,
# NOT the repo root, so `import core` fails. Add the root explicitly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BOLD, DIM, RED, GRN, YEL, OFF = "\033[1m", "\033[2m", "\033[31m", "\033[32m", "\033[33m", "\033[0m"

findings: list[tuple[str, str]] = []


def head(t: str) -> None:
    print(f"\n{BOLD}{t}{OFF}")


def ok(t: str) -> None:
    print(f"  {GRN}OK{OFF}    {t}")


def bad(t: str, fix: str) -> None:
    print(f"  {RED}PROBLEM{OFF} {t}")
    findings.append((t, fix))


def warn(t: str) -> None:
    print(f"  {YEL}CHECK{OFF} {t}")


def info(t: str) -> None:
    print(f"  {DIM}{t}{OFF}")


# ── 1. Who am I, and can I write the cache? ──────────────────────────────
# Candidate A: the named volume is owned by root while the container runs as
# uid 10001. huggingface_hub cannot write, silently falls back to a temp dir,
# and re-downloads on every single run. This is the most likely cause if the
# hf_cache volume was created BEFORE the Dockerfile started chowning
# /opt/hf-cache — Docker only seeds ownership when the volume is first created,
# so an old volume keeps its old ownership forever.
head("1. Identity and cache writability")
hf_home = os.environ.get("HF_HOME")
info(f"uid={os.getuid()} gid={os.getgid()}")
info(f"HF_HOME={hf_home}")
info(f"TRANSFORMERS_CACHE={os.environ.get('TRANSFORMERS_CACHE')}")
info(f"HF_HUB_OFFLINE={os.environ.get('HF_HUB_OFFLINE')}")

if not hf_home:
    bad("HF_HOME is not set in this container.",
        "Set HF_HOME in the celery-worker environment in docker-compose.yml.")
else:
    p = Path(hf_home)
    if not p.exists():
        bad(f"{hf_home} does not exist.",
            "The hf_cache volume is not mounted on this service. Add it under "
            "celery-worker.volumes in docker-compose.yml.")
    else:
        st = p.stat()
        info(f"{hf_home} owner uid={st.st_uid} gid={st.st_gid} mode={oct(st.st_mode)[-3:]}")
        probe = p / ".write-probe"
        try:
            probe.write_text("x")
            probe.unlink()
            ok("The cache directory is writable by this user.")
        except OSError as exc:
            bad(f"Cannot write to {hf_home}: {exc}",
                "The volume is owned by another user. Fix with:\n"
                "        docker compose -f infrastructure/docker-compose.yml run --rm "
                "--user root celery-worker chown -R 10001:10001 /opt/hf-cache\n"
                "      This is almost certainly your re-download cause.")

# ── 1b. Is the cache a real volume, or just a directory in the image? ────
# THE GAP IN THE FIRST VERSION OF THIS SCRIPT. Writability proves nothing about
# persistence: a directory baked into the image is writable too, and everything
# written there lives in the container's writable layer and is destroyed the
# moment the container is recreated (every `-Build`, every `down`). That looks
# identical to a cache bug from the inside — which is why section 3 failed
# while sections 1 and 2 looked healthy.
head("1b. Is the cache actually persistent?")
mounted = False
try:
    mounts = Path("/proc/mounts").read_text(encoding="utf-8", errors="replace")
    for line in mounts.splitlines():
        parts = line.split()
        if len(parts) > 1 and parts[1] == (hf_home or "/opt/hf-cache"):
            mounted = True
            info(f"mount entry: {line.strip()[:110]}")
    if mounted:
        ok(f"{hf_home} is a real mount — writes survive container recreation.")
    else:
        bad(f"{hf_home} is NOT a mount point; it is a directory inside the image.",
            "Everything written there is lost when the container is recreated, "
            "so the model re-downloads on every run. Check that celery-worker "
            "has `- hf_cache:/opt/hf-cache` under volumes: in "
            "infrastructure/docker-compose.yml, then `run.cmd -Build`.")
except OSError:
    warn("Could not read /proc/mounts.")

# Marker file: run this script, recreate the container, run it again. If the
# marker is gone, the directory is not persisting whatever /proc/mounts claims.
marker = Path(hf_home or "/opt/hf-cache") / ".persistence-marker"
try:
    if marker.exists():
        ok(f"Persistence marker from a previous run survived: {marker.read_text()[:40]}")
    else:
        import datetime
        marker.write_text(datetime.datetime.now().isoformat(timespec="seconds"))
        info("Wrote a persistence marker. Restart the stack and re-run this "
             "script: if the marker is gone, the cache is not persisting.")
except OSError as exc:
    warn(f"Could not write the marker: {exc}")


# ── 2. Is the model actually on disk, and where? ─────────────────────────
# Candidate B: HF_HOME and TRANSFORMERS_CACHE disagree. HF_HOME implies
# $HF_HOME/hub; TRANSFORMERS_CACHE is used verbatim. Setting both to the SAME
# value (as this repo does) means one library writes to /opt/hf-cache/hub and
# another looks in /opt/hf-cache — a cache that is always a miss.
head("2. What is on disk")
model = os.environ.get("CLIP_MODEL_NAME", "openai/clip-vit-base-patch32")
slug = "models--" + model.replace("/", "--")
info(f"Looking for: {slug}")

roots = []
if hf_home:
    roots += [Path(hf_home) / "hub", Path(hf_home)]
tc = os.environ.get("TRANSFORMERS_CACHE")
if tc:
    roots.append(Path(tc))

found_at = []
for r in roots:
    cand = r / slug
    if cand.exists():
        size = sum(f.stat().st_size for f in cand.rglob("*") if f.is_file())
        found_at.append((cand, size))
        ok(f"Found at {cand} ({size / 1e6:.0f} MB)")

if not found_at:
    warn("Model is NOT cached anywhere. If you have already run embeddings "
         "once, this is the bug — it is being re-downloaded every time.")
    for r in roots:
        info(f"  looked in: {r}")
    # What IS in there? Empty means nothing ever wrote (or it was wiped);
    # .incomplete blobs mean downloads are starting and being interrupted.
    base = Path(hf_home or "/opt/hf-cache")
    if base.exists():
        entries = sorted(p.name for p in base.iterdir())
        info(f"  {base} contains: {entries or '(empty)'}")
        partial = list(base.rglob("*.incomplete"))
        if partial:
            bad(f"{len(partial)} interrupted download(s) found (.incomplete).",
                "The download starts but never finishes — it is being cancelled "
                "or the worker is restarting mid-download. Check "
                "`docker compose logs celery-worker` during a run.")
elif len({str(c.parent) for c, _ in found_at}) > 1:
    bad("The model exists in MORE THAN ONE cache root.",
        "HF_HOME and TRANSFORMERS_CACHE are resolving differently. Remove "
        "TRANSFORMERS_CACHE (deprecated) from docker-compose.yml and the "
        "Dockerfile, keep only HF_HOME, then re-download once.")

if hf_home:
    total, used, free = shutil.disk_usage(hf_home)
    info(f"Free space on the cache filesystem: {free / 1e9:.1f} GB")
    if free < 2e9:
        bad(f"Only {free / 1e9:.1f} GB free.",
            "A download that runs out of space leaves no cache behind and "
            "retries from zero next run. Free space or prune Docker volumes.")

# ── 3. Does transformers resolve it offline? ─────────────────────────────
# The real test: ask the library itself, with the network disabled. If it
# answers from cache, caching works and the re-download is somewhere else.
head("3. Offline resolution test (the decisive one)")
os.environ["HF_HUB_OFFLINE"] = "1"
try:
    from transformers import CLIPModel  # noqa: F401
    CLIPModel.from_pretrained(model)
    ok("transformers loaded the model with the network OFF — the cache works.")
    info("If it still re-downloads in normal use, the volume is being removed "
         "between runs. See section 4.")
except Exception as exc:
    msg = str(exc).splitlines()[0][:160]
    bad(f"Could not load offline: {msg}",
        "The model is not usable from cache, so every run re-downloads. "
        "Apply the fix from section 1 or 2 above, whichever reported a problem.")

# ── 4. Is the volume being destroyed between runs? ───────────────────────
# Candidate C, and it is not a bug: `run.ps1 -Fresh` runs `docker compose down -v`,
# which deletes every named volume including hf_cache. Using -Fresh habitually
# means re-downloading 600 MB every time, by design.
head("4. Things this script cannot see (check on the host)")
print(f"""  {DIM}a) Are you running `run.ps1 -Fresh`? That does `down -v`, which DELETES
     the hf_cache volume along with the database. Use plain `run.cmd` (or
     `-Build`) unless you actually want a clean slate.

  b) Confirm the volume survives:
       docker volume ls | findstr hf_cache
       docker volume inspect infrastructure_hf_cache

  c) Watch a run and see whether it downloads:
       docker compose -f infrastructure/docker-compose.yml logs -f celery-worker{OFF}""")

# ── 5. Clustering ────────────────────────────────────────────────────────
head("5. Clustering — why it may need several clicks")
try:
    from qdrant_client import QdrantClient
    from core.settings import settings

    qc = QdrantClient(url=f"http://{settings.QDRANT_HOST}:{settings.QDRANT_PORT}")
    cols = [c.name for c in qc.get_collections().collections]
    info(f"Qdrant collections: {cols or '(none)'}")
    if not cols:
        bad("Qdrant holds no collections — there are no embeddings to cluster.",
            "Clustering silently produces nothing without embeddings. Run "
            "Generate embeddings to completion FIRST and confirm it finished.")
    else:
        for c in cols:
            n = qc.count(collection_name=c, exact=True).count
            info(f"  {c}: {n} vectors")
            if n == 0:
                bad(f"Collection '{c}' is empty.",
                    "Embeddings were never written. Check the celery-worker log "
                    "during Generate embeddings for a failure.")
except Exception as exc:
    warn(f"Could not reach Qdrant: {str(exc).splitlines()[0][:120]}")
    info("If Qdrant is down, clustering fails every time and the UI shows nothing.")

# ── Summary ──────────────────────────────────────────────────────────────
print(f"\n{BOLD}{'─' * 68}{OFF}")
if findings:
    print(f"{RED}{BOLD}{len(findings)} problem(s) found.{OFF}\n")
    for i, (what, fix) in enumerate(findings, 1):
        print(f"{BOLD}{i}. {what}{OFF}\n   → {fix}\n")
    sys.exit(1)

print(f"{GRN}{BOLD}No cache problem found inside the container.{OFF}")
print("If the model still re-downloads, it is section 4 — the volume is being\n"
      "removed between runs (almost always `-Fresh`).")
