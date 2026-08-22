"""
CLIP Embedding Generator — produces image/text embeddings using OpenAI CLIP
and stores/queries vectors in Qdrant. Supports Intel XPU acceleration.
"""

import io
import logging
import os
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level cache for loaded models
# ---------------------------------------------------------------------------
_MODEL_CACHE: dict[str, tuple] = {}

# Cached Qdrant client + set of collections we have already ensured exist, so we
# do not reconnect / re-check on every batch.
_QDRANT_CLIENT = None
_QDRANT_READY: set = set()


def _get_qdrant_client():
    """Return a process-cached Qdrant client (one connection pool)."""
    global _QDRANT_CLIENT
    if _QDRANT_CLIENT is None:
        from qdrant_client import QdrantClient  # type: ignore
        from core.settings import settings  # type: ignore
        _QDRANT_CLIENT = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)
    return _QDRANT_CLIENT


# ---------------------------------------------------------------------------
# Device detection (Intel XPU > CUDA > CPU)
# ---------------------------------------------------------------------------
def _get_device() -> str:
    try:
        import torch
        try:
            import intel_extension_for_pytorch  # noqa: F401
            if torch.xpu.is_available():
                return "xpu"
        except ImportError:
            pass
        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------
def load_clip_model(
    model_name: str = "openai/clip-vit-base-patch32",
) -> tuple:
    """
    Lazy-load CLIP model and processor, moving to the best available device.

    Returns:
        Tuple of (model, processor, device_str).
    """
    if model_name in _MODEL_CACHE:
        return _MODEL_CACHE[model_name]

    try:
        from transformers import CLIPModel, CLIPProcessor  # type: ignore
        import torch  # noqa: F811
        import torch.nn as nn  # noqa: F811
    except ImportError as exc:
        raise ImportError(
            "transformers and torch are required for CLIP embeddings. "
            "Install with: pip install transformers torch"
        ) from exc

    # Perf knobs from settings (safe defaults if imported outside the app).
    try:
        from core.settings import settings  # type: ignore
        n_threads = int(settings.CLIP_NUM_THREADS) or (os.cpu_count() or 4)
        quantize = bool(settings.CLIP_QUANTIZE)
    except Exception:
        n_threads = os.cpu_count() or 4
        quantize = True

    # Pin CPU threads so a single inference uses all cores deterministically.
    try:
        torch.set_num_threads(int(n_threads))
    except Exception:
        pass

    device = _get_device()
    logger.info(
        "Loading CLIP model '%s' on device '%s' (threads=%s, quantize=%s)",
        model_name, device, n_threads, quantize,
    )

    processor = CLIPProcessor.from_pretrained(model_name)
    model = CLIPModel.from_pretrained(model_name)
    model = model.to(device)
    model.eval()

    # Dynamic int8 quantization: the CLIP transformer is Linear-heavy, so this is
    # a 2-4x CPU speedup (and ~half the RAM). IMPORTANT: quantize_dynamic can
    # SUCCEED at build time but then RAISE on the first forward pass on machines
    # whose torch has no usable quantized engine. That would make embeddings and
    # search fail at runtime even though loading "worked". So we verify the
    # quantized model with a tiny inference and fall back to full precision if it
    # cannot actually run.
    if quantize and device == "cpu":
        try:
            qmodel = torch.quantization.quantize_dynamic(
                model, {nn.Linear}, dtype=torch.qint8,
            )
            with torch.inference_mode():
                probe = processor(text=["ok"], return_tensors="pt", padding=True)
                probe = {k: v.to(device) for k, v in probe.items()}
                qmodel.get_text_features(**probe)
            model = qmodel
            logger.info("Applied + verified dynamic int8 quantization to CLIP (CPU)")
        except Exception as exc:
            logger.warning(
                "CLIP int8 quantization not usable on this machine — using the "
                "full-precision model instead (slower but correct): %s", exc,
            )

    result = (model, processor, device)
    _MODEL_CACHE[model_name] = result
    return result


def clip_model_loaded(model_name: str = "openai/clip-vit-base-patch32") -> bool:
    """True if the model is already loaded in THIS process's memory."""
    return model_name in _MODEL_CACHE


def clip_model_ready(model_name: str = "openai/clip-vit-base-patch32") -> bool:
    """True if the model can be used without a network download — either already
    in memory, or present in the local HuggingFace cache on disk."""
    if model_name in _MODEL_CACHE:
        return True
    try:
        from huggingface_hub import try_to_load_from_cache  # type: ignore
        for fn in ("model.safetensors", "pytorch_model.bin"):
            if isinstance(try_to_load_from_cache(model_name, fn), str):
                return True
    except Exception:
        pass
    return False


_SIZE_CACHE: dict = {}


