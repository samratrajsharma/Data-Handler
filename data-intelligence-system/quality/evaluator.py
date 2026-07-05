"""
Dataset Quality Evaluator — scores labeled datasets on coverage, balance,
confidence, consistency, and completeness.
"""

import logging
import math
from collections import Counter
from dataclasses import asdict, dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class QualityDimension:
    """A single quality dimension with its score and metadata."""

    name: str
    score: float  # 0-100
    weight: float
    details: str
    metrics: dict = field(default_factory=dict)


@dataclass
class QualityReport:
    """Comprehensive quality report for a labeled dataset."""

    overall_score: float  # 0-100
    grade: str  # A-F
    dimensions: list[QualityDimension] = field(default_factory=list)
    total_items: int = 0
    labeled_items: int = 0
    label_coverage: float = 0.0
    recommendations: list[str] = field(default_factory=list)
    summary: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def evaluate_label_quality(
    labels: list[dict],
    total_items: int,
    label_list: list[str] | None = None,
) -> QualityReport:
    """Evaluate overall quality of a labeled dataset.

    Args:
        labels: List of dicts with at minimum:
            {"item_id": str, "label": str, "confidence": float, "source": str}
        total_items: Total number of items in the dataset (labeled + unlabeled).
        label_list: Optional list of expected labels for completeness scoring.

    Returns:
        QualityReport with scores across all quality dimensions.
    """
    logger.info(
        "Evaluating label quality for %d labels across %d total items",
        len(labels),
        total_items,
    )

    if total_items <= 0:
        logger.warning("total_items is <= 0, returning empty report")
        return QualityReport(
            overall_score=0.0,
            grade="F",
            total_items=0,
            labeled_items=0,
            label_coverage=0.0,
            recommendations=["No items to evaluate."],
            summary={"error": "total_items must be > 0"},
        )

    # Gather per-label stats
    label_counts: dict[str, int] = Counter(entry["label"] for entry in labels)
    confidences: list[float] = [entry["confidence"] for entry in labels]
    found_labels: set[str] = set(label_counts.keys())

    # Group by item_id to detect multi-source items
    items_by_id: dict[str, list[dict]] = {}
    for entry in labels:
        items_by_id.setdefault(entry["item_id"], []).append(entry)
    multi_source_items: dict[str, list[dict]] = {
        item_id: entries
        for item_id, entries in items_by_id.items()
        if len(entries) > 1
    }

    labeled_count = len(items_by_id)  # unique labeled items

    # Compute each dimension
    coverage = _compute_coverage(labeled_count, total_items)
    balance = _compute_balance(label_counts)
    confidence = _compute_confidence(confidences)
    consistency = _compute_consistency(multi_source_items)
    expected = set(label_list) if label_list else None
    completeness = _compute_completeness(found_labels, expected)

    dimensions = [coverage, balance, confidence, consistency, completeness]

    # Weighted average
    total_weight = sum(d.weight for d in dimensions)
    overall_score = (
        sum(d.score * d.weight for d in dimensions) / total_weight
        if total_weight > 0
        else 0.0
    )

    # Grade
    if overall_score >= 90:
        grade = "A"
    elif overall_score >= 80:
        grade = "B"
    elif overall_score >= 70:
        grade = "C"
    elif overall_score >= 60:
        grade = "D"
    else:
        grade = "F"

    # Recommendations
    recommendations: list[str] = []
    if coverage.score < 80:
        recommendations.append(
            f"Label coverage is {coverage.score:.1f}%. "
            "Consider labeling more items to improve dataset representativeness."
        )
    if balance.score < 70:
        recommendations.append(
            "Label distribution is imbalanced. "
            "Consider oversampling minority classes or collecting more data for underrepresented labels."
        )
    if confidence.score < 70:
        recommendations.append(
            f"Average confidence is {confidence.score:.1f}%. "
            "Review low-confidence labels and consider re-labeling uncertain items."
        )
    if consistency.score < 80:
        recommendations.append(
            "Multi-source label agreement is low. "
            "Resolve conflicting labels through adjudication or majority voting."
        )
    if completeness.score < 80:
        recommendations.append(
            "Not all expected labels are represented in the dataset. "
            "Collect or label items for missing categories."
        )

    label_coverage = (labeled_count / total_items) * 100 if total_items > 0 else 0.0

    summary = {
        "overall_score": round(overall_score, 2),
        "grade": grade,
        "total_items": total_items,
        "labeled_items": labeled_count,
        "label_coverage_pct": round(label_coverage, 2),
        "unique_labels": len(found_labels),
        "multi_source_items": len(multi_source_items),
    }

    logger.info("Quality evaluation complete — grade %s (%.1f)", grade, overall_score)

    return QualityReport(
        overall_score=round(overall_score, 2),
        grade=grade,
        dimensions=dimensions,
        total_items=total_items,
        labeled_items=labeled_count,
        label_coverage=round(label_coverage, 2),
        recommendations=recommendations,
        summary=summary,
    )


