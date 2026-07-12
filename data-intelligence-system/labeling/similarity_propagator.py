"""
Similarity-Based Label Propagation — propagates labels from labeled to unlabeled items
using vector embeddings and nearest-neighbor search.
"""

import logging
from collections import Counter
from dataclasses import dataclass, asdict

import core.paths  # noqa: F401

from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchAny

from core.settings import settings

logger = logging.getLogger(__name__)


# ── Data classes ───────────────────────────────────────────────────────

@dataclass
class PropagationResult:
    """Result of propagating a label to a single unlabeled item."""
    item_id: str
    propagated_label: str
    confidence: float
    source_id: str
    similarity_score: float


@dataclass
class PropagationReport:
    """Summary report from similarity-based label propagation."""
    total_unlabeled: int
    propagated_count: int
    skipped_count: int
    results: list[PropagationResult]
    confidence_threshold: float
    top_k: int

    def to_dict(self):
        return asdict(self)


# ── Propagation engine ────────────────────────────────────────────────

def propagate_labels(
    labeled_items: list[dict],
    unlabeled_ids: list[str],
    collection_name: str,
    confidence_threshold: float = 0.7,
    top_k: int = 5,
) -> PropagationReport:
    """Propagate labels from labeled items to unlabeled items via vector similarity.

    For each unlabeled item, the function queries the Qdrant collection for
    its ``top_k`` nearest neighbors among the labeled items. If the neighbors
    agree on a label and the weighted similarity score exceeds the threshold,
    the label is propagated.

    Args:
        labeled_items: List of dicts with keys ``"id"`` (str), ``"label"`` (str),
            and optionally ``"vector"`` (list[float]).  The ``"id"`` must match
            point IDs stored in Qdrant.
        unlabeled_ids: Point IDs of items that need labels.
        collection_name: Qdrant collection to search in.
        confidence_threshold: Minimum weighted confidence to accept a propagation.
        top_k: Number of nearest neighbors to consider.

    Returns:
        A :class:`PropagationReport` summarising the propagation.
    """
    if not labeled_items or not unlabeled_ids:
        logger.info(
            "Nothing to propagate (labeled=%d, unlabeled=%d).",
            len(labeled_items), len(unlabeled_ids),
        )
        return PropagationReport(
            total_unlabeled=len(unlabeled_ids),
            propagated_count=0,
            skipped_count=len(unlabeled_ids),
            results=[],
            confidence_threshold=confidence_threshold,
            top_k=top_k,
        )

    # Build a lookup from ID -> label for the labeled items
    label_lookup: dict[str, str] = {
        item["id"]: item["label"] for item in labeled_items if "id" in item and "label" in item
    }
    labeled_id_set = set(label_lookup.keys())

    if not label_lookup:
        logger.warning("No valid labeled items (need 'id' and 'label' keys).")
        return PropagationReport(
            total_unlabeled=len(unlabeled_ids),
            propagated_count=0,
            skipped_count=len(unlabeled_ids),
            results=[],
            confidence_threshold=confidence_threshold,
            top_k=top_k,
        )

    # Connect to Qdrant
    try:
        client = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)
    except Exception as exc:
        logger.error("Failed to connect to Qdrant: %s", exc, exc_info=True)
        return PropagationReport(
            total_unlabeled=len(unlabeled_ids),
            propagated_count=0,
            skipped_count=len(unlabeled_ids),
            results=[],
            confidence_threshold=confidence_threshold,
            top_k=top_k,
        )

    results: list[PropagationResult] = []
    skipped = 0

    for uid in unlabeled_ids:
        try:
            # Retrieve the unlabeled point's vector
            points = client.retrieve(
                collection_name=collection_name,
                ids=[uid],
                with_vectors=True,
            )
            if not points or not points[0].vector:
                logger.debug("No vector found for unlabeled item '%s' — skipping.", uid)
                skipped += 1
                continue

            query_vector = points[0].vector

            # Search for nearest labeled neighbors
            search_results = client.search(
                collection_name=collection_name,
                query_vector=query_vector,
                limit=top_k + 1,  # +1 in case the point itself is returned
                with_payload=True,
            )

            # Filter to only labeled neighbors (exclude self)
            neighbors = []
            for hit in search_results:
                hit_id = str(hit.id)
                if hit_id in labeled_id_set and hit_id != uid:
                    neighbors.append((hit_id, hit.score))
                if len(neighbors) >= top_k:
                    break

            if not neighbors:
                logger.debug("No labeled neighbors for item '%s' — skipping.", uid)
                skipped += 1
                continue

            # Weighted majority vote
            label_weights: dict[str, float] = {}
            label_best_source: dict[str, tuple[str, float]] = {}

            for neighbor_id, similarity in neighbors:
                neighbor_label = label_lookup[neighbor_id]
                label_weights[neighbor_label] = label_weights.get(neighbor_label, 0.0) + similarity
                # Track the highest-similarity source for each label
                if neighbor_label not in label_best_source or similarity > label_best_source[neighbor_label][1]:
                    label_best_source[neighbor_label] = (neighbor_id, similarity)

            # Pick the label with the highest total weight
            best_label = max(label_weights, key=label_weights.get)
            total_weight = sum(label_weights.values())
            confidence = label_weights[best_label] / total_weight if total_weight > 0 else 0.0

            if confidence < confidence_threshold:
                logger.debug(
                    "Item '%s': best label '%s' confidence %.3f below threshold %.3f — skipping.",
                    uid, best_label, confidence, confidence_threshold,
                )
                skipped += 1
                continue

            best_source_id, best_similarity = label_best_source[best_label]

            results.append(PropagationResult(
                item_id=uid,
                propagated_label=best_label,
                confidence=round(confidence, 4),
                source_id=best_source_id,
                similarity_score=round(best_similarity, 4),
            ))

        except Exception as exc:
            logger.warning(
                "Error propagating label for item '%s': %s", uid, exc, exc_info=True
            )
            skipped += 1

    propagated_count = len(results)
    logger.info(
        "Label propagation complete: %d/%d items propagated, %d skipped "
        "(threshold=%.2f, top_k=%d).",
        propagated_count, len(unlabeled_ids), skipped,
        confidence_threshold, top_k,
    )

    return PropagationReport(
        total_unlabeled=len(unlabeled_ids),
        propagated_count=propagated_count,
        skipped_count=skipped,
        results=results,
        confidence_threshold=confidence_threshold,
        top_k=top_k,
    )
