"""
Data Cleaning Pipeline — configurable steps to clean raw datasets.

Steps:
1. Remove duplicate rows
2. Handle null values (drop, fill, interpolate)
3. Normalize text (trim whitespace, case normalization)
4. Standardize date formats
5. Remove outliers (optional, IQR-based)
6. Fix encoding issues
"""

import logging
from dataclasses import dataclass, field, asdict
from typing import Literal

import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class CleaningStep:
    """Record of a single cleaning action taken."""
    step: str
    description: str
    rows_before: int
    rows_after: int
    rows_affected: int
    columns_affected: list = field(default_factory=list)


@dataclass
class CleaningReport:
    """Full report of all cleaning steps applied."""
    original_rows: int
    original_columns: int
    final_rows: int
    final_columns: int
    steps: list = field(default_factory=list)  # list of CleaningStep dicts
    total_rows_removed: int = 0
    total_nulls_filled: int = 0

    def to_dict(self):
        return asdict(self)


def remove_duplicates(df: pd.DataFrame) -> tuple[pd.DataFrame, CleaningStep]:
    """Remove exact duplicate rows."""
    before = len(df)
    df = df.drop_duplicates().reset_index(drop=True)
    after = len(df)
    step = CleaningStep(
        step="remove_duplicates",
        description=f"Removed {before - after} duplicate rows",
        rows_before=before,
        rows_after=after,
        rows_affected=before - after,
    )
    logger.info("Dedup: %d → %d rows (%d removed)", before, after, before - after)
    return df, step


def handle_nulls(
    df: pd.DataFrame,
    strategy: Literal["drop_rows", "fill_mean", "fill_median", "fill_mode", "fill_empty"] = "fill_mode",
) -> tuple[pd.DataFrame, CleaningStep]:
    """Handle null values based on the chosen strategy."""
    before = len(df)
    total_nulls_before = int(df.isna().sum().sum())
    affected_cols = [c for c in df.columns if df[c].isna().any()]

    if strategy == "drop_rows":
        df = df.dropna().reset_index(drop=True)
    elif strategy == "fill_mean":
        for col in df.select_dtypes(include=[np.number]).columns:
            df[col] = df[col].fillna(df[col].mean())
        for col in df.select_dtypes(exclude=[np.number]).columns:
            df[col] = df[col].fillna(df[col].mode().iloc[0] if not df[col].mode().empty else "")
    elif strategy == "fill_median":
        for col in df.select_dtypes(include=[np.number]).columns:
            df[col] = df[col].fillna(df[col].median())
        for col in df.select_dtypes(exclude=[np.number]).columns:
            df[col] = df[col].fillna(df[col].mode().iloc[0] if not df[col].mode().empty else "")
    elif strategy == "fill_mode":
        for col in df.columns:
            mode = df[col].mode()
            if not mode.empty:
                df[col] = df[col].fillna(mode.iloc[0])
    elif strategy == "fill_empty":
        df = df.fillna("")

    after = len(df)
    total_nulls_after = int(df.isna().sum().sum())

    step = CleaningStep(
        step="handle_nulls",
        description=f"Strategy: {strategy}. Nulls: {total_nulls_before} → {total_nulls_after}",
        rows_before=before,
        rows_after=after,
        rows_affected=before - after,
        columns_affected=affected_cols,
    )
    logger.info("Nulls: %s, %d → %d nulls", strategy, total_nulls_before, total_nulls_after)
    return df, step


def normalize_text(df: pd.DataFrame) -> tuple[pd.DataFrame, CleaningStep]:
    """Trim whitespace and normalize text columns."""
    text_cols = df.select_dtypes(include=["object"]).columns.tolist()
    changes = 0

    for col in text_cols:
        original = df[col].copy()
        df[col] = df[col].astype(str).str.strip()
        # Count actual changes
        changed = (original.astype(str) != df[col]).sum()
        changes += int(changed)

    step = CleaningStep(
        step="normalize_text",
        description=f"Trimmed whitespace in {len(text_cols)} text columns, {changes} values changed",
        rows_before=len(df),
        rows_after=len(df),
        rows_affected=changes,
        columns_affected=text_cols,
    )
    logger.info("Text normalization: %d columns, %d values changed", len(text_cols), changes)
    return df, step


