"""Label aggregation strategies + active-learning candidate ranking."""
from labeling.label_aggregator import aggregate_labels, active_learning_candidates, LabelSource
from helpers import assert_raises


def test_confidence_weighted_picks_highest_sum():
    items = {"i1": [LabelSource("ai", "cat", 0.6), LabelSource("rule", "dog", 0.9)]}
    rep = aggregate_labels(items, "confidence_weighted")
    assert rep.labels["i1"].final_label == "dog"
    assert rep.conflict_count == 1 and rep.multi_source_count == 1


def test_majority_vote():
    items = {"i1": [LabelSource("ai", "cat", 0.5), LabelSource("rule", "cat", 0.5), LabelSource("manual", "dog", 0.9)]}
    assert aggregate_labels(items, "majority_vote").labels["i1"].final_label == "cat"


def test_priority_manual_wins():
    items = {"i1": [LabelSource("ai", "cat", 0.99), LabelSource("manual", "dog", 0.1)]}
    assert aggregate_labels(items, "priority").labels["i1"].final_label == "dog"


def test_agreement_distribution_and_serialisation():
    items = {"i1": [LabelSource("ai", "x", 0.8), LabelSource("rule", "x", 0.7)], "i2": [LabelSource("ai", "y", 0.6)]}
    rep = aggregate_labels(items, "confidence_weighted")
    assert rep.labels["i1"].agreement_score == 1.0
    assert rep.label_distribution.get("x") == 1
    assert rep.single_source_count == 1 and rep.multi_source_count == 1
    assert rep.to_dict()["labels"]["i1"]["final_label"] == "x"


def test_empty_and_invalid_strategy():
    rep = aggregate_labels({}, "confidence_weighted")
    assert rep.total_items == 0 and rep.labeled_count == 0
    assert_raises(ValueError, aggregate_labels, {"i": [LabelSource("ai", "a", 0.5)]}, "bogus")


def test_active_learning_ranks_uncertain_first():
    items = {
        "certain": [LabelSource("ai", "a", 0.99), LabelSource("rule", "a", 0.98)],
        "uncertain": [LabelSource("ai", "a", 0.5), LabelSource("rule", "b", 0.5)],
    }
    cands = active_learning_candidates(items, top_n=2)
    assert cands[0]["item_id"] == "uncertain"
    assert cands[0]["conflicting_labels"] == ["a", "b"]


def test_active_learning_empty_sources_max_uncertainty():
    assert active_learning_candidates({"none": []})[0]["uncertainty_score"] == 1.0
