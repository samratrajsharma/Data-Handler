"""
Rule-Based Labeling Engine — applies configurable rules to assign labels.
"""

import re
import logging
from dataclasses import dataclass, field, asdict
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

# ── Supported operators ─────────────────────────────────────────────────

SUPPORTED_OPERATORS = frozenset({
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "greater_than",
    "less_than",
    "greater_equal",
    "less_equal",
    "between",
    "regex_match",
    "in_list",
    "is_null",
    "is_not_null",
})


# ── Data classes ────────────────────────────────────────────────────────

@dataclass
class RuleCondition:
    """A single boolean condition (column, operator, value).

    Multiple conditions can be combined via ``LabelingRule.logic``.
    """
    column: str
    operator: str
    value: Any


@dataclass
class LabelingRule:
    """A labeling rule.

    Two shapes are accepted at load time:

    1. **Compound (preferred)** — one or more :class:`RuleCondition` combined
       with ``logic`` (``"and"`` / ``"or"``).
    2. **Legacy flat** — top-level ``column`` / ``operator`` / ``value``
       fields (kept for backwards compatibility with already-saved rule sets).
       Legacy rules are normalised to a single-condition compound rule on
       load.

    The dataclass below uses the compound shape internally; ``column`` /
    ``operator`` / ``value`` are kept as convenience properties for code
    that still reads them.
    """
    label: str
    priority: int = 0
    logic: str = "and"  # "and" | "or" — irrelevant for single-condition rules
    conditions: list[RuleCondition] = field(default_factory=list)

    @property
    def column(self) -> str:
        return self.conditions[0].column if self.conditions else ""

    @property
    def operator(self) -> str:
        return self.conditions[0].operator if self.conditions else ""

    @property
    def value(self) -> Any:
        return self.conditions[0].value if self.conditions else None


@dataclass
class LabelingReport:
    """Summary report produced after labeling a dataset."""
    total_rows: int
    labeled_count: int
    unlabeled_count: int
    label_distribution: dict = field(default_factory=dict)   # label -> count
    rules_applied: int = 0
    conflict_count: int = 0
    per_rule_stats: list = field(default_factory=list)       # [{rule_index, matches, label}]
    warnings: list = field(default_factory=list)             # human-readable warnings

    def to_dict(self):
        return asdict(self)


# ── Rule Engine ─────────────────────────────────────────────────────────