def _compute_coverage(labeled_count: int, total: int) -> QualityDimension:
    """Coverage: percentage of total items that have at least one label."""
    score = (labeled_count / total) * 100 if total > 0 else 0.0
    score = min(score, 100.0)
    return QualityDimension(
        name="coverage",
        score=round(score, 2),
        weight=0.25,
        details=f"{labeled_count}/{total} items labeled ({score:.1f}%)",
        metrics={"labeled_count": labeled_count, "total": total},
    )


def _compute_balance(label_counts: dict) -> QualityDimension:
    """Balance: normalized entropy of label distribution (H / log(k))."""
    k = len(label_counts)
    if k <= 1:
        # One or zero labels — trivially balanced
        return QualityDimension(
            name="balance",
            score=100.0,
            weight=0.2,
            details="Single label class — perfectly balanced by definition.",
            metrics={"num_classes": k, "entropy": 0.0, "max_entropy": 0.0},
        )

    total = sum(label_counts.values())
    entropy = -sum(
        (count / total) * math.log(count / total)
        for count in label_counts.values()
        if count > 0
    )
    max_entropy = math.log(k)
    normalized = (entropy / max_entropy) * 100 if max_entropy > 0 else 0.0

    return QualityDimension(
        name="balance",
        score=round(normalized, 2),
        weight=0.2,
        details=(
            f"Normalized entropy: {normalized:.1f}% across {k} classes. "
            f"Distribution: {dict(label_counts)}"
        ),
        metrics={
            "num_classes": k,
            "entropy": round(entropy, 4),
            "max_entropy": round(max_entropy, 4),
            "normalized_entropy": round(normalized, 2),
            "distribution": dict(label_counts),
        },
    )


def _compute_confidence(confidences: list[float]) -> QualityDimension:
    """Confidence: mean confidence across all labels."""
    if not confidences:
        return QualityDimension(
            name="confidence",
            score=0.0,
            weight=0.2,
            details="No confidence values available.",
            metrics={"mean": 0.0, "min": 0.0, "max": 0.0, "count": 0},
        )

    mean_conf = sum(confidences) / len(confidences)
    score = mean_conf * 100  # confidence assumed 0-1 range

    return QualityDimension(
        name="confidence",
        score=round(min(score, 100.0), 2),
        weight=0.2,
        details=(
            f"Mean confidence: {mean_conf:.3f} across {len(confidences)} labels. "
            f"Range: [{min(confidences):.3f}, {max(confidences):.3f}]"
        ),
        metrics={
            "mean": round(mean_conf, 4),
            "min": round(min(confidences), 4),
            "max": round(max(confidences), 4),
            "count": len(confidences),
        },
    )


def _compute_consistency(multi_source_items: dict) -> QualityDimension:
    """Consistency: agreement rate among items labeled by multiple sources."""
    if not multi_source_items:
        return QualityDimension(
            name="consistency",
            score=100.0,
            weight=0.2,
            details="No multi-source items — consistency is trivially perfect.",
            metrics={"multi_source_count": 0, "agreement_count": 0, "agreement_rate": 1.0},
        )

    agreement_count = 0
    for item_id, entries in multi_source_items.items():
        labels_for_item = {e["label"] for e in entries}
        if len(labels_for_item) == 1:
            agreement_count += 1

    rate = agreement_count / len(multi_source_items)
    score = rate * 100

    return QualityDimension(
        name="consistency",
        score=round(score, 2),
        weight=0.2,
        details=(
            f"{agreement_count}/{len(multi_source_items)} multi-source items agree "
            f"({score:.1f}%)"
        ),
        metrics={
            "multi_source_count": len(multi_source_items),
            "agreement_count": agreement_count,
            "agreement_rate": round(rate, 4),
        },
    )


def _compute_completeness(
    found_labels: set, expected_labels: set | None
) -> QualityDimension:
    """Completeness: fraction of expected label set that appears in the data."""
    if expected_labels is None:
        return QualityDimension(
            name="completeness",
            score=100.0,
            weight=0.15,
            details="No expected label list provided — completeness assumed 100%.",
            metrics={"found": len(found_labels), "expected": None, "missing": []},
        )

    if not expected_labels:
        return QualityDimension(
            name="completeness",
            score=100.0,
            weight=0.15,
            details="Expected label list is empty — completeness is trivially 100%.",
            metrics={"found": len(found_labels), "expected": 0, "missing": []},
        )

    covered = found_labels & expected_labels
    missing = expected_labels - found_labels
    score = (len(covered) / len(expected_labels)) * 100

    return QualityDimension(
        name="completeness",
        score=round(score, 2),
        weight=0.15,
        details=(
            f"{len(covered)}/{len(expected_labels)} expected labels present. "
            f"Missing: {sorted(missing) if missing else 'none'}"
        ),
        metrics={
            "found": len(covered),
            "expected": len(expected_labels),
            "missing": sorted(missing),
        },
    )