def remove_outliers(
    df: pd.DataFrame,
    iqr_multiplier: float = 1.5,
) -> tuple[pd.DataFrame, CleaningStep]:
    """Remove rows with numeric outliers using IQR method."""
    before = len(df)
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    mask = pd.Series([True] * len(df), index=df.index)

    for col in numeric_cols:
        q1 = df[col].quantile(0.25)
        q3 = df[col].quantile(0.75)
        iqr = q3 - q1
        lower = q1 - iqr_multiplier * iqr
        upper = q3 + iqr_multiplier * iqr
        mask &= (df[col] >= lower) & (df[col] <= upper) | df[col].isna()

    df = df[mask].reset_index(drop=True)
    after = len(df)

    step = CleaningStep(
        step="remove_outliers",
        description=f"IQR method (multiplier={iqr_multiplier}), removed {before - after} outlier rows",
        rows_before=before,
        rows_after=after,
        rows_affected=before - after,
        columns_affected=numeric_cols,
    )
    logger.info("Outliers: %d → %d rows (%d removed)", before, after, before - after)
    return df, step


def drop_columns(df: pd.DataFrame, columns: list[str]) -> tuple[pd.DataFrame, CleaningStep]:
    """Remove the named columns (silently ignores ones not present)."""
    existing = [c for c in columns if c in df.columns]
    before = len(df.columns)
    df = df.drop(columns=existing)
    step = CleaningStep(
        step="drop_columns",
        description=f"Dropped {len(existing)} column(s): {', '.join(existing) if existing else 'none'}",
        rows_before=len(df), rows_after=len(df), rows_affected=0,
        columns_affected=existing,
    )
    logger.info("Drop columns: %d -> %d columns (dropped %d)", before, len(df.columns), len(existing))
    return df, step


def normalize_case(df: pd.DataFrame, mode: str) -> tuple[pd.DataFrame, CleaningStep]:
    """Apply a case transformation to text columns AND column names.

    mode is one of ``lower``, ``upper`` or ``title``.

    Renames column headers and lowercases/uppercases/titlecases the cell
    values of every text/object column. Users intuitively expect "lowercase
    everything" to include the column headings — this matches that
    expectation. Use :func:`standardize_column_names` afterwards if you also
    want to strip special characters / collapse whitespace into snake_case.
    """
    text_cols = df.select_dtypes(include=["object"]).columns.tolist()
    # 1. Cell values
    if mode == "lower":
        for col in text_cols:
            df[col] = df[col].astype(str).str.lower()
    elif mode == "upper":
        for col in text_cols:
            df[col] = df[col].astype(str).str.upper()
    elif mode == "title":
        for col in text_cols:
            df[col] = df[col].astype(str).str.title()
    # 2. Column names (always, regardless of which columns are text)
    rename_map: dict = {}
    for col in df.columns:
        col_str = str(col)
        if mode == "lower":
            new_name = col_str.lower()
        elif mode == "upper":
            new_name = col_str.upper()
        elif mode == "title":
            new_name = col_str.title()
        else:
            new_name = col_str
        if new_name != col_str:
            rename_map[col] = new_name
    if rename_map:
        df = df.rename(columns=rename_map)
    step = CleaningStep(
        step="normalize_case",
        description=(
            f"Applied {mode}-case to {len(text_cols)} text column(s) "
            f"and renamed {len(rename_map)} column heading(s)"
        ),
        rows_before=len(df), rows_after=len(df), rows_affected=0,
        columns_affected=list(set(text_cols + list(rename_map.values()))),
    )
    logger.info(
        "Case normalisation '%s' applied to %d text columns; %d headings renamed",
        mode, len(text_cols), len(rename_map),
    )
    return df, step


def encode_categorical(
    df: pd.DataFrame, specs: list[dict] | None
) -> tuple[pd.DataFrame, CleaningStep]:
    """Apply per-column encoding to convert categorical columns into numeric.

    ``specs`` is a list of ``{"column": str, "mode": "onehot" | "label"}``.
    One-hot expands each column into N boolean columns and drops the original;
    label replaces values with integer codes (-1 for missing).
    """
    applied: list[str] = []
    touched: list[str] = []
    for spec in (specs or []):
        col = spec.get("column") if isinstance(spec, dict) else None
        mode = spec.get("mode") if isinstance(spec, dict) else None
        if not col or col not in df.columns:
            continue
        touched.append(col)
        try:
            if mode == "onehot":
                df = pd.get_dummies(df, columns=[col], prefix=str(col), dummy_na=False)
                applied.append(f"{col} → one-hot")
            elif mode == "label":
                codes, _ = pd.factorize(df[col])  # NaN -> -1
                df[col] = codes
                applied.append(f"{col} → label codes")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Encoding failed for column '%s' (%s): %s", col, mode, exc)
            continue
    step = CleaningStep(
        step="encode_categorical",
        description=(
            f"Encoded {len(applied)} column(s): {', '.join(applied)}"
            if applied else "No encoding applied"
        ),
        rows_before=len(df), rows_after=len(df), rows_affected=0,
        columns_affected=touched,
    )
    logger.info("Categorical encoding: %d columns encoded", len(applied))
    return df, step


