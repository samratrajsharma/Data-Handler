"""Cleaning pipeline: dedup, nulls, encoding, case, column standardisation."""
import pandas as pd
from structuring.cleaning_pipeline import (
    run_cleaning_pipeline, remove_duplicates, handle_nulls,
    standardize_column_names, encode_categorical, normalize_case,
)


def test_remove_duplicates():
    out, step = remove_duplicates(pd.DataFrame({"a": [1, 1, 2], "b": ["x", "x", "y"]}))
    assert len(out) == 2 and step.rows_affected == 1


def test_handle_nulls_fill_mean():
    out, _ = handle_nulls(pd.DataFrame({"n": [10.0, None, 20.0]}), "fill_mean")
    assert out["n"].isna().sum() == 0 and abs(out["n"].iloc[1] - 15.0) < 1e-9


def test_handle_nulls_fill_empty_and_drop_rows():
    out, _ = handle_nulls(pd.DataFrame({"s": ["a", None, "c"]}), "fill_empty")
    assert out["s"].tolist() == ["a", "", "c"]
    out2, _ = handle_nulls(pd.DataFrame({"x": [1, None, 3]}), "drop_rows")
    assert len(out2) == 2


def test_standardize_column_names():
    out, _ = standardize_column_names(pd.DataFrame({"Customer Name": [1], "Total $ Amount": [2]}))
    assert "customer_name" in out.columns and "total_amount" in out.columns


def test_encode_categorical_label_and_onehot():
    out, _ = encode_categorical(pd.DataFrame({"c": ["a", "b", "a", "c"]}), [{"column": "c", "mode": "label"}])
    assert set(int(v) for v in out["c"].unique()) == {0, 1, 2}
    out2, _ = encode_categorical(pd.DataFrame({"c": ["a", "b"]}), [{"column": "c", "mode": "onehot"}])
    assert "c" not in out2.columns and any(col.startswith("c_") for col in out2.columns)


def test_normalize_case_lower():
    out, _ = normalize_case(pd.DataFrame({"S": ["Hello", "WORLD"]}), "lower")
    assert out.iloc[0, 0] == "hello" and out.iloc[1, 0] == "world"


def test_run_pipeline_report():
    df = pd.DataFrame({"a": [1, 1, 2, None], "b": ["x", "x", "y", "z"]})
    out, rep = run_cleaning_pipeline(df, null_strategy="fill_empty", remove_dupes=True, normalize=True)
    assert rep.original_rows == 4 and rep.final_rows <= 4
    assert isinstance(rep.steps, list) and len(rep.steps) >= 1
    assert rep.to_dict()["original_rows"] == 4


def test_run_pipeline_reports_nulls_filled():
    # 3 missing values; fill_mode should fill all and report exactly 3 handled.
    df = pd.DataFrame({"a": [1, None, 3, None], "b": ["x", "y", None, "z"]})
    out, rep = run_cleaning_pipeline(df, null_strategy="fill_mode", remove_dupes=False, normalize=False)
    assert rep.total_nulls_filled == 3
    assert int(out.isna().sum().sum()) == 0


def test_run_pipeline_no_nulls_reports_zero():
    df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
    _, rep = run_cleaning_pipeline(df, null_strategy="fill_mode")
    assert rep.total_nulls_filled == 0
