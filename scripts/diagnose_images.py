#!/usr/bin/env python3
"""
Orchestraty image-pipeline diagnostic.

Runs every stage of the image pipeline in isolation and prints a clear
PASS / FAIL report so we can see exactly what is broken.

Run inside the WORKER container (that is where embeddings actually execute):

    docker compose -f infrastructure/docker-compose.yml exec celery-worker \
        python /app/scripts/diagnose_images.py [DATASET_ID]

DATASET_ID is optional. If given, the script also does a real end-to-end embed
of that dataset's first few images (download from MinIO -> CLIP -> Qdrant).
"""
import io
import os
import sys
import time
import traceback

# Make the app importable no matter how this script is launched: when you run a
# file by absolute path, Python only adds that file's own folder (/app/scripts)
# to sys.path, not the repo root (/app) -- so add the repo root explicitly.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import core.paths  # noqa: F401,E402  -- puts image_pipeline on sys.path

report = []


def section(title):
    print("\n" + "=" * 64)
    print(title)
    print("=" * 64, flush=True)


def record(name, good, detail=""):
    report.append((name, bool(good)))
    print(("[ OK ] " if good else "[FAIL] ") + name + (f" -- {detail}" if detail else ""), flush=True)


def err(e):
    print("       ERROR:", repr(e), flush=True)


