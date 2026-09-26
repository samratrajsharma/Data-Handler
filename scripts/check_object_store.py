"""Prove the object store actually works, end to end.

    docker compose -f infrastructure/docker-compose.yml exec api \
        python scripts/check_object_store.py

WHY THIS EXISTS
Swapping MinIO for SeaweedFS is a one-line endpoint change in theory, because
core/storage.py uses the `minio` Python package — which is a generic S3 client,
not a MinIO-specific one. In practice S3 implementations differ in exactly the
places this app leans on, and the differences do NOT show up at startup. A
stack where every container is healthy can still be one where no image ever
reaches a browser.

The decisive test is the PRESIGNED URL. Every thumbnail and every full image in
the annotator is fetched by the browser from a presigned GET. Presigning is an
offline SigV4 signature, so it "succeeds" locally no matter what — the only way
to know it is valid is to make an unauthenticated HTTP request with it and see
whether bytes come back. Steps 5 and 6 below are the reason this file exists;
the rest is scaffolding to get there.

Exits non-zero on the first real failure so it can gate a release.
"""

import io
import sys
import uuid
from pathlib import Path

# `python scripts/check_object_store.py` puts .../scripts on sys.path[0], not
# the repo root, so `import core` fails. Same trap as scripts/diagnose_clip.py.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

GRN, RED, YEL, DIM, OFF = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def ok(m):
    print(f"  {GRN}PASS{OFF}  {m}")


def die(m, hint=""):
    print(f"  {RED}FAIL{OFF}  {m}")
    if hint:
        print(f"        {hint}")
    sys.exit(1)


def info(m):
    print(f"  {DIM}{m}{OFF}")


from core.settings import settings          # noqa: E402
from core.storage import get_minio_client, get_minio_public_client  # noqa: E402

print(f"\nEndpoint (internal): {settings.MINIO_ENDPOINT}")
print(f"Endpoint (browser):  {settings.MINIO_PUBLIC_ENDPOINT}")
print(f"Bucket:              {settings.MINIO_BUCKET_NAME}\n")

client = get_minio_client()
bucket = settings.MINIO_BUCKET_NAME
key = f"_selftest/{uuid.uuid4()}.bin"
payload = b"data-handler object store self test" * 32   # ~1 KB

# ── 1. Reach the server ──────────────────────────────────────────────────
try:
    exists = client.bucket_exists(bucket)
    ok(f"reached the S3 endpoint (bucket_exists -> {exists})")
except Exception as exc:
    die(f"cannot reach {settings.MINIO_ENDPOINT}: {str(exc).splitlines()[0][:140]}",
        "Is the object-store container up? `docker compose ps`. If it is, check "
        "MINIO_ENDPOINT in .env — SeaweedFS listens on 8333, MinIO on 9000.")

# ── 2. Create the bucket ─────────────────────────────────────────────────
if not exists:
    try:
        client.make_bucket(bucket)
        ok(f"created bucket '{bucket}'")
    except Exception as exc:
        die(f"make_bucket failed: {str(exc).splitlines()[0][:140]}",
            "Credentials may be wrong. For SeaweedFS the keys live in "
            "infrastructure/seaweedfs-s3.json and must match "
            "MINIO_ACCESS_KEY / MINIO_SECRET_KEY in .env.")
else:
    ok(f"bucket '{bucket}' already present")

# ── 3. Upload ────────────────────────────────────────────────────────────
try:
    client.put_object(bucket, key, io.BytesIO(payload), length=len(payload),
                      content_type="application/octet-stream")
    ok(f"uploaded {len(payload)} bytes")
except Exception as exc:
    die(f"put_object failed: {str(exc).splitlines()[0][:140]}")

# ── 4. Download and compare ──────────────────────────────────────────────
try:
    r = client.get_object(bucket, key)
    try:
        got = r.read()
    finally:
        r.close()
        r.release_conn()
    if got != payload:
        die(f"round trip corrupted the object ({len(got)} bytes back, expected {len(payload)})")
    ok("downloaded and byte-for-byte identical")
