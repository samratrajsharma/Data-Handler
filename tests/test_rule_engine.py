"""Rule engine: operators, compound logic, conflict strategies, edge cases."""
import pandas as pd
from labeling.rule_engine import RuleEngine, SUPPORTED_OPERATORS
from helpers import assert_raises


def _run(rules, df, strategy="first_match"):
    eng = RuleEngine(strategy)
    eng.load_rules(rules)
    return eng.apply(df)


def test_supported_operator_count():
    assert len(SUPPORTED_OPERATORS) == 15


def test_equals_numeric_and_distribution():
    df = pd.DataFrame({"x": [1, 2, 3]})
    out, rep = _run([{"column": "x", "operator": "equals", "value": 2, "label": "two"}], df)
    assert out["__label__"].tolist() == [None, "two", None]
    assert rep.labeled_count == 1
    assert rep.label_distribution == {"two": 1}
    assert rep.unlabeled_count == 2


def test_string_operators():
    df = pd.DataFrame({"s": ["apple", "banana", "grape"]})
    assert _run([{"column": "s", "operator": "contains", "value": "an", "label": "L"}], df)[0]["__label__"].tolist() == [None, "L", None]
    assert _run([{"column": "s", "operator": "starts_with", "value": "a", "label": "L"}], df)[0]["__label__"].tolist() == ["L", None, None]
    assert _run([{"column": "s", "operator": "ends_with", "value": "e", "label": "L"}], df)[0]["__label__"].tolist() == ["L", None, "L"]
    assert _run([{"column": "s", "operator": "not_contains", "value": "z", "label": "L"}], df)[0]["__label__"].tolist() == ["L", "L", "L"]


def test_comparison_operators():
    df = pd.DataFrame({"n": [10, 20, 30]})
    assert _run([{"column": "n", "operator": "greater_than", "value": 15, "label": "L"}], df)[0]["__label__"].tolist() == [None, "L", "L"]
    assert _run([{"column": "n", "operator": "less_than", "value": 20, "label": "L"}], df)[0]["__label__"].tolist() == ["L", None, None]
    assert _run([{"column": "n", "operator": "greater_equal", "value": 20, "label": "L"}], df)[0]["__label__"].tolist() == [None, "L", "L"]
    assert _run([{"column": "n", "operator": "less_equal", "value": 20, "label": "L"}], df)[0]["__label__"].tolist() == ["L", "L", None]


def test_between_list_string_and_reversed():
    df = pd.DataFrame({"n": [5, 15, 25]})
    assert _run([{"column": "n", "operator": "between", "value": [10, 20], "label": "L"}], df)[0]["__label__"].tolist() == [None, "L", None]
    assert _run([{"column": "n", "operator": "between", "value": "10,20", "label": "L"}], df)[0]["__label__"].tolist() == [None, "L", None]
    assert _run([{"column": "n", "operator": "between", "value": [20, 10], "label": "L"}], df)[0]["__label__"].tolist() == [None, "L", None]


def test_in_list_and_regex():
    df = pd.DataFrame({"s": ["cat", "dog", "fox"]})
    assert _run([{"column": "s", "operator": "in_list", "value": ["cat", "fox"], "label": "L"}], df)[0]["__label__"].tolist() == ["L", None, "L"]
    assert _run([{"column": "s", "operator": "regex_match", "value": "^d", "label": "L"}], df)[0]["__label__"].tolist() == [None, "L", None]


def test_null_operators():
    df = pd.DataFrame({"s": ["x", None, "y"]})
    assert _run([{"column": "s", "operator": "is_null", "value": None, "label": "L"}], df)[0]["__label__"].tolist() == [None, "L", None]
    assert _run([{"column": "s", "operator": "is_not_null", "value": None, "label": "L"}], df)[0]["__label__"].tolist() == ["L", None, "L"]


def test_compound_and_or():
    df = pd.DataFrame({"a": [1, 1, 2], "b": [10, 20, 20]})
    rule = {"label": "L", "logic": "and", "conditions": [
        {"column": "a", "operator": "equals", "value": 1},
        {"column": "b", "operator": "greater_than", "value": 15}]}
    assert _run([rule], df)[0]["__label__"].tolist() == [None, "L", None]
    rule["logic"] = "or"
    assert _run([rule], df)[0]["__label__"].tolist() == ["L", "L", "L"]


def test_conflict_strategies():
    df = pd.DataFrame({"x": [1]})
    rules = [
        {"column": "x", "operator": "equals", "value": 1, "label": "A", "priority": 1},
        {"column": "x", "operator": "equals", "value": 1, "label": "B", "priority": 5},
    ]
    out, rep = _run(rules, df, "first_match")
    assert out["__label__"].tolist() == ["A"] and rep.conflict_count == 1
    assert _run(rules, df, "highest_priority")[0]["__label__"].tolist() == ["B"]
    assert _run(rules, df, "all")[0]["__label__"].tolist() == ["A,B"]


def test_missing_column_warns():
    df = pd.DataFrame({"x": [1, 2]})
    out, rep = _run([{"column": "nope", "operator": "equals", "value": 1, "label": "L"}], df)
    assert out["__label__"].tolist() == [None, None]
    assert any("do not exist" in w for w in rep.warnings)


def test_no_rules_and_empty_df():
    eng = RuleEngine()
    out, rep = eng.apply(pd.DataFrame({"x": [1, 2]}))
    assert out["__label__"].tolist() == [None, None] and rep.unlabeled_count == 2
    eng2 = RuleEngine()
    eng2.load_rules([{"column": "x", "operator": "equals", "value": 1, "label": "L"}])
    _, rep2 = eng2.apply(pd.DataFrame({"x": []}))
    assert rep2.total_rows == 0


def test_invalid_operator_and_strategy_raise():
    assert_raises(ValueError, RuleEngine().load_rules, [{"column": "x", "operator": "BAD", "value": 1, "label": "L"}])
    assert_raises(ValueError, RuleEngine, "nonsense")
