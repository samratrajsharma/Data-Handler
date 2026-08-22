"""Regression tests for the single-user data-loss fixes.

Covers six confirmed bugs:
  * FIX 1 — ``handle_nulls('drop_rows')`` no longer deletes the whole dataset
    when one column is entirely null (and raises rather than silently
    returning an empty frame).
  * FIX 2 — ``remove_outliers`` no longer nukes every non-modal row when a
    numeric column has IQR == 0 / is binary / is zero-inflated, and caps mass
    deletion.
  * FIX 3 — ``encode_categorical`` skips (with a warning) one-hot encoding a
    high-cardinality column instead of exploding the frame.
  * FIX 6 — the rule engine types values from the column dtype: ``equals``
    treats ``'007' != 7`` on a string column, and ``in_list`` matches a numeric
    column against a UI list of strings like ``['5']``.

Only pandas / numpy are needed — no database, MinIO, or Celery.

The domain package directory is hyphenated (``data-intelligence-system``),
which is not a valid Python package name, so we prepend it to ``sys.path`` the
same way ``core/paths.py`` does and then import the modules by bare name.
"""
import os
import sys

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DIS_ROOT = os.path.join(_REPO_ROOT, "data-intelligence-system")
for _p in (_DIS_ROOT, _REPO_ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import numpy as np
import pandas as pd
import pytest

from structuring.cleaning_pipeline import (  # noqa: E402
    MAX_ONEHOT_CARDINALITY,
    encode_categorical,
    handle_nulls,
    remove_outliers,
)
from labeling.rule_engine import RuleEngine  # noqa: E402


def _label(rules, df):
    """Load *rules* into a fresh engine and return the resulting label list."""
    eng = RuleEngine()
    eng.load_rules(rules)
    out, _ = eng.apply(df)
    return out["__label__"].tolist()


# ── FIX 1: drop_rows with an all-null column ────────────────────────────────

def test_drop_rows_all_null_column_preserves_rows():
    # 'b' is entirely null; a naive df.dropna() would delete every row because
    # each row has a null in 'b'. The fix drops only on columns that hold real
    # values, so all three rows survive.
    df = pd.DataFrame({"a": [1, 2, 3], "b": [None, None, None]})
    out, step = handle_nulls(df, strategy="drop_rows")
    assert len(out) == 3
    assert out["a"].tolist() == [1, 2, 3]
    assert step.rows_affected == 0


def test_drop_rows_still_removes_nulls_in_valued_columns():
    # A null in a column that DOES have values still drops that row.
    df = pd.DataFrame({"a": [1, None, 3], "b": [None, None, None]})
    out, _ = handle_nulls(df, strategy="drop_rows")
    assert out["a"].tolist() == [1.0, 3.0]


def test_drop_rows_empties_result_raises():
    # Every row has a null in one of the retained columns -> would empty the
    # frame -> must raise instead of silently returning an empty DataFrame.
    df = pd.DataFrame({"a": [1, None], "b": [None, 2]})
    with pytest.raises(ValueError):
        handle_nulls(df, strategy="drop_rows")


# ── FIX 2: IQR outlier removal guards ───────────────────────────────────────

def test_remove_outliers_iqr_zero_does_not_nuke_column():
    # Zero-inflated / label-encoded column: q1 == q3 so IQR == 0. The old code
    # collapsed the fences to a point and deleted every non-zero row. The fix
    # skips the column, so nothing is removed.
    df = pd.DataFrame({"flag": [0, 0, 0, 0, 0, 0, 0, 0, 1, 2]})
    out, step = remove_outliers(df)
    assert len(out) == len(df)
    assert out["flag"].tolist() == df["flag"].tolist()
    assert step.rows_affected == 0


def test_remove_outliers_skips_binary_column():
    # Binary 0/1 flag with a rare 1 — IQR bounds would flag the 1 as an outlier.
    df = pd.DataFrame({"flag": [0, 0, 0, 0, 0, 0, 0, 0, 0, 1]})
    out, step = remove_outliers(df)
    assert len(out) == len(df)
    assert step.rows_affected == 0


def test_remove_outliers_still_removes_clear_outlier_within_cap():
    # A single extreme value among 100 rows (1%) is well under the 10% cap and
    # must still be removed — the guards should not over-neuter the step.
    df = pd.DataFrame({"v": list(range(1, 100)) + [100000]})
    out, step = remove_outliers(df)
    assert len(out) == 99
    assert 100000 not in out["v"].tolist()


def test_remove_outliers_cap_aborts_mass_deletion():
    # ~20% of rows would be flagged as outliers -> exceeds the 10% cap -> the
    # whole step aborts and deletes nothing.
    tight = list(np.linspace(10.0, 20.0, 80))
    spike = [1000.0] * 20
    df = pd.DataFrame({"v": tight + spike})
    out, step = remove_outliers(df)
    assert len(out) == 100
    assert step.rows_affected == 0
    assert "ABORTED" in step.description


# ── FIX 3: one-hot cardinality cap ──────────────────────────────────────────

def test_onehot_cap_skips_high_cardinality_with_warning():
    n = MAX_ONEHOT_CARDINALITY + 5
    df = pd.DataFrame({"user_id": [f"u{i}" for i in range(n)], "keep": list(range(n))})
    out, step = encode_categorical(df, [{"column": "user_id", "mode": "onehot"}])
    # Column not exploded into hundreds of dummies; original frame width kept.
    assert "user_id" in out.columns
    assert out.shape[1] == df.shape[1]
    assert "SKIPPED" in step.description


def test_onehot_low_cardinality_still_encodes():
    # Sanity: normal (low-cardinality) one-hot encoding still works.
    df = pd.DataFrame({"c": ["a", "b", "a", "c"]})
    out, _ = encode_categorical(df, [{"column": "c", "mode": "onehot"}])
    assert "c" not in out.columns
    assert any(col.startswith("c_") for col in out.columns)


# ── FIX 6a: equals typing from the column dtype ─────────────────────────────

def test_equals_string_column_leading_zero_not_coerced():
    # '007' on an object/string column must NOT be coerced to numeric 7.
    df = pd.DataFrame({"code": ["007", "008", "9"]})
    labels = _label(
        [{"column": "code", "operator": "equals", "value": 7, "label": "L"}], df
    )
    assert labels == [None, None, None]


def test_equals_string_column_exact_string_matches():
    # Literal string equality still works on the same column.
    df = pd.DataFrame({"code": ["007", "7"]})
    labels = _label(
        [{"column": "code", "operator": "equals", "value": "007", "label": "L"}], df
    )
    assert labels == ["L", None]


def test_equals_numeric_column_still_coerces():
    # Regression guard: genuine numeric columns still compare numerically, so
    # 7 matches the string target "7".
    df = pd.DataFrame({"n": [7, 8]})
    labels = _label(
        [{"column": "n", "operator": "equals", "value": "7", "label": "L"}], df
    )
    assert labels == ["L", None]


# ── FIX 6b: in_list coercion ────────────────────────────────────────────────

def test_in_list_numeric_column_matches_string_list():
    # A numeric column value (5) matches a UI-supplied list of strings (['5']).
    df = pd.DataFrame({"n": [5, 6, 5]})
    labels = _label(
        [{"column": "n", "operator": "in_list", "value": ["5"], "label": "L"}], df
    )
    assert labels == ["L", None, "L"]


def test_in_list_accepts_comma_separated_string():
    # A comma-separated string is accepted as the list.
    df = pd.DataFrame({"n": [5, 6, 7]})
    labels = _label(
        [{"column": "n", "operator": "in_list", "value": "5,7", "label": "L"}], df
    )
    assert labels == ["L", None, "L"]
