"""
Label Aggregator — merges labels from rule-based, AI prediction, and similarity propagation
sources with confidence-weighted voting.
"""

import logging
from collections import Counter
from dataclasses import dataclass, field, asdict
from typing import Any

logger = logging.getLogger(__name__)


# ── Data classes ───────────────────────────────────────────────────────

@dataclass
class LabelSource:
    """A label contributed by a single source."""
    source_type: str  # "rule", "ai", "propagation", "manual"
    label: str
    confidence: float
    metadata: dict = field(default_factory=dict)


@dataclass
class AggregatedLabel:
    """The final merged label for an item after aggregation."""
    final_label: str
    confidence: float
    sources: list[LabelSource]
    agreement_score: float


@dataclass
class AggregationReport:
    """Summary report from label aggregation across multiple sources."""
    total_items: int
    labeled_count: int
    multi_source_count: int
    single_source_count: int
    conflict_count: int
    labels: dict  # item_id -> AggregatedLabel
    label_distribution: dict  # label -> count

    def to_dict(self) -> dict:
        """Return a JSON-serializable representation."""
        labels_serialized = {}
        for item_id, agg in self.labels.items():
            labels_serialized[item_id] = {
                "final_label": agg.final_label,
                "confidence": agg.confidence,
                "agreement_score": agg.agreement_score,
                "sources": [asdict(s) for s in agg.sources],
            }
        return {
            "total_items": self.total_items,
            "labeled_count": self.labeled_count,
            "multi_source_count": self.multi_source_count,
            "single_source_count": self.single_source_count,
            "conflict_count": self.conflict_count,
            "labels": labels_serialized,
            "label_distribution": self.label_distribution,
        }


# ── Aggregation strategies ────────────────────────────────────────────

_VALID_STRATEGIES = {"confidence_weighted", "majority_vote", "priority"}

_SOURCE_PRIORITY = {
    "manual": 0,
    "rule": 1,
    "ai": 2,
    "propagation": 3,
}


def _aggregate_confidence_weighted(sources: list[LabelSource]) -> tuple[str, float]:
    """Pick the label with the highest sum of confidence scores."""
    label_weights: dict[str, float] = {}
    for src in sources:
        label_weights[src.label] = label_weights.get(src.label, 0.0) + src.confidence

    best_label = max(label_weights, key=label_weights.get)
    total_weight = sum(label_weights.values())
    confidence = label_weights[best_label] / total_weight if total_weight > 0 else 0.0
    return best_label, confidence


def _aggregate_majority_vote(sources: list[LabelSource]) -> tuple[str, float]:
    """Simple majority vote; ties broken by highest individual confidence."""
    label_counts: Counter = Counter(src.label for src in sources)
    max_count = label_counts.most_common(1)[0][1]

    # Get all labels tied at max_count
    tied_labels = [lbl for lbl, cnt in label_counts.items() if cnt == max_count]

    if len(tied_labels) == 1:
        best_label = tied_labels[0]
    else:
        # Break tie by highest individual confidence among tied labels
        best_label = max(
            tied_labels,
            key=lambda lbl: max(
                src.confidence for src in sources if src.label == lbl
            ),
        )

    confidence = label_counts[best_label] / len(sources) if sources else 0.0
    return best_label, confidence


def _aggregate_priority(sources: list[LabelSource]) -> tuple[str, float]:
    """Use the source with the highest priority (lowest priority number wins)."""
    sorted_sources = sorted(
        sources,
        key=lambda s: _SOURCE_PRIORITY.get(s.source_type, 99),
    )
    winner = sorted_sources[0]
    return winner.label, winner.confidence


# ── Main aggregation ──────────────────────────────────────────────────