def main():
    dataset_id = sys.argv[1] if len(sys.argv) > 1 else None
    settings = None
    mc = None
    qc = None
    vecs = None

    # 1. settings
    section("1. Settings")
    try:
        from core.settings import settings as _s
        settings = _s
        import os
        print("   CLIP_MODEL_NAME   :", settings.CLIP_MODEL_NAME)
        print("   CLIP_QUANTIZE     :", getattr(settings, "CLIP_QUANTIZE", "?"))
        print("   QDRANT host:port  :", f"{settings.QDRANT_HOST}:{settings.QDRANT_PORT}")
        print("   MINIO_ENDPOINT    :", settings.MINIO_ENDPOINT)
        print("   MINIO_BUCKET_NAME :", settings.MINIO_BUCKET_NAME)
        print("   REDIS_URL         :", settings.REDIS_URL)
        print("   HF_HOME (env)     :", os.environ.get("HF_HOME", "(unset)"))
        record("settings load", True)
    except Exception as e:
        record("settings load", False); err(e); traceback.print_exc(); return

    # 2. dependencies
    section("2. Python dependencies")
    for mod in ("torch", "transformers", "huggingface_hub", "PIL", "numpy",
                "qdrant_client", "minio", "redis", "hdbscan"):
        try:
            m = __import__(mod)
            record(f"import {mod}", True, f"v{getattr(m, '__version__', '?')}")
        except Exception as e:
            record(f"import {mod}", False); err(e)

    # 3. Redis
    section("3. Redis")
    try:
        import redis
        redis.from_url(settings.REDIS_URL).ping()
        record("redis ping", True)
    except Exception as e:
        record("redis ping", False); err(e)

    # 4. MinIO
    section("4. MinIO (object storage)")
    try:
        from core.storage import get_minio_client
        mc = get_minio_client()
        buckets = [b.name for b in mc.list_buckets()]
        record("minio connect", True, f"buckets={buckets}")
        record(f"bucket '{settings.MINIO_BUCKET_NAME}' exists",
               mc.bucket_exists(settings.MINIO_BUCKET_NAME))
    except Exception as e:
        record("minio connect", False); err(e); mc = None

    # 5. Qdrant
    section("5. Qdrant (vector DB)")
    try:
        from qdrant_client import QdrantClient
        qc = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT, timeout=15)
        cols = [c.name for c in qc.get_collections().collections]
        record("qdrant connect", True, f"collections={cols}")
    except Exception as e:
        record("qdrant connect", False); err(e); qc = None

    # 6. CLIP model load
    section("6. CLIP model load")
    try:
        from image_pipeline.clip_embedder import clip_model_ready, load_clip_model
        print("   clip_model_ready():", clip_model_ready(settings.CLIP_MODEL_NAME))
        t = time.time()
        _, _, device = load_clip_model(settings.CLIP_MODEL_NAME)
        record("load_clip_model", True, f"device={device}, {time.time()-t:.1f}s")
    except Exception as e:
        record("load_clip_model", False); err(e); traceback.print_exc()

    # 7. test embedding (synthetic image) -- exercises the quantization path
    section("7. Test image embedding (synthetic)")
    try:
        from PIL import Image
        from image_pipeline.clip_embedder import embed_images
        buf = io.BytesIO(); Image.new("RGB", (96, 96), (90, 160, 220)).save(buf, format="PNG")
        t = time.time()
        vecs = embed_images([buf.getvalue()])
        shape = getattr(vecs, "shape", None)
        record("embed_images", vecs is not None and shape and shape[0] == 1,
               f"shape={shape}, {time.time()-t:.1f}s")
    except Exception as e:
        record("embed_images", False); err(e); traceback.print_exc()

    # 8. Qdrant store + text-search round trip
    section("8. Qdrant store + text search round-trip")
    try:
        import uuid
        from image_pipeline.clip_embedder import (
            store_image_vectors_in_qdrant, embed_text, search_similar)
        if vecs is None:
            raise RuntimeError("no image vector available from step 7")
        coll = "diagnostic_selftest"
        stored = store_image_vectors_in_qdrant(vecs, [str(uuid.uuid4())], coll)
        record("store_image_vectors_in_qdrant", bool(stored), f"stored={stored}")
        qv = embed_text("a blue square", model_name=settings.CLIP_MODEL_NAME)
        hits = search_similar(qv, coll, top_k=1)
        record("search_similar", len(hits) > 0, f"hits={len(hits)}")
        if qc is not None:
            try: qc.delete_collection(coll)
            except Exception: pass
    except Exception as e:
        record("qdrant round-trip", False); err(e); traceback.print_exc()

    # 8b. Clustering on existing vectors (scroll + HDBSCAN)
    section("8b. Clustering (HDBSCAN) on existing vectors")
    try:
        import numpy as np
        from image_pipeline.image_clusterer import cluster_images
        coll = None
        if qc is not None:
            for c in qc.get_collections().collections:
                if c.name.endswith("_images"):
                    coll = c.name
                    break
        if not coll:
            record("clustering", False, "no *_images collection found to cluster")
        else:
            pts, offset = [], None
            while True:
                res, nxt = qc.scroll(collection_name=coll, limit=256,
                                     offset=offset, with_vectors=True)
                pts.extend(res)
                if nxt is None:
                    break
                offset = nxt
            arr = np.array([p.vector for p in pts])
            rep = cluster_images(arr, 5)
            record("clustering", True,
                   f"{len(pts)} vectors -> {rep.n_clusters} clusters, {rep.noise_count} noise")
    except Exception as e:
        record("clustering", False); err(e); traceback.print_exc()

    # 9. DB -- image datasets & embedding coverage
    section("9. Database -- images & embedding coverage")
    try:
        from core.database_sync import SyncSessionLocal
        from core.models.image_asset import ImageAsset
        from sqlalchemy import func
        db = SyncSessionLocal()
        try:
            rows = (db.query(ImageAsset.dataset_id,
                             func.count(ImageAsset.id),
                             func.count(ImageAsset.embedding_id))
                    .group_by(ImageAsset.dataset_id).all())
            if not rows:
                print("   (no image assets in the database yet)")
            for did, n, emb in rows:
                print(f"   dataset {did}:  {n} images,  {emb} embedded")
            record("db query image assets", True, f"{len(rows)} image dataset(s)")
        finally:
            db.close()
    except Exception as e:
        record("db query image assets", False); err(e); traceback.print_exc()

    # 10. optional end-to-end for a specific dataset
    if dataset_id and mc is not None:
        section(f"10. End-to-end embed of dataset {dataset_id}")
        try:
            from core.database_sync import SyncSessionLocal
            from core.models.image_asset import ImageAsset
            from image_pipeline.clip_embedder import embed_images, store_image_vectors_in_qdrant
            db = SyncSessionLocal()
            try:
                imgs = db.query(ImageAsset).filter(
                    ImageAsset.dataset_id == dataset_id).limit(3).all()
                metas = [(str(i.id), i.original_path) for i in imgs]
            finally:
                db.close()
            print(f"   found {len(metas)} image row(s)")
            if not metas:
                record("dataset has images", False, "no ImageAsset rows for that id")
            else:
                raws = []
                for _aid, path in metas:
                    r = mc.get_object(settings.MINIO_BUCKET_NAME, path)
                    try: raws.append(r.read())
                    finally: r.close(); r.release_conn()
                record("download from MinIO", True, f"{len(raws)} file(s)")
                v = embed_images(raws)
                record("embed dataset images", v is not None and v.shape[0] == len(raws),
                       f"shape={getattr(v, 'shape', None)}")
                stored = store_image_vectors_in_qdrant(
                    v, [m[0] for m in metas], f"{dataset_id}_images")
                record("store dataset vectors", bool(stored),
                       f"stored={len(stored) if stored else 0}")
        except Exception as e:
            record("end-to-end dataset embed", False); err(e); traceback.print_exc()
    elif not dataset_id:
        print("\n(Tip: pass a DATASET_ID as an argument to also test a real dataset.)")

    # summary
    section("SUMMARY")
    passed = sum(1 for _, g in report if g)
    for name, good in report:
        print(("[ OK ] " if good else "[FAIL] ") + name)
    print(f"\n{passed}/{len(report)} checks passed.", flush=True)
    bad = [n for n, g in report if not g]
    if bad:
        print("FAILED: " + ", ".join(bad))
    else:
        print("Everything the diagnostic can reach is working.")


if __name__ == "__main__":
    main()
