"""
Clustering Engine — groups similar rows using K-Means with PCA reduction.
"""

import logging
from dataclasses import dataclass, asdict

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score as sk_silhouette_score
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)


@dataclass
class ClusterReport:
    """Results of a clustering run."""
    n_clusters: int
    method: str  # e.g. "kmeans"
    silhouette_score: float
    inertia: float
    cluster_sizes: dict  # cluster_id -> count
    cluster_centers: list  # list of lists (one center per cluster)
    pca_variance_explained: list  # variance ratio per PCA component (empty if PCA not used)
    feature_columns_used: list  # column names that went into clustering

    def to_dict(self):
        return asdict(self)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_clustering(
    df: pd.DataFrame,
    n_clusters: int = 5,
    max_features: int = 50,
) -> ClusterReport:
    """Run K-Means clustering on the numeric columns of *df*.

    Args:
        df: Source DataFrame.
        n_clusters: Desired number of clusters.
        max_features: If the number of numeric columns exceeds this, PCA is
            used to reduce dimensionality first.

    Returns:
        ClusterReport with cluster assignments and diagnostics.
    """
    # --- Select numeric columns ---
    numeric_df = df.select_dtypes(include=[np.number]).copy()

    if numeric_df.shape[1] == 0:
        logger.warning("No numeric columns found — cannot cluster")
        return ClusterReport(
            n_clusters=0,
            method="kmeans",
            silhouette_score=-1.0,
            inertia=0.0,
            cluster_sizes={},
            cluster_centers=[],
            pca_variance_explained=[],
            feature_columns_used=[],
        )

    feature_columns = numeric_df.columns.tolist()
    logger.info("Clustering with %d numeric columns, %d rows", len(feature_columns), len(numeric_df))

    # Fill NaN with 0
    numeric_df = numeric_df.fillna(0)

    # --- Edge case: too few rows ---
    unique_rows = len(numeric_df.drop_duplicates())
    if unique_rows < 2:
        logger.warning("Too few unique rows (%d) for clustering", unique_rows)
        return ClusterReport(
            n_clusters=0,
            method="kmeans",
            silhouette_score=-1.0,
            inertia=0.0,
            cluster_sizes={},
            cluster_centers=[],
            pca_variance_explained=[],
            feature_columns_used=feature_columns,
        )

    # Clamp n_clusters to not exceed unique rows
    effective_clusters = min(n_clusters, unique_rows)
    if effective_clusters < 2:
        effective_clusters = 2
    if effective_clusters != n_clusters:
        logger.info("Adjusted n_clusters from %d to %d (unique rows: %d)", n_clusters, effective_clusters, unique_rows)

    # --- Scale ---
    scaler = StandardScaler()
    scaled = scaler.fit_transform(numeric_df)

    # --- PCA if needed ---
    pca_variance: list[float] = []
    if numeric_df.shape[1] > max_features:
        n_components = min(effective_clusters * 2, numeric_df.shape[1], len(numeric_df))
        logger.info("Reducing %d features to %d via PCA", numeric_df.shape[1], n_components)
        pca = PCA(n_components=n_components, random_state=42)
        scaled = pca.fit_transform(scaled)
        pca_variance = [round(float(v), 6) for v in pca.explained_variance_ratio_]

    # --- KMeans ---
    kmeans = KMeans(
        n_clusters=effective_clusters,
        n_init=10,
        max_iter=300,
        random_state=42,
    )
    labels = kmeans.fit_predict(scaled)

    # --- Silhouette (requires >= 2 clusters and >= 2 distinct labels) ---
    unique_labels = len(set(labels))
    if unique_labels >= 2 and len(labels) > unique_labels:
        sil_score = round(float(sk_silhouette_score(scaled, labels)), 6)
    else:
        sil_score = -1.0
        logger.warning("Could not compute silhouette score (unique labels: %d)", unique_labels)

    # --- Cluster sizes ---
    cluster_sizes = {}
    for cid in range(effective_clusters):
        cluster_sizes[int(cid)] = int((labels == cid).sum())

    # --- Cluster centers ---
    centers = [
        [round(float(v), 6) for v in center]
        for center in kmeans.cluster_centers_
    ]

    report = ClusterReport(
        n_clusters=effective_clusters,
        method="kmeans",
        silhouette_score=sil_score,
        inertia=round(float(kmeans.inertia_), 4),
        cluster_sizes=cluster_sizes,
        cluster_centers=centers,
        pca_variance_explained=pca_variance,
        feature_columns_used=feature_columns,
    )

    logger.info(
        "Clustering complete — %d clusters, silhouette=%.4f, inertia=%.2f",
        effective_clusters, sil_score, kmeans.inertia_,
    )
    return report
