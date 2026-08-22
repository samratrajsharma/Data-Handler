"""
Schema Detector — Analyzes dataset columns to infer real data types.

Goes beyond basic pandas dtypes: detects emails, URLs, dates, phone numbers,
currencies, categories, IDs, booleans, and more by sampling actual values.
"""

import re
import logging
from dataclasses import dataclass, field, asdict
from typing import Optional

import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

# ── Patterns for type detection ──────────────────────────────────────────

EMAIL_RE = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
URL_RE = re.compile(r"^https?://[^\s]+$")
PHONE_RE = re.compile(r"^[\+]?[\d\s\-\(\)]{7,15}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
IP_RE = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")
CURRENCY_RE = re.compile(r"^[\$\€\£\¥]?\s*[\d,]+\.?\d*$")


@dataclass
class ColumnSchema:
    """Detected schema for a single column."""
    name: str
    pandas_dtype: str
    inferred_type: str  # email, url, date, phone, currency, categorical, numeric, text, boolean, id, unknown
    nullable: bool
    null_count: int
    null_percentage: float
    unique_count: int
    unique_percentage: float
    sample_values: list = field(default_factory=list)
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    mean: Optional[float] = None
    std: Optional[float] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None

    def to_dict(self):
        return asdict(self)


@dataclass
class DatasetSchema:
    """Full schema for a dataset."""
    row_count: int
    column_count: int
    columns: list  # list of ColumnSchema dicts
    detected_types_summary: dict = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)


def _match_ratio(series: pd.Series, pattern: re.Pattern) -> float:
    """What fraction of non-null string values match a regex pattern."""
    non_null = series.dropna().astype(str)
    if len(non_null) == 0:
        return 0.0
    matches = non_null.apply(lambda x: bool(pattern.match(x.strip())))
    return matches.mean()


def _is_date_column(series: pd.Series) -> bool:
    """Try to parse the column as dates."""
    non_null = series.dropna()
    if len(non_null) == 0:
        return False
    sample = non_null.head(100)
    try:
        parsed = pd.to_datetime(sample, errors="coerce")
        success_rate = parsed.notna().mean()
        return success_rate > 0.8
    except Exception:
        return False


def _infer_column_type(series: pd.Series, col_name: str) -> str:
    """Infer the semantic type of a column by analyzing its values."""
    non_null = series.dropna()
    if len(non_null) == 0:
        return "unknown"

    # Check if already numeric
    if pd.api.types.is_numeric_dtype(series):
        # Could be boolean (0/1)
        unique_vals = set(non_null.unique())
        if unique_vals <= {0, 1, 0.0, 1.0}:
            return "boolean"
        # Could be ID (all unique integers)
        if pd.api.types.is_integer_dtype(series) and non_null.nunique() == len(non_null):
            if "id" in col_name.lower():
                return "id"
        return "numeric"

    # Check boolean strings
    str_vals = non_null.astype(str).str.strip().str.lower()
    bool_values = {"true", "false", "yes", "no", "y", "n", "1", "0"}
    if set(str_vals.unique()) <= bool_values:
        return "boolean"

    # String-based detection (use sampling for large datasets)
    sample = non_null.head(200)

    # UUID / ID
    if _match_ratio(sample, UUID_RE) > 0.8:
        return "id"

    # Email
    if _match_ratio(sample, EMAIL_RE) > 0.8:
        return "email"

    # URL
    if _match_ratio(sample, URL_RE) > 0.8:
        return "url"

    # Date — checked before phone because the loose phone regex otherwise
    # captures ISO dates like "2021-01-01".
    if _is_date_column(sample):
        return "date"

    # Phone
    if _match_ratio(sample, PHONE_RE) > 0.7:
        return "phone"

    # IP Address
    if _match_ratio(sample, IP_RE) > 0.8:
        return "ip_address"

    # Currency
    if _match_ratio(sample, CURRENCY_RE) > 0.7:
        return "currency"

    # Categorical (low cardinality relative to row count)
    cardinality_ratio = non_null.nunique() / max(len(non_null), 1)
    if cardinality_ratio < 0.05 and non_null.nunique() <= 50:
        return "categorical"
    if cardinality_ratio < 0.1 and non_null.nunique() <= 20:
        return "categorical"

    # Free text (high cardinality, longer strings)
    avg_len = non_null.astype(str).str.len().mean()
    if avg_len > 50:
        return "text"

    # Default: short text / string
    return "text"


def detect_schema(df: pd.DataFrame) -> DatasetSchema:
    """Analyze a DataFrame and return a full schema with inferred types.

    Args:
        df: The pandas DataFrame to analyze.

    Returns:
        DatasetSchema with column-level type inference and statistics.
    """
    columns = []
    type_counts = {}

    for col_name in df.columns:
        series = df[col_name]
        inferred = _infer_column_type(series, col_name)

        null_count = int(series.isna().sum())
        total = len(series)
        non_null = series.dropna()

        col_schema = ColumnSchema(
            name=col_name,
            pandas_dtype=str(series.dtype),
            inferred_type=inferred,
            nullable=null_count > 0,
            null_count=null_count,
            null_percentage=round(null_count / max(total, 1) * 100, 2),
            unique_count=int(non_null.nunique()),
            unique_percentage=round(non_null.nunique() / max(len(non_null), 1) * 100, 2),
            sample_values=non_null.head(5).tolist(),
        )

        # String stats
        if series.dtype == object or inferred in ("text", "email", "url", "categorical"):
            lengths = non_null.astype(str).str.len()
            if len(lengths) > 0:
                col_schema.min_length = int(lengths.min())
                col_schema.max_length = int(lengths.max())

        # Numeric stats
        if inferred == "numeric" or inferred == "currency":
            try:
                numeric_vals = pd.to_numeric(non_null, errors="coerce").dropna()
                if len(numeric_vals) > 0:
                    col_schema.mean = round(float(numeric_vals.mean()), 4)
                    col_schema.std = round(float(numeric_vals.std()), 4)
                    col_schema.min_value = float(numeric_vals.min())
                    col_schema.max_value = float(numeric_vals.max())
            except Exception:
                pass

        columns.append(col_schema)
        type_counts[inferred] = type_counts.get(inferred, 0) + 1

    schema = DatasetSchema(
        row_count=len(df),
        column_count=len(df.columns),
        columns=[c.to_dict() for c in columns],
        detected_types_summary=type_counts,
    )

    logger.info(
        "Schema detected: %d rows, %d columns, types: %s",
        schema.row_count, schema.column_count, type_counts,
    )
    return schema