def aggregate_labels(
    item_labels: dict[str, list[LabelSource]],
    strategy: str = "confidence_weighted",
) -> AggregationReport:
    """Merge labels from multiple sources into a single label per item.

    Args:
        item_labels: Mapping of ``item_id`` to a list of :class:`LabelSource`
            objects contributed by different labeling systems.
        strategy: Aggregation strategy — one of ``"confidence_weighted"``,
            ``"majority_vote"``, or ``"priority"``.

    Returns:
        An :class:`AggregationReport` with the final labels and statistics.
    """
    if strategy not in _VALID_STRATEGIES:
        raise ValueError(
            f"Unknown aggregation strategy '{strategy}'. "
            f"Choose from: {sorted(_VALID_STRATEGIES)}"
        )

    if not item_labels:
        logger.info("No items to aggregate — returning empty report.")
        return AggregationReport(
            total_items=0,
            labeled_count=0,
            multi_source_count=0,
            single_source_count=0,
            conflict_count=0,
            labels={},
            label_distribution={},
        )

    strategy_fn = {
        "confidence_weighted": _aggregate_confidence_weighted,
        "majority_vote": _aggregate_majority_vote,
        "priority": _aggregate_priority,
    }[strategy]

    aggregated: dict[str, AggregatedLabel] = {}
    label_distribution: dict[str, int] = {}
    multi_source_count = 0
    single_source_count = 0
    conflict_count = 0
    labeled_count = 0

    for item_id, sources in item_labels.items():
        if not sources:
            logger.debug("Item '%s' has no label sources — skipping.", item_id)
            continue

        # Filter out sources with empty labels
        valid_sources = [s for s in sources if s.label]
        if not valid_sources:
            logger.debug("Item '%s' has no valid labels — skipping.", item_id)
            continue

        # Detect conflicts (multiple distinct labels)
        distinct_labels = set(s.label for s in valid_sources)
        has_conflict = len(distinct_labels) > 1
        if has_conflict:
            conflict_count += 1

        # Track source counts
        if len(valid_sources) > 1:
            multi_source_count += 1
        else:
            single_source_count += 1

        # Run the strategy
        final_label, confidence = strategy_fn(valid_sources)

        # Agreement score: fraction of sources that agree with the final label
        agreeing = sum(1 for s in valid_sources if s.label == final_label)
        agreement_score = agreeing / len(valid_sources)

        aggregated[item_id] = AggregatedLabel(
            final_label=final_label,
            confidence=round(confidence, 4),
            sources=valid_sources,
            agreement_score=round(agreement_score, 4),
        )

        label_distribution[final_label] = label_distribution.get(final_label, 0) + 1
        labeled_count += 1

    logger.info(
        "Label aggregation complete (%s): %d/%d items labeled, "
        "%d multi-source, %d conflicts.",
        strategy, labeled_count, len(item_labels),
        multi_source_count, conflict_count,
    )

    return AggregationReport(
        total_items=len(item_labels),
        labeled_count=labeled_count,
        multi_source_count=multi_source_count,
        single_source_count=single_source_count,
        conflict_count=conflict_count,
        labels=aggregated,
        label_distribution=label_distribution,
    )


# ── Active learning candidate selection ───────────────────────────────

def active_learning_candidates(
    item_labels: dict[str, list[LabelSource]],
    top_n: int = 20,
) -> list[dict]:
    """Identify items that would benefit most from human review.

    Items are ranked by an uncertainty score that combines low confidence
    and high disagreement between sources.

    Args:
        item_labels: Mapping of ``item_id`` to label sources (same format
            as :func:`aggregate_labels`).
        top_n: Maximum number of candidates to return.

    Returns:
        A list of dicts with keys ``"item_id"``, ``"uncertainty_score"``,
        and ``"conflicting_labels"``, sorted by descending uncertainty.
    """
    if not item_labels:
        return []

    candidates: list[dict] = []

    for item_id, sources in item_labels.items():
        valid_sources = [s for s in sources if s.label]
        if not valid_sources:
            # No labels at all — maximum uncertainty
            candidates.append({
                "item_id": item_id,
                "uncertainty_score": 1.0,
                "conflicting_labels": [],
            })
            continue

        distinct_labels = sorted(set(s.label for s in valid_sources))

        # Disagreement component: proportion of sources NOT agreeing with majority
        label_counts = Counter(s.label for s in valid_sources)
        majority_count = label_counts.most_common(1)[0][1]
        disagreement = 1.0 - (majority_count / len(valid_sources))

        # Confidence component: inverse of average confidence
        avg_confidence = sum(s.confidence for s in valid_sources) / len(valid_sources)
        low_confidence = 1.0 - avg_confidence

        # Combined uncertainty (equal weighting)
        uncertainty = 0.5 * disagreement + 0.5 * low_confidence

        conflicting = distinct_labels if len(distinct_labels) > 1 else []

        candidates.append({
            "item_id": item_id,
            "uncertainty_score": round(uncertainty, 4),
            "conflicting_labels": conflicting,
        })

    # Sort by uncertainty descending, take top_n
    candidates.sort(key=lambda c: c["uncertainty_score"], reverse=True)
    return candidates[:top_n]
