"""
Embedding Generator — creates vector representations of text columns.
Uses sentence-transformers when available, falls back to TF-IDF.
"""

import logging
from dataclasses import dataclass, asdict
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy / optional imports
# ---------------------------------------------------------------------------
_SENTENCE_TRANSFORMERS_AVAILABLE = False
try:
    from sentence_transformers import SentenceTransformer  # type: ignore
    _SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    pass

_QDRANT_AVAILABLE = False
try:
    from qdrant_client import QdrantClient  # type: ignore
    from qdrant_client.models import Distance, VectorParams, PointStruct  # type: ignore
    _QDRANT_AVAILABLE = True
except ImportError:
    pass


@dataclass
class EmbeddingReport:
    """Summary of the embedding generation run."""
    method_used: str
    columns_embedded: list
    total_vectors: int
    vector_dimension: int
    qdrant_collection: Optional[str]

    def to_dict(self):
        return asdict(self)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _detect_text_columns(df: pd.DataFrame, min_avg_length: int = 20) -> list[str]:
    """Return column names that look like free-text (object dtype, avg len > threshold)."""
    text_cols: list[str] = []
    for col in df.columns:
        if df[col].dtype != object:
            continue
        non_null = df[col].dropna()
        if len(non_null) == 0:
            continue
        avg_len = non_null.astype(str).str.len().mean()
        if avg_len > min_avg_length:
            text_cols.append(col)
    return text_cols


def _embed_sentence_transformers(texts: list[str], model_name: str = "all-MiniLM-L6-v2") -> np.ndarray:
    """Generate embeddings using sentence-transformers."""
    logger.info("Loading sentence-transformers model '%s'", model_name)
    model = SentenceTransformer(model_name)
    embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
    return embeddings  # type: ignore[return-value]


def _embed_tfidf(texts: list[str], n_components: int = 128) -> np.ndarray:
    """Fallback: TF-IDF + TruncatedSVD to produce fixed-dimension vectors."""
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.decomposition import TruncatedSVD

    logger.info("Using TF-IDF + TruncatedSVD (n_components=%d) fallback", n_components)
    vectorizer = TfidfVectorizer(max_features=5000, stop_words="english")
    tfidf_matrix = vectorizer.fit_transform(texts)

    # SVD components cannot exceed min(n_samples, n_features) - 1
    actual_components = min(n_components, tfidf_matrix.shape[0] - 1, tfidf_matrix.shape[1] - 1)
    if actual_components < 1:
        actual_components = 1

    svd = TruncatedSVD(n_components=actual_components, random_state=42)
    reduced = svd.fit_transform(tfidf_matrix)
    return reduced


def _store_in_qdrant(
    vectors: np.ndarray,
    collection_name: str,
    texts: list[str],
) -> bool:
    """Attempt to upsert vectors into a Qdrant collection. Returns True on success."""
    if not _QDRANT_AVAILABLE:
        logger.debug("qdrant_client not installed — skipping vector storage")
        return False

    try:
        from core.settings import settings  # type: ignore

        client = QdrantClient(
            host=settings.QDRANT_HOST,
            port=settings.QDRANT_PORT,
        )

        dim = int(vectors.shape[1])

        # Recreate collection (idempotent for this dataset version)
        client.recreate_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
        )

        points = [
            PointStruct(
                id=idx,
                vector=vec.tolist(),
                payload={"text": text[:500]},  # truncate long text in payload
            )
            for idx, (vec, text) in enumerate(zip(vectors, texts))
        ]

        # Upsert in batches of 256
        batch_size = 256
        for start in range(0, len(points), batch_size):
            client.upsert(
                collection_name=collection_name,
                points=points[start : start + batch_size],
            )

        logger.info(
            "Stored %d vectors in Qdrant collection '%s'",
            len(points),
            collection_name,
        )
        return True

    except Exception as exc:
        logger.warning("Qdrant storage failed (non-fatal): %s", exc)
        return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_embeddings(
    df: pd.DataFrame,
    dataset_id: str,
    version_number: int,
) -> EmbeddingReport:
    """Generate embeddings for all detected text columns in *df*.

    Args:
        df: Source DataFrame.
        dataset_id: Unique identifier for the dataset.
        version_number: Dataset version (used in collection naming).

    Returns:
        EmbeddingReport summarising what was embedded and where it was stored.
    """
    text_cols = _detect_text_columns(df)

    if not text_cols:
        logger.info("No text columns detected — nothing to embed")
        return EmbeddingReport(
            method_used="none",
            columns_embedded=[],
            total_vectors=0,
            vector_dimension=0,
            qdrant_collection=None,
        )

    logger.info("Text columns detected for embedding: %s", text_cols)

    method = "sentence-transformers" if _SENTENCE_TRANSFORMERS_AVAILABLE else "tfidf-svd"
    total_vectors = 0
    vector_dim = 0
    qdrant_collection: Optional[str] = None

    for col in text_cols:
        texts = df[col].dropna().astype(str).tolist()
        if not texts:
            continue

        # Generate vectors
        if _SENTENCE_TRANSFORMERS_AVAILABLE:
            vectors = _embed_sentence_transformers(texts)
        else:
            vectors = _embed_tfidf(texts)

        vector_dim = int(vectors.shape[1])
        total_vectors += len(vectors)

        # Try storing in Qdrant
        col_collection = f"{dataset_id}_{col}"
        stored = _store_in_qdrant(vectors, col_collection, texts)
        if stored:
            qdrant_collection = col_collection  # record last successful collection

        logger.info(
            "Embedded column '%s': %d vectors of dim %d (method=%s, qdrant=%s)",
            col, len(vectors), vector_dim, method, stored,
        )

    report = EmbeddingReport(
        method_used=method,
        columns_embedded=text_cols,
        total_vectors=total_vectors,
        vector_dimension=vector_dim,
        qdrant_collection=qdrant_collection,
    )

    logger.info("Embedding complete — %s", report.to_dict())
    return report