def expected_model_size(model_name: str = "openai/clip-vit-base-patch32") -> int:
    """Best-effort total bytes HF will download (the weights file it actually
    fetches + small config files), used to show a % during the one-time
    download. Falls back to a known size for the default CLIP model."""
    if model_name in _SIZE_CACHE:
        return _SIZE_CACHE[model_name]
    total = 0
    try:
        from huggingface_hub import model_info  # type: ignore
        info = model_info(model_name, files_metadata=True)
        sizes = {s.rfilename: (s.size or 0) for s in info.siblings}
        weights = 0
        for cand in ("model.safetensors", "pytorch_model.bin"):
            if sizes.get(cand):
                weights = sizes[cand]
                break
        small = sum(
            sz for fn, sz in sizes.items()
            if sz and sz < 50_000_000
            and not fn.endswith((".h5", ".msgpack", ".bin", ".safetensors", ".ot"))
        )
        total = weights + small
    except Exception:
        total = 0
    if not total and "clip-vit-base-patch32" in model_name:
        total = 610_000_000
    if total:
        _SIZE_CACHE[model_name] = total
    return total


def hf_cache_blobs_size(model_name: str = "openai/clip-vit-base-patch32") -> int:
    """Current size (bytes) of the model's blobs in the local HF cache — grows
    as the download proceeds (includes in-flight .incomplete files)."""
    import os
    from pathlib import Path
    repo = "models--" + model_name.replace("/", "--")
    bases = []
    if os.environ.get("HF_HOME"):
        bases.append(Path(os.environ["HF_HOME"]) / "hub")
    if os.environ.get("TRANSFORMERS_CACHE"):
        bases.append(Path(os.environ["TRANSFORMERS_CACHE"]) / "hub")
    bases.append(Path("/opt/hf-cache/hub"))
    bases.append(Path(os.path.expanduser("~/.cache/huggingface/hub")))
    for base in bases:
        blobs = base / repo / "blobs"
        if blobs.exists():
            size = 0
            for f in blobs.iterdir():
                try:
                    size += f.stat().st_size
                except Exception:
                    pass
            return size
    return 0


# ---------------------------------------------------------------------------
# Image embedding
# ---------------------------------------------------------------------------
def embed_images(
    image_bytes_list: list[bytes],
    model_name: str = "openai/clip-vit-base-patch32",
    batch_size: Optional[int] = None,
    return_kept_indices: bool = False,
) -> "np.ndarray | tuple[np.ndarray, list[int]]":
    """
    Generate CLIP embeddings for a list of images.

    Images that cannot be decoded are skipped, so the returned array can have
    FEWER rows than ``image_bytes_list``. Callers that pair embeddings back to
    per-image ids MUST know which inputs were kept — otherwise a single bad
    image shifts every later embedding onto the wrong id. Pass
    ``return_kept_indices=True`` to also receive the list of input indices that
    were actually embedded (aligned 1:1 with the returned rows).

    Args:
        image_bytes_list: List of raw image bytes.
        model_name: HuggingFace model identifier.
        batch_size: Number of images to process per batch.
        return_kept_indices: When True, return ``(embeddings, kept_indices)``
            instead of just ``embeddings`` (default False keeps the original
            return shape for existing callers).

    Returns:
        numpy array of shape (n_kept, embedding_dim); or, when
        ``return_kept_indices`` is True, a tuple of that array and the list of
        indices into ``image_bytes_list`` that were successfully embedded.
    """
    import torch
    from PIL import Image

    if batch_size is None:
        try:
            from core.settings import settings  # type: ignore
            batch_size = int(settings.CLIP_BATCH_SIZE) or 32
        except Exception:
            batch_size = 32

    model, processor, device = load_clip_model(model_name)
    all_embeddings = []
    kept_indices: list[int] = []

    for i in range(0, len(image_bytes_list), batch_size):
        batch_bytes = image_bytes_list[i : i + batch_size]
        images = []
        batch_indices: list[int] = []
        for j, img_bytes in enumerate(batch_bytes):
            try:
                img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                images.append(img)
                batch_indices.append(i + j)
            except Exception as exc:
                logger.warning("Skipping invalid image in batch: %s", exc)
                continue

        if not images:
            continue

        inputs = processor(images=images, return_tensors="pt", padding=True)
        inputs = {k: v.to(device) for k, v in inputs.items()}

        with torch.inference_mode():
            outputs = model.get_image_features(**inputs)
            # L2-normalize embeddings
            embeddings = outputs / outputs.norm(dim=-1, keepdim=True)
            all_embeddings.append(embeddings.cpu().numpy())

        # Record which inputs this batch produced vectors for — only after the
        # batch has actually been encoded — so kept_indices stays aligned 1:1
        # with the stacked embedding rows.
        kept_indices.extend(batch_indices)
        logger.debug("Embedded batch %d-%d", i, i + len(images))

    if not all_embeddings:
        empty = np.empty((0, 512), dtype=np.float32)
        return (empty, kept_indices) if return_kept_indices else empty

    stacked = np.concatenate(all_embeddings, axis=0)
    return (stacked, kept_indices) if return_kept_indices else stacked