class RuleEngine:
    """Evaluate a list of labeling rules against a pandas DataFrame.

    Args:
        conflict_strategy: How to resolve when multiple rules match a row.
            * ``"first_match"``      — first matching rule wins (list order).
            * ``"highest_priority"`` — rule with highest ``priority`` wins.
            * ``"all"``              — comma-join all matching labels.
    """

    def __init__(self, conflict_strategy: str = "first_match"):
        if conflict_strategy not in ("first_match", "highest_priority", "all"):
            raise ValueError(
                f"Unknown conflict_strategy '{conflict_strategy}'. "
                "Choose from: first_match, highest_priority, all"
            )
        self.conflict_strategy = conflict_strategy
        self.rules: list[LabelingRule] = []

    # ── Rule loading ────────────────────────────────────────────────────

    def load_rules(self, rule_defs: list[dict]) -> None:
        """Parse a list of plain dicts into :class:`LabelingRule` objects.

        Accepts both shapes:

        Legacy flat::

            {"column": "x", "operator": "equals", "value": "y",
             "label": "L", "priority": 0}

        Compound::

            {"label": "L", "priority": 0, "logic": "and",
             "conditions": [
                {"column": "x", "operator": "equals", "value": "y"},
                {"column": "z", "operator": "greater_than", "value": 30},
             ]}

        Raises ``ValueError`` if any condition uses an unsupported operator
        or if a rule has no conditions.
        """
        self.rules = []
        for idx, rd in enumerate(rule_defs):
            # Detect shape: compound rules have a "conditions" key.
            raw_conditions = rd.get("conditions")
            if raw_conditions is None:
                # Treat as legacy flat — wrap into a single condition.
                raw_conditions = [{
                    "column": rd.get("column", ""),
                    "operator": rd.get("operator", ""),
                    "value": rd.get("value"),
                }]

            if not isinstance(raw_conditions, list) or len(raw_conditions) == 0:
                raise ValueError(f"Rule {idx}: at least one condition is required.")

            conditions: list[RuleCondition] = []
            for cidx, cd in enumerate(raw_conditions):
                operator = cd.get("operator", "")
                if operator not in SUPPORTED_OPERATORS:
                    raise ValueError(
                        f"Rule {idx}, condition {cidx}: unsupported operator '{operator}'. "
                        f"Supported: {sorted(SUPPORTED_OPERATORS)}"
                    )
                conditions.append(RuleCondition(
                    column=cd.get("column", ""),
                    operator=operator,
                    value=cd.get("value"),
                ))

            logic = (rd.get("logic") or "and").lower()
            if logic not in ("and", "or"):
                raise ValueError(f"Rule {idx}: 'logic' must be 'and' or 'or', got {logic!r}.")

            self.rules.append(LabelingRule(
                label=rd["label"],
                priority=rd.get("priority", 0),
                logic=logic,
                conditions=conditions,
            ))
        logger.info("Loaded %d labeling rules.", len(self.rules))

    # ── Compound-rule evaluation ────────────────────────────────────────

    @staticmethod
    def _evaluate_rule(rule: LabelingRule, df: pd.DataFrame, row_idx: int) -> bool:
        """Return *True* if *row_idx* in *df* satisfies the compound rule.

        Evaluates every :class:`RuleCondition` against the relevant cell and
        combines results via the rule's ``logic`` (``and`` / ``or``).
        Conditions targeting missing columns are skipped (treated as False
        for that condition).
        """
        if not rule.conditions:
            return False
        cols = df.columns
        results: list[bool] = []
        for cond in rule.conditions:
            if cond.column not in cols:
                results.append(False)
                continue
            try:
                cell = df.iat[row_idx, df.columns.get_loc(cond.column)]
                results.append(RuleEngine._evaluate_condition(cond, cell))
            except Exception:  # noqa: BLE001
                results.append(False)
        if rule.logic == "or":
            return any(results)
        return all(results)

    # ── Single-condition evaluation ─────────────────────────────────────

    @staticmethod
    def _evaluate_condition(rule: RuleCondition, value: Any) -> bool:  # noqa: C901
        """Return *True* if *value* satisfies the condition's operator + value."""
        op = rule.operator
        target = rule.value

        # Null checks (independent of target)
        if op == "is_null":
            return pd.isna(value)
        if op == "is_not_null":
            return not pd.isna(value)

        # For remaining operators a null cell never matches
        if pd.isna(value):
            return False

        # --- String operators (coerce both sides) ---
        if op in ("contains", "not_contains", "starts_with", "ends_with"):
            str_val = str(value)
            str_target = str(target)
            if op == "contains":
                return str_target in str_val
            if op == "not_contains":
                return str_target not in str_val
            if op == "starts_with":
                return str_val.startswith(str_target)
            if op == "ends_with":
                return str_val.endswith(str_target)

        # --- Regex ---
        if op == "regex_match":
            try:
                return bool(re.search(str(target), str(value)))
            except re.error as exc:
                logger.warning("Invalid regex '%s': %s", target, exc)
                return False

        # --- in_list ---
        if op == "in_list":
            if not isinstance(target, list):
                logger.warning("in_list expects a list value; got %s", type(target).__name__)
                return False
            return value in target

        # --- Equality ---
        if op == "equals":
            try:
                return value == target or _coerce_numeric(value) == _coerce_numeric(target)
            except (TypeError, ValueError):
                return str(value) == str(target)

        if op == "not_equals":
            try:
                return value != target and _coerce_numeric(value) != _coerce_numeric(target)
            except (TypeError, ValueError):
                return str(value) != str(target)

        # --- Comparison operators (numeric coercion) ---
        if op in ("greater_than", "less_than", "greater_equal", "less_equal"):
            try:
                num_val = _coerce_numeric(value)
                num_target = _coerce_numeric(target)
            except (TypeError, ValueError):
                logger.debug(
                    "Cannot compare '%s' and '%s' numerically; skipping.", value, target
                )
                return False

            if op == "greater_than":
                return num_val > num_target
            if op == "less_than":
                return num_val < num_target
            if op == "greater_equal":
                return num_val >= num_target
            if op == "less_equal":
                return num_val <= num_target

        # --- between (inclusive range, numeric) ---
        # Accepts either a list/tuple [low, high] or a comma string "low,high".
        if op == "between":
            low, high = _parse_range(target)
            if low is None or high is None:
                logger.debug("between: invalid target %r", target)
                return False
            try:
                num_val = _coerce_numeric(value)
            except (TypeError, ValueError):
                return False
            if low > high:
                low, high = high, low
            return low <= num_val <= high

        return False

    # ── Apply all rules to a DataFrame ──────────────────────────────────

    def apply(
        self,
        df: pd.DataFrame,
        label_column: str = "__label__",
    ) -> tuple[pd.DataFrame, LabelingReport]:
        """Label every row in *df* by evaluating all loaded rules.

        Args:
            df: Input DataFrame (not mutated — a copy is returned).
            label_column: Name of the new column that will hold labels.

        Returns:
            A ``(labeled_df, report)`` tuple.
        """
        if not self.rules:
            logger.warning("No rules loaded — returning unlabeled DataFrame.")
            out = df.copy()
            out[label_column] = None
            report = LabelingReport(
                total_rows=len(df),
                labeled_count=0,
                unlabeled_count=len(df),
            )
            return out, report

        if df.empty:
            logger.info("Empty DataFrame — nothing to label.")
            out = df.copy()
            out[label_column] = None
            report = LabelingReport(total_rows=0, labeled_count=0, unlabeled_count=0)
            return out, report

        out = df.copy()

        # Pre-check which rules have at least one valid column to target.
        # A compound rule is considered "evaluatable" if AT LEAST one of its
        # conditions references a real column — individual missing-column
        # conditions just evaluate to False (handled in _evaluate_rule).
        valid_columns = set(df.columns)
        rule_column_valid = []
        _column_warnings: list[str] = []
        for idx, rule in enumerate(self.rules):
            referenced = [c.column for c in rule.conditions]
            missing = [c for c in referenced if c not in valid_columns]
            any_valid = any(c in valid_columns for c in referenced)
            if not any_valid:
                logger.warning(
                    "Rule %d targets only missing columns %s — skipping.",
                    idx, missing,
                )
                rule_column_valid.append(False)
                _column_warnings.append(
                    f"Rule {idx} targets columns {sorted(set(missing))} which do not exist in the dataset. "
                    f"Available columns: {sorted(valid_columns)}"
                )
            else:
                rule_column_valid.append(True)
                if missing:
                    _column_warnings.append(
                        f"Rule {idx}: some conditions reference missing columns {sorted(set(missing))} — those conditions will not match."
                    )

        # Per-rule match counters
        per_rule_matches: list[int] = [0] * len(self.rules)
        conflict_count = 0
        labels: list[Any] = [None] * len(df)

        for row_idx in range(len(df)):
            matched_rules: list[tuple[int, LabelingRule]] = []

            for rule_idx, rule in enumerate(self.rules):
                if not rule_column_valid[rule_idx]:
                    continue
                try:
                    if self._evaluate_rule(rule, df, row_idx):
                        matched_rules.append((rule_idx, rule))
                        per_rule_matches[rule_idx] += 1
                except Exception:
                    logger.debug(
                        "Rule %d evaluation error on row %d; skipping.",
                        rule_idx, row_idx, exc_info=True,
                    )

            if not matched_rules:
                continue

            if len(matched_rules) > 1:
                conflict_count += 1

            # Resolve conflict
            if self.conflict_strategy == "first_match":
                labels[row_idx] = matched_rules[0][1].label

            elif self.conflict_strategy == "highest_priority":
                winner = max(matched_rules, key=lambda t: t[1].priority)
                labels[row_idx] = winner[1].label

            elif self.conflict_strategy == "all":
                labels[row_idx] = ",".join(r.label for _, r in matched_rules)

        out[label_column] = labels

        # Build report
        labeled_count = sum(1 for lbl in labels if lbl is not None)
        label_distribution: dict[str, int] = {}
        for lbl in labels:
            if lbl is not None:
                for single_label in str(lbl).split(","):
                    single_label = single_label.strip()
                    label_distribution[single_label] = label_distribution.get(single_label, 0) + 1

        per_rule_stats = [
            {"rule_index": idx, "matches": per_rule_matches[idx], "label": rule.label}
            for idx, rule in enumerate(self.rules)
        ]

        report = LabelingReport(
            total_rows=len(df),
            labeled_count=labeled_count,
            unlabeled_count=len(df) - labeled_count,
            label_distribution=label_distribution,
            rules_applied=len(self.rules),
            conflict_count=conflict_count,
            per_rule_stats=per_rule_stats,
            warnings=_column_warnings,
        )

        logger.info(
            "Labeling complete: %d/%d rows labeled, %d conflicts (%s strategy), "
            "distribution=%s",
            labeled_count, len(df), conflict_count, self.conflict_strategy,
            label_distribution,
        )
        return out, report


# ── Helpers ─────────────────────────────────────────────────────────────

def _coerce_numeric(val: Any) -> float:
    """Best-effort conversion to float for comparison operators."""
    if isinstance(val, (int, float)):
        return float(val)
    return float(val)


def _parse_range(target: Any) -> tuple[float | None, float | None]:
    """Parse a between-operator value into a ``(low, high)`` tuple.

    Accepts a list/tuple of two numbers, or a comma/dash-separated string like
    ``"5,10"`` or ``"5 - 10"``. Returns ``(None, None)`` on parse failure.
    """
    try:
        if isinstance(target, (list, tuple)) and len(target) == 2:
            return float(target[0]), float(target[1])
        if isinstance(target, str):
            # Split on comma first, then dash (allow values like "5,10" / "5 - 10")
            parts = target.split(",") if "," in target else target.split("-")
            parts = [p.strip() for p in parts if p.strip()]
            if len(parts) == 2:
                return float(parts[0]), float(parts[1])
    except (TypeError, ValueError):
        pass
    return None, None
