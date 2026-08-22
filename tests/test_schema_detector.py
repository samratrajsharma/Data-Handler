"""Schema detector: semantic type inference + column stats + edge cases."""
import pandas as pd
from structuring.schema_detector import detect_schema


def _types(df):
    return {c["name"]: c["inferred_type"] for c in detect_schema(df).columns}


def test_email_and_url():
    df = pd.DataFrame({
        "email": ["a@b.com", "c@d.org", "e@f.net", "g@h.io"],
        "url": ["http://a.com", "https://b.com", "http://c.com", "https://d.com"],
    })
    t = _types(df)
    assert t["email"] == "email"
    assert t["url"] == "url"


def test_numeric_boolean_id():
    df = pd.DataFrame({"n": [1, 2, 3, 4, 5], "flag": [0, 1, 1, 0, 1], "user_id": [101, 102, 103, 104, 105]})
    t = _types(df)
    assert t["n"] == "numeric"
    assert t["flag"] == "boolean"
    assert t["user_id"] == "id"


def test_categorical_and_text():
    df = pd.DataFrame({
        "cat": ["red", "green", "blue"] * 20,
        "txt": ["This is a deliberately long sentence number %d with plenty of words here." % i for i in range(60)],
    })
    t = _types(df)
    assert t["cat"] == "categorical"
    assert t["txt"] == "text"


def test_date_detection():
    df = pd.DataFrame({"d": ["2021-01-01", "2021-02-15", "2021-03-20", "2021-04-25", "2021-05-30"]})
    assert _types(df)["d"] == "date"


def test_empty_column_and_null_stats():
    df = pd.DataFrame({"empty": [None, None, None], "x": [1, None, 3]})
    cols = {c["name"]: c for c in detect_schema(df).columns}
    assert cols["empty"]["inferred_type"] == "unknown"
    assert cols["x"]["null_count"] == 1 and cols["x"]["nullable"] is True


def test_schema_structure():
    s = detect_schema(pd.DataFrame({"a": [1, 2], "b": ["x", "y"]}))
    d = s.to_dict()
    assert d["row_count"] == 2 and d["column_count"] == 2 and len(d["columns"]) == 2