def standardize_column_names(df: pd.DataFrame) -> tuple[pd.DataFrame, CleaningStep]:
    """Rename columns to lowercase snake_case (e.g. ``Customer Name`` -> ``customer_name``)."""
    import re
    rename: dict = {}
    for c in df.columns:
        clean = re.sub(r"[^a-zA-Z0-9_]+", "_", str(c).strip()).strip("_").lower()
        if clean and clean != c:
            rename[c] = clean
    df = df.rename(columns=rename)
    step = CleaningStep(
        step="standardize_column_names",
        description=f"Renamed {len(rename)} column(s) to snake_case",
        rows_before=len(df), rows_after=len(df), rows_affected=0,
        columns_affected=list(rename.keys()),
    )
    logger.info("Column-name standardisation: %d renamed", len(rename))
    return df, step


def run_cleaning_pipeline(
    df: pd.DataFrame,
    null_strategy: str = "fill_mode",
    remove_dupes: bool = True,
    normalize: bool = True,
    handle_outliers: bool = False,
    iqr_multiplier: float = 1.5,
    drop_cols: list[str] | None = None,
    case_normalize: str = "none",
    standardize_columns: bool = False,
    encode_columns: list[dict] | None = None,
) -> tuple[pd.DataFrame, CleaningReport]:
    """Run the full cleaning pipeline on a DataFrame.

    Args:
        df: Input DataFrame.
        null_strategy: How to handle nulls (drop_rows, fill_mean, fill_median, fill_mode, fill_empty).
        remove_dupes: Whether to remove duplicate rows.
        normalize: Whether to normalize text columns.
        handle_outliers: Whether to remove numeric outliers.
        iqr_multiplier: IQR multiplier for outlier detection.
        drop_cols: Optional list of column names to drop before processing.
        case_normalize: ``none``/``lower``/``upper``/``title`` — applied to text columns.
        standardize_columns: Rename columns to lowercase snake_case.

    Returns:
        Tuple of (cleaned DataFrame, CleaningReport).
    """
    original_rows = len(df)
    original_cols = len(df.columns)
    steps = []

    # Step 0a: Drop unwanted columns (use the original names the user picked).
    if drop_cols:
        df, step = drop_columns(df, drop_cols)
        steps.append(asdict(step))

    # Step 0b: Encode categorical columns BEFORE renaming, so the user's
    # original column names (the ones they see in the UI) match.
    if encode_columns:
        df, step = encode_categorical(df, encode_columns)
        steps.append(asdict(step))

    # Step 0c: Standardize remaining column names to snake_case.
    if standardize_columns:
        df, step = standardize_column_names(df)
        steps.append(asdict(step))

    # Step 1: Remove duplicates
    if remove_dupes:
        df, step = remove_duplicates(df)
        steps.append(asdict(step))

    # Step 2: Handle nulls
    df, step = handle_nulls(df, strategy=null_strategy)
    steps.append(asdict(step))

    # Step 3: Normalize text (trim whitespace)
    if normalize:
        df, step = normalize_text(df)
        steps.append(asdict(step))

    # Step 3b: Case normalisation
    if case_normalize and case_normalize != "none":
        df, step = normalize_case(df, case_normalize)
        steps.append(asdict(step))

    # Step 4: Remove outliers (optional)
    if handle_outliers:
        df, step = remove_outliers(df, iqr_multiplier=iqr_multiplier)
        steps.append(asdict(step))

    report = CleaningReport(
        original_rows=original_rows,
        original_columns=original_cols,
        final_rows=len(df),
        final_columns=len(df.columns),
        steps=steps,
        total_rows_removed=original_rows - len(df),
        total_nulls_filled=int(df.isna().sum().sum()),
    )

    logger.info(
        "Cleaning complete: %d → %d rows, %d steps applied",
        original_rows, len(df), len(steps),
    )
    return df, report
