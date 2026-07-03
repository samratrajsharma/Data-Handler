"""
Statistical Profiler — generates detailed statistics for every column.
"""

import logging
from dataclasses import dataclass, asdict

import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class ColumnProfile:
    """Statistical profile for a single column."""
    name: str
    dtype: str
    count: int
    null_count: int
    null_pct: float
    unique_count: int
    unique_pct: float
    is_numeric: bool
    is_categorical: bool
    is_text: bool
    stats: dict
    correlation_with: dict  # only populated for numeric columns


@dataclass
class DatasetProfile:
    """Full statistical profile of a dataset."""
    row_count: int
    column_count: int
    memory_usage_mb: float
    columns: list  # list of ColumnProfile dicts
    numeric_correlations: dict  # full correlation matrix as nested dict
    warnings: list  # list of warning strings

    def to_dict(self):
        return asdict(self)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _profile_numeric(series: pd.Series) -> dict:
    """Compute statistics for a numeric column."""
    desc = series.describe()
    stats = {
        "mean": round(float(desc.get("mean", 0)), 6),
        "median": round(float(series.median()), 6),
        "std": round(float(desc.get("std", 0)), 6),
        "min": float(desc.get("min", 0)),
        "max": float(desc.get("max", 0)),
        "q25": float(desc.get("25%", 0)),
        "q50": float(desc.get("50%", 0)),
        "q75": float(desc.get("75%", 0)),
    }
    try:
        stats["skewness"] = round(float(series.skew()), 6)
    except Exception:
        stats["skewness"] = 0.0
    try:
        stats["kurtosis"] = round(float(series.kurtosis()), 6)
    except Exception:
        stats["kurtosis"] = 0.0
    return stats


def _profile_categorical(series: pd.Series) -> dict:
    """Compute statistics for a categorical column."""
    top = series.value_counts().head(10)
    mode_val = series.mode()
    return {
        "top_values": {str(k): int(v) for k, v in top.items()},
        "mode": str(mode_val.iloc[0]) if not mode_val.empty else None,
    }


def _profile_text(series: pd.Series) -> dict:
    """Compute statistics for a free-text column."""
    lengths = series.dropna().astype(str).str.len()
    return {
        "avg_length": round(float(lengths.mean()), 2) if len(lengths) > 0 else 0.0,
        "min_length": int(lengths.min()) if len(lengths) > 0 else 0,
        "max_length": int(lengths.max()) if len(lengths) > 0 else 0,
    }


def _classify_column(series: pd.Series) -> tuple[bool, bool, bool]:
    """Return (is_numeric, is_categorical, is_text) flags."""
    if pd.api.types.is_numeric_dtype(series):
        return True, False, False

    if series.dtype == object:
        non_null = series.dropna()
        if len(non_null) == 0:
            return False, True, False
        avg_len = non_null.astype(str).str.len().mean()
        nunique_ratio = non_null.nunique() / max(len(non_null), 1)
        # Heuristic: long strings with high cardinality are "text"
        if avg_len > 50 or nunique_ratio > 0.5:
            return False, False, True
        return False, True, False

    return False, False, False


def _generate_warnings(df: pd.DataFrame, col_profiles: list[ColumnProfile]) -> list[str]:
    """Produce human-readable warnings about potential data issues."""
    warnings: list[str] = []

    for cp in col_profiles:
        if cp.null_pct > 50:
            warnings.append(f"Column '{cp.name}' has {cp.null_pct:.1f}% null values (>50%)")

        # Constant column: most frequent value covers >95% of non-null rows
        non_null = cp.count - cp.null_count
        if non_null > 0 and cp.unique_count == 1:
            warnings.append(f"Column '{cp.name}' is constant (single unique value)")
        elif non_null > 0:
            top_freq_ratio = (non_null - cp.unique_count + 1) / non_null  # rough
            # More precise check using value_counts
            series = df[cp.name].dropna()
            if len(series) > 0:
                mode_count = series.value_counts().iloc[0]
                if mode_count / len(series) > 0.95:
                    warnings.append(
                        f"Column '{cp.name}' has >95% single value (near-constant)"
                    )

        if cp.is_text and non_null > 0:
            unique_ratio = cp.unique_count / max(non_null, 1)
            if unique_ratio > 0.5:
                warnings.append(
                    f"Column '{cp.name}' has >50% unique text values — may be free-text"
                )

        if cp.is_numeric and "skewness" in cp.stats:
            if abs(cp.stats["skewness"]) > 2:
                warnings.append(
                    f"Column '{cp.name}' has high skewness ({cp.stats['skewness']:.2f})"
                )

    return warnings


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def profile_dataset(df: pd.DataFrame) -> DatasetProfile:
    """Create a comprehensive statistical profile of *df*.

    Args:
        df: The pandas DataFrame to profile.

    Returns:
        DatasetProfile containing per-column stats, correlations, and warnings.
    """
    logger.info("Profiling dataset with %d rows x %d columns", len(df), len(df.columns))

    # --- Per-column profiling ---
    col_profiles: list[ColumnProfile] = []
    numeric_cols: list[str] = []

    for col in df.columns:
        series = df[col]
        is_numeric, is_categorical, is_text = _classify_column(series)

        count = len(series)
        null_count = int(series.isna().sum())
        null_pct = round((null_count / max(count, 1)) * 100, 2)
        non_null = series.dropna()
        unique_count = int(non_null.nunique())
        unique_pct = round((unique_count / max(len(non_null), 1)) * 100, 2)

        # Compute type-specific stats
        stats: dict = {}
        if is_numeric:
            stats = _profile_numeric(series)
            numeric_cols.append(col)
        elif is_text:
            stats = {**_profile_text(series), **_profile_categorical(series)}
        elif is_categorical:
            stats = _profile_categorical(series)

        cp = ColumnProfile(
            name=col,
            dtype=str(series.dtype),
            count=count,
            null_count=null_count,
            null_pct=null_pct,
            unique_count=unique_count,
            unique_pct=unique_pct,
            is_numeric=is_numeric,
            is_categorical=is_categorical,
            is_text=is_text,
            stats=stats,
            correlation_with={},
        )
        col_profiles.append(cp)

    # --- Correlation matrix (numeric columns only) ---
    numeric_correlations: dict = {}
    if len(numeric_cols) >= 2:
        try:
            corr_matrix = df[numeric_cols].corr()
            numeric_correlations = {
                str(r): {str(c): round(float(v), 6) for c, v in row.items()}
                for r, row in corr_matrix.iterrows()
            }
            # Attach per-column correlations
            for cp in col_profiles:
                if cp.is_numeric and cp.name in numeric_correlations:
                    cp.correlation_with = {
                        k: v
                        for k, v in numeric_correlations[cp.name].items()
                        if k != cp.name
                    }
        except Exception as exc:
            logger.warning("Could not compute correlation matrix: %s", exc)

    # --- Warnings ---
    warnings = _generate_warnings(df, col_profiles)

    # --- Memory usage ---
    memory_mb = round(df.memory_usage(deep=True).sum() / (1024 * 1024), 4)

    profile = DatasetProfile(
        row_count=len(df),
        column_count=len(df.columns),
        memory_usage_mb=memory_mb,
        columns=[asdict(cp) for cp in col_profiles],
        numeric_correlations=numeric_correlations,
        warnings=warnings,
    )

    logger.info(
        "Profiling complete — %d columns, %d numeric, %d warnings",
        len(col_profiles),
        len(numeric_cols),
        len(warnings),
    )
    return profile
