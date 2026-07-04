"""
Image Clusterer — groups image embeddings using HDBSCAN density-based clustering.
"""

import logging
from dataclasses import dataclass, field
from collections import Counter

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class ImageClusterReport:
    """Report produced by the image clustering process."""

    n_clusters: int
    method: str = "hdbscan"
    cluster_sizes: dict = field(default_factory=dict)
    noise_count: int = 0
    min_cluster_size: int = 5
    labels: list[int] = field(default_factory=list)


def cluster_images(
    vectors: np.ndarray,
    min_cluster_size: int = 5,
) -> ImageClusterReport:
    """
    Cluster image embedding vectors using HDBSCAN.

    Args:
        vectors: numpy array of shape (n_images, embedding_dim).
        min_cluster_size: Minimum number of points to form a cluster.

    Returns:
        ImageClusterReport with cluster labels and statistics.
    """
    n_samples = vectors.shape[0] if vectors.ndim == 2 else 0

    # Edge case: too few images to cluster
    if n_samples < min_cluster_size:
        logger.warning(
            "Too few images to cluster (%d < min_cluster_size=%d). "
            "Returning all as noise.",
            n_samples, min_cluster_size,
        )
        labels = [-1] * n_samples
        return ImageClusterReport(
            n_clusters=0,
            cluster_sizes={},
            noise_count=n_samples,
            min_cluster_size=min_cluster_size,
            labels=labels,
        )

    try:
        import hdbscan  # type: ignore
    except ImportError as exc:
        raise ImportError(
            "hdbscan is required for image clustering. "
            "Install with: pip install hdbscan"
        ) from exc

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        metric="euclidean",
    )
    clusterer.fit(vectors)
    labels = clusterer.labels_.tolist()

    # Compute statistics
    label_counts = Counter(labels)
    noise_count = label_counts.pop(-1, 0)
    n_clusters = len(label_counts)
    cluster_sizes = {str(k): v for k, v in sorted(label_counts.items())}

    # Edge case: all points classified as noise
    if n_clusters == 0:
        logger.warning(
            "HDBSCAN found no clusters (all %d points are noise). "
            "Consider lowering min_cluster_size (currently %d).",
            n_samples, min_cluster_size,
        )

    logger.info(
        "HDBSCAN clustering complete: %d clusters, %d noise points (n=%d)",
        n_clusters, noise_count, n_samples,
    )

    return ImageClusterReport(
        n_clusters=n_clusters,
        cluster_sizes=cluster_sizes,
        noise_count=noise_count,
        min_cluster_size=min_cluster_size,
        labels=labels,
    )
