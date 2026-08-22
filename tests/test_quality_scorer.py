"""Data quality scorer: dimensions, weights, grade, edge cases."""
import pandas as pd
from structuring.quality_scorer import score_quality


def _dims(r):
    return {d["name"]: d["score"] for d in r.dimensions}


def test_clean_dataset_is_grade_a():
    df = pd.DataFrame({"id": [1, 2, 3, 4], "name": ["alice", "bob", "carol", "dave"]})
    r = score_quality(df)
    d = _dims(r)
    assert d["completeness"] == 100.0 and d["uniqueness"] == 100.0
    assert r.overall_score >= 90 and r.grade == "A"
    assert abs(sum(x["weight"] for x in r.dimensions) - 1.0) < 1e-9


def test_nulls_reduce_completeness():
    df = pd.DataFrame({"a": [1, None, 3, None], "b": [None, None, 3, 4]})  # 4/8 null
    assert abs(_dims(score_quality(df))["completeness"] - 50.0) < 0.01


def test_duplicates_reduce_uniqueness():
    df = pd.DataFrame({"a": [1, 1, 1, 1], "b": ["x", "x", "x", "y"]})  # 2 unique / 4
    assert abs(_dims(score_quality(df))["uniqueness"] - 50.0) < 0.01


def test_empty_dataframe_no_crash():
    r = score_quality(pd.DataFrame())
    assert 0 <= r.overall_score <= 100 and r.grade in {"A", "B", "C", "D", "F"}