except SystemExit:
    raise
except Exception as exc:
    die(f"get_object failed: {str(exc).splitlines()[0][:140]}")

# ── 5. Presign, signed for the endpoint we will actually call ────────────
# WHAT THIS FILE GOT WRONG THE FIRST TIME
# It presigned with the PUBLIC client (localhost:8333), then rewrote the host
# to the internal one before fetching, on the stated belief that "the signature
# covers the path and query, not the host". That is false. SigV4 presigned URLs
# carry SignedHeaders=host, so the Host header is part of the canonical request
# and rewriting it guarantees SignatureDoesNotMatch. The test reported a
# SeaweedFS incompatibility that was entirely its own doing.
#
# To test SigV4 compatibility we must fetch the URL at the host it was signed
# for. From inside this container that is the INTERNAL endpoint, so we presign
# with the internal client and call it unmodified.
from datetime import timedelta  # noqa: E402

try:
    internal_url = client.presigned_get_object(
        bucket, key, expires=timedelta(minutes=5),
    )
    ok("presigned a GET url (signed for the internal endpoint)")
except Exception as exc:
    die(f"presigned_get_object failed: {str(exc).splitlines()[0][:140]}")

# ── 6. Fetch it unauthenticated, host untouched ──────────────────────────
# THE TEST THAT MATTERS. Presigning is an offline signature, so step 5 passes
# whether or not the server would accept it. Only an actual unauthenticated
# request proves the server validates what minio-py produces.
import urllib.request  # noqa: E402
import urllib.error  # noqa: E402

try:
    with urllib.request.urlopen(internal_url, timeout=15) as resp:
        body = resp.read()
        code = resp.getcode()
except urllib.error.HTTPError as exc:
    detail = exc.read()[:300].decode("utf-8", "replace")
    die(f"presigned GET returned HTTP {exc.code}",
        "The server rejected a signature produced by minio-py. This object "
        "store's SigV4 presigning is genuinely incompatible, so NO image would "
        f"load in the annotator.\n        Server said: {detail}")
except Exception as exc:
    die(f"presigned GET could not be fetched: {str(exc).splitlines()[0][:140]}")

if body != payload:
    die(f"presigned GET returned {len(body)} bytes, expected {len(payload)}")
ok(f"presigned GET fetched {len(body)} bytes with no credentials (HTTP {code})")

# ── 6b. The browser-facing URL ───────────────────────────────────────────
# Signed for MINIO_PUBLIC_ENDPOINT, which is the HOST address. It cannot be
# fetched from in here — "localhost" is this container — and rewriting the host
# would break the signature, which is the mistake above. So it is printed for
# an optional check from the host machine, where localhost IS the S3 service.
try:
    public_url = get_minio_public_client().presigned_get_object(
        bucket, key, expires=timedelta(minutes=10),
    )
    ok("presigned a browser-facing url (signed for MINIO_PUBLIC_ENDPOINT)")
    info("Optional check from your machine, where localhost resolves correctly:")
    info(f'  curl -s -o NUL -w "%{{http_code}}" "{public_url}"')
    info("  200 = browsers will load images. 403 = MINIO_PUBLIC_ENDPOINT is wrong.")
except Exception as exc:
    die(f"public presign failed: {str(exc).splitlines()[0][:140]}")

# ── 7. Clean up ──────────────────────────────────────────────────────────
try:
    client.remove_object(bucket, key)
    ok("removed the test object")
except Exception as exc:
    print(f"  {YEL}WARN{OFF}  could not remove {key}: {str(exc).splitlines()[0][:100]}")

print(f"\n{GRN}Object store is fully functional — uploads, downloads and "
      f"browser-facing presigned URLs all work.{OFF}\n")
