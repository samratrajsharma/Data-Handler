"""Label-quality evaluator (coverage/balance/confidence/consistency/completeness)."""
from quality.evaluator import evaluate_label_quality


def test_basic_evaluation():
    labels = [
        {"item_id": "1", "label": "a", "confidence": 0.9, "source": "ai"},
        {"item_id": "2", "label": "b", "confidence": 0.8, "source": "ai"},
        {"item_id": "3", "label": "a", "confidence": 0.85, "source": "rule"},
    ]
    r = evaluate_label_quality(labels, total_items=4)
    assert r.total_items == 4 and r.labeled_items == 3
    assert 0 < r.label_coverage <= 100
    assert r.grade in {"A", "B", "C", "D", "F"} and 0 <= r.overall_score <= 100


def test_zero_total_items():
    r = evaluate_label_quality([], total_items=0)
    assert r.grade == "F" and r.overall_score == 0.0
