"""EDA profiler: per-column stats, correlations, warnings."""
import pandas as pd
from eda.profiler import profile_dataset


def test_structure_and_correlation():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5], "b": [2, 4, 6, 8, 10], "c": ["x", "y", "x", "y", "x"]})
    p = profile_dataset(df)
    assert p.row_count == 5 and p.column_count == 3 and len(p.columns) == 3
    assert p.numeric_correlations["a"]["b"] > 0.99


def test_high_null_produces_warning():
    p = profile_dataset(pd.DataFrame({"x": [1, None, None, None, None, None]}))
    assert len(p.warnings) >= 1


def test_single_numeric_no_correlation():
    assert profile_dataset(pd.DataFrame({"only": [1, 2, 3]})).numeric_correlations == {}