# ---------------------------------------------------------------------------
# Text embedding (for text-to-image search)
# ---------------------------------------------------------------------------
def embed_text(
    text: str,
    model_name: str = "openai/clip-vit-base-patch32",
) -> np.ndarray:
    """
    Generate a CLIP text embedding for text-to-image search.

    Args:
        text: Query text string.
        model_name: HuggingFace model identifier.

    Returns:
        numpy array of shape (1, embedding_dim).
    """
    import torch

    model, processor, device = load_clip_model(model_name)

    inputs = processor(text=[text], return_tensors="pt", padding=True)
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.inference_mode():
        outputs = model.get_text_features(**inputs)
        embedding = outputs / outputs.norm(dim=-1, keepdim=True)

    return embedding.cpu().numpy()


# ---------------------------------------------------------------------------
# Qdrant storage
# ---------------------------------------------------------------------------
def store_image_vectors_in_qdrant(
    vectors: np.ndarray,
    asset_ids: list[str],
    collection_name: str,
    metadata_list: Optional[list[dict]] = None,
) -> list[str]:
    """
    Upsert image vectors into a Qdrant collection.

    Creates the collection if it does not already exist (vector size 512,
    cosine distance for ViT-B/32).

    Args:
        vectors: numpy array of shape (n, 512).
        asset_ids: List of unique string IDs for each vector.
        collection_name: Qdrant collection name.
        metadata_list: Optional list of payload dicts per vector.

    Returns:
        List of Qdrant point IDs (same as asset_ids on success, empty on failure).
    """
    try:
        from qdrant_client.models import Distance, VectorParams, PointStruct  # type: ignore
    except ImportError:
        logger.error("qdrant_client not installed — skipping vector storage")
        return []

    try:
        client = _get_qdrant_client()
    except Exception as exc:
        logger.error("Failed to connect to Qdrant: %s", exc)
        return []

    dim = int(vectors.shape[1])

    # Ensure the collection exists once per process (cached), not every batch.
    if collection_name not in _QDRANT_READY:
        try:
            collections = [c.name for c in client.get_collections().collections]
            if collection_name not in collections:
                client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
                )
                logger.info("Created Qdrant collection '%s' (dim=%d)", collection_name, dim)
            _QDRANT_READY.add(collection_name)
        except Exception as exc:
            logger.error("Failed to create collection: %s", exc)
            return []

    # Build points — use asset_ids as point IDs (UUIDs) to avoid collisions
    if metadata_list is None:
        metadata_list = [{} for _ in asset_ids]

    # Guard against any id/vector length mismatch (e.g. an image dropped during
    # decode) so we never index past the embeddings array.
    n = min(len(asset_ids), int(vectors.shape[0]))
    points = [
        PointStruct(
            id=asset_ids[idx],
            vector=vectors[idx].tolist(),
            payload={"asset_id": asset_ids[idx], **metadata_list[idx]},
        )
        for idx in range(n)
    ]

    # Upsert in batches
    try:
        batch_size = 100
        for i in range(0, len(points), batch_size):
            client.upsert(
                collection_name=collection_name,
                points=points[i : i + batch_size],
            )
        logger.info("Upserted %d vectors into '%s'", len(points), collection_name)
        return asset_ids[:n]
    except Exception as exc:
        logger.error("Qdrant upsert failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Similarity search
# ---------------------------------------------------------------------------
def search_similar(
    query_vector: np.ndarray,
    collection_name: str,
    top_k: int = 10,
) -> list[dict]:
    """
    Search for similar images in Qdrant by vector similarity.

    Args:
        query_vector: 1-D numpy array (embedding_dim,) or 2-D (1, dim).
        collection_name: Qdrant collection to search.
        top_k: Number of results to return.

    Returns:
        List of dicts with keys: id, score, payload.
    """
    try:
        client = _get_qdrant_client()
    except Exception as exc:
        logger.error("Failed to connect to Qdrant: %s", exc)
        return []

    # Flatten to 1-D if needed
    vec = query_vector.flatten().tolist()

    try:
        # qdrant-client >= 1.12 removed .search(); use .query_points(). Keep a
        # fallback to .search() for older clients.
        if hasattr(client, "query_points"):
            results = client.query_points(
                collection_name=collection_name,
                query=vec,
                limit=top_k,
                with_payload=True,
            ).points
        else:
            results = client.search(
                collection_name=collection_name,
                query_vector=vec,
                limit=top_k,
            )
        return [
            {"id": hit.id, "score": hit.score, "payload": hit.payload}
            for hit in results
        ]
    except Exception as exc:
        logger.error("Qdrant search failed: %s", exc)
        return []
