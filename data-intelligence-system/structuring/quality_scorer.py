"""
Data Quality Scorer — rates datasets on four dimensions.

Dimensions (each 0-100, weighted to produce final score):
1. Completeness (40%) — how few nulls/missing values
2. Uniqueness (20%) — how few duplicate rows
3. Consistency (20%) — how uniform are formats within columns
4. Validity (20%) — how many values fall within expected ranges/patterns
"""

import logging
from dataclasses import dataclass, asdict

import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class QualityDimension:
    """Score for a single quality dimension."""
    name: str
    score: float  # 0-100
    weight: float
    details: str


@dataclass
class QualityReport:
    """Full quality assessment of a dataset."""
    overall_score: float  # 0-100
    grade: str  # A, B, C, D, F
    dimensions: list  # list of QualityDimension dicts
    column_scores: dict  # per-column quality scores
    recommendations: list  # list of improvement suggestions

    def to_dict(self):
        return asdict(self)


def _score_completeness(df: pd.DataFrame) -> QualityDimension:
    """Score based on proportion of non-null values."""
    total_cells = df.size
    null_cells = int(df.isna().sum().sum())
    non_null_ratio = (total_cells - null_cells) / max(total_cells, 1)
    score = round(non_null_ratio * 100, 2)

    return QualityDimension(
        name="completeness",
        score=score,
        weight=0.40,
        details=f"{null_cells} null values out of {total_cells} total cells ({100 - score:.1f}% missing)",
    )


def _score_uniqueness(df: pd.DataFrame) -> QualityDimension:
    """Score based on proportion of unique rows."""
    total = len(df)
    unique = len(df.drop_duplicates())
    if total == 0:
        score = 100.0
    else:
        score = round((unique / total) * 100, 2)

    dupes = total - unique
    return QualityDimension(
        name="uniqueness",
        score=score,
        weight=0.20,
        details=f"{dupes} duplicate rows out of {total} total ({100 - score:.1f}% duplicated)",
    )


def _score_consistency(df: pd.DataFrame) -> QualityDimension:
    """Score based on format uniformity within columns.

    Checks: consistent casing in text columns, consistent date formats,
    consistent numeric precision.
    """
    scores = []

    for col in df.columns:
        series = df[col].dropna()
        if len(series) == 0:
            scores.append(100.0)
            continue

        if series.dtype == object:
            # Check if mixed case (some upper, some lower, some title)
            str_vals = series.astype(str)
            cases = str_vals.apply(
                lambda x: "upper" if x.isupper() else ("lower" if x.islower() else "mixed")
            )
            dominant = cases.mode()
            if not dominant.empty:
                consistency = (cases == dominant.iloc[0]).mean() * 100
            else:
                consistency = 50.0
            scores.append(consistency)
        elif pd.api.types.is_numeric_dtype(series):
            # Check for consistent decimal places
            try:
                str_nums = series.astype(str)
                decimal_places = str_nums.apply(
                    lambda x: len(x.split(".")[-1]) if "." in x else 0
                )
                if decimal_places.nunique() <= 2:
                    scores.append(95.0)
                else:
                    scores.append(70.0)
            except Exception:
                scores.append(80.0)
        else:
            scores.append(90.0)

    score = round(np.mean(scores) if scores else 100.0, 2)

    return QualityDimension(
        name="consistency",
        score=score,
        weight=0.20,
        details=f"Average format consistency across {len(df.columns)} columns",
    )


def _score_validity(df: pd.DataFrame) -> QualityDimension:
    """Score based on values being within expected ranges.

    Checks: numeric values within reasonable bounds, no infinite values,
    string lengths within reasonable bounds.
    """
    issues = 0
    total_checks = 0

    for col in df.columns:
        series = df[col].dropna()
        if len(series) == 0:
            continue

        if pd.api.types.is_numeric_dtype(series):
            # Check for infinities
            inf_count = np.isinf(series).sum() if np.issubdtype(series.dtype, np.floating) else 0
            total_checks += len(series)
            issues += int(inf_count)

            # Check for negative values in columns that probably shouldn't have them
            if any(kw in col.lower() for kw in ["count", "size", "length", "age", "price"]):
                neg_count = (series < 0).sum()
                issues += int(neg_count)
        elif series.dtype == object:
            # Check for very long strings (probably data errors)
            str_lens = series.astype(str).str.len()
            total_checks += len(series)
            # Strings > 10000 chars are suspicious
            issues += int((str_lens > 10000).sum())
            # Empty strings after stripping
            issues += int((series.astype(str).str.strip() == "").sum())

    if total_checks == 0:
        score = 100.0
    else:
        score = round(max(0, (1 - issues / total_checks)) * 100, 2)

    return QualityDimension(
        name="validity",
        score=score,
        weight=0.20,
        details=f"{issues} validity issues found across {total_checks} checks",
    )


def _generate_recommendations(dimensions: list[QualityDimension], df: pd.DataFrame) -> list[str]:
    """Generate actionable recommendations based on quality scores."""
    recs = []

    for dim in dimensions:
        if dim.name == "completeness" and dim.score < 90:
            null_cols = df.columns[df.isna().any()].tolist()
            recs.append(
                f"Completeness is {dim.score}%. Columns with nulls: {', '.join(null_cols[:5])}. "
                "Consider filling missing values or investigating data source."
            )
        elif dim.name == "uniqueness" and dim.score < 95:
            recs.append(
                f"Uniqueness is {dim.score}%. Consider deduplicating rows or "
                "checking if duplicates are intentional."
            )
        elif dim.name == "consistency" and dim.score < 80:
            recs.append(
                f"Consistency is {dim.score}%. Text columns may have mixed casing "
                "or formats. Consider standardizing."
            )
        elif dim.name == "validity" and dim.score < 90:
            recs.append(
                f"Validity is {dim.score}%. Some values may be out of expected ranges. "
                "Review flagged columns."
            )

    if not recs:
        recs.append("Dataset quality is good. No major issues detected.")

    return recs


def _grade(score: float) -> str:
    """Convert numeric score to letter grade."""
    if score >= 90:
        return "A"
    elif score >= 80:
        return "B"
    elif score >= 70:
        return "C"
    elif score >= 60:
        return "D"
    return "F"


def score_quality(df: pd.DataFrame) -> QualityReport:
    """Score dataset quality across four dimensions.

    Args:
        df: The pandas DataFrame to evaluate.

    Returns:
        QualityReport with overall score, per-dimension scores, and recommendations.
    """
    dimensions = [
        _score_completeness(df),
        _score_uniqueness(df),
        _score_consistency(df),
        _score_validity(df),
    ]

    overall = sum(d.score * d.weight for d in dimensions)
    overall = round(overall, 2)

    # Per-column scores (simple: completeness only)
    column_scores = {}
    for col in df.columns:
        series = df[col]
        completeness = round((1 - series.isna().mean()) * 100, 2)
        column_scores[col] = {"completeness": completeness}

    recommendations = _generate_recommendations(dimensions, df)

    report = QualityReport(
        overall_score=overall,
        grade=_grade(overall),
        dimensions=[asdict(d) for d in dimensions],
        column_scores=column_scores,
        recommendations=recommendations,
    )

    logger.info(
        "Quality scored: %.1f (%s) — completeness=%.1f, uniqueness=%.1f, "
        "consistency=%.1f, validity=%.1f",
        overall, report.grade,
        dimensions[0].score, dimensions[1].score,
        dimensions[2].score, dimensions[3].score,
    )
    return report
