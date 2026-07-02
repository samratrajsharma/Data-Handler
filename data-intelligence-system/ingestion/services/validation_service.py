"""
Data validation service — validates uploaded CSV and JSON files.
Checks encoding, schema, row counts, nulls, duplicates, and computes
a schema hash for version-to-version drift detection.
"""

import csv
import hashlib
import io
import json
import logging
from typing import Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ── Limits ────────────────────────────────────────────────────────────────
_MAX_SAMPLE_ROWS = 5
_SUPPORTED_ENCODINGS = ("utf-8", "utf-8-sig", "latin-1", "cp1252")


class ValidationResult(BaseModel):
    """Structured output from a file validation pass."""

    is_valid: bool
    row_count: int
    column_count: int
    columns: list[str]
    schema_hash: str
    errors: list[str]
    warnings: list[str]
    sample_data: list[dict]  # first N rows


class DataValidator:
    """Stateless validator with class-method entry points."""

    # ── CSV ────────────────────────────────────────────────────────────────

    @staticmethod
    async def validate_csv(file_data: bytes, file_name: str) -> ValidationResult:
        """Validate a CSV file.

        Checks performed:
        * Decoding with multiple encoding fallbacks
        * Header presence and uniqueness
        * Consistent column count per row
        * Null / empty-cell detection
        * Duplicate-row detection (hash-based)
        * Schema hash computation
        """
        errors: list[str] = []
        warnings: list[str] = []
        columns: list[str] = []
        sample_data: list[dict] = []
        row_count = 0

        # --- Decode -----------------------------------------------------------
        text: Optional[str] = None
        used_encoding: Optional[str] = None
        for enc in _SUPPORTED_ENCODINGS:
            try:
                text = file_data.decode(enc)
                used_encoding = enc
                break
            except (UnicodeDecodeError, ValueError):
                continue

        if text is None:
            return ValidationResult(
                is_valid=False,
                row_count=0,
                column_count=0,
                columns=[],
                schema_hash="",
                errors=[
                    f"Unable to decode {file_name} with any supported encoding "
                    f"({', '.join(_SUPPORTED_ENCODINGS)})"
                ],
                warnings=[],
                sample_data=[],
            )

        if used_encoding and used_encoding != "utf-8":
            warnings.append(
                f"File decoded with {used_encoding}; consider converting to UTF-8"
            )

        # --- Parse CSV --------------------------------------------------------
        reader = csv.reader(io.StringIO(text))
        rows: list[list[str]] = list(reader)

        if not rows:
            errors.append("CSV file is empty")
            return ValidationResult(
                is_valid=False,
                row_count=0,
                column_count=0,
                columns=[],
                schema_hash="",
                errors=errors,
                warnings=warnings,
                sample_data=[],
            )

        # --- Headers ----------------------------------------------------------
        columns = [col.strip() for col in rows[0]]
        if not columns or all(c == "" for c in columns):
            errors.append("CSV header row is empty or missing")
            return ValidationResult(
                is_valid=False,
                row_count=0,
                column_count=0,
                columns=[],
                schema_hash="",
                errors=errors,
                warnings=warnings,
                sample_data=[],
            )

        # Check for duplicate column names
        seen_cols: dict[str, int] = {}
        for col in columns:
            lower = col.lower()
            seen_cols[lower] = seen_cols.get(lower, 0) + 1
        dup_cols = [name for name, cnt in seen_cols.items() if cnt > 1]
        if dup_cols:
            warnings.append(f"Duplicate column names detected: {', '.join(dup_cols)}")

        col_count = len(columns)
        schema_hash = DataValidator.compute_schema_hash(columns)

        # --- Data rows --------------------------------------------------------
        data_rows = rows[1:]
        row_count = len(data_rows)

        null_cells = 0
        row_hashes: set[str] = set()
        duplicate_rows = 0
        inconsistent_rows = 0

        for idx, row in enumerate(data_rows):
            # Column count consistency
            if len(row) != col_count:
                inconsistent_rows += 1
                if inconsistent_rows <= 3:
                    warnings.append(
                        f"Row {idx + 2} has {len(row)} columns (expected {col_count})"
                    )

            # Null / empty detection
            for cell in row:
                stripped = cell.strip()
                if stripped == "" or stripped.lower() in ("null", "none", "na", "n/a"):
                    null_cells += 1

            # Duplicate detection (hash the full row)
            row_hash = hashlib.md5(
                "|".join(row).encode("utf-8"), usedforsecurity=False
            ).hexdigest()
            if row_hash in row_hashes:
                duplicate_rows += 1
            else:
                row_hashes.add(row_hash)

            # Sample data (first N rows)
            if idx < _MAX_SAMPLE_ROWS:
                row_dict: dict[str, str] = {}
                for ci, col_name in enumerate(columns):
                    row_dict[col_name] = row[ci] if ci < len(row) else ""
                sample_data.append(row_dict)

        if inconsistent_rows > 3:
            warnings.append(
                f"... and {inconsistent_rows - 3} more rows with inconsistent column counts"
            )

        if null_cells > 0:
            warnings.append(
                f"Found {null_cells} null/empty cells across {row_count} rows"
            )

        if duplicate_rows > 0:
            warnings.append(f"Found {duplicate_rows} duplicate rows")

        if row_count == 0:
            warnings.append("CSV has headers but no data rows")

        is_valid = len(errors) == 0
        return ValidationResult(
            is_valid=is_valid,
            row_count=row_count,
            column_count=col_count,
            columns=columns,
            schema_hash=schema_hash,
            errors=errors,
            warnings=warnings,
            sample_data=sample_data,
        )

    # ── JSON ──────────────────────────────────────────────────────────────

    @staticmethod
    async def validate_json(file_data: bytes, file_name: str) -> ValidationResult:
        """Validate a JSON file.

        Expects either:
        * An array of objects (records) — the primary format
        * A single object (treated as one record)
        """
        errors: list[str] = []
        warnings: list[str] = []
        columns: list[str] = []
        sample_data: list[dict] = []

        # --- Decode -----------------------------------------------------------
        text: Optional[str] = None
        for enc in _SUPPORTED_ENCODINGS:
            try:
                text = file_data.decode(enc)
                break
            except (UnicodeDecodeError, ValueError):
                continue

        if text is None:
            return ValidationResult(
                is_valid=False,
                row_count=0,
                column_count=0,
                columns=[],
                schema_hash="",
                errors=["Unable to decode JSON file"],
                warnings=[],
                sample_data=[],
            )

        # --- Parse JSON -------------------------------------------------------
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            return ValidationResult(
                is_valid=False,
                row_count=0,
                column_count=0,
                columns=[],
                schema_hash="",
                errors=[f"Invalid JSON: {exc.msg} (line {exc.lineno}, col {exc.colno})"],
                warnings=[],
                sample_data=[],
            )

        # --- Normalise to list of records ------------------------------------
        records: list[dict]
        if isinstance(parsed, list):
            records = parsed
        elif isinstance(parsed, dict):
            records = [parsed]
            warnings.append("JSON is a single object; treating as one record")
        else:
            return ValidationResult(
                is_valid=False,
                row_count=0,
                column_count=0,
                columns=[],
                schema_hash="",
                errors=["JSON root must be an array of objects or a single object"],
                warnings=[],
                sample_data=[],
            )

        row_count = len(records)
        if row_count == 0:
            warnings.append("JSON array is empty — no records found")
            return ValidationResult(
                is_valid=True,
                row_count=0,
                column_count=0,
                columns=[],
                schema_hash=DataValidator.compute_schema_hash([]),
                errors=[],
                warnings=warnings,
                sample_data=[],
            )

        # --- Validate each record is a dict -----------------------------------
        non_dict_count = 0
        valid_records: list[dict] = []
        for rec in records:
            if isinstance(rec, dict):
                valid_records.append(rec)
            else:
                non_dict_count += 1

        if non_dict_count > 0:
            warnings.append(
                f"{non_dict_count} of {row_count} items are not objects and will be skipped"
            )

        if not valid_records:
            return ValidationResult(
                is_valid=False,
                row_count=row_count,
                column_count=0,
                columns=[],
                schema_hash="",
                errors=["No valid object records found in JSON array"],
                warnings=warnings,
                sample_data=[],
            )

        # --- Extract columns (union of all keys) -----------------------------
        all_keys: set[str] = set()
        for rec in valid_records:
            all_keys.update(rec.keys())
        columns = sorted(all_keys)
        col_count = len(columns)
        schema_hash = DataValidator.compute_schema_hash(columns)

        # --- Null detection ---------------------------------------------------
        null_cells = 0
        for rec in valid_records:
            for key in columns:
                val = rec.get(key)
                if val is None or (isinstance(val, str) and val.strip() == ""):
                    null_cells += 1

        if null_cells > 0:
            warnings.append(
                f"Found {null_cells} null/empty values across {len(valid_records)} records"
            )

        # --- Duplicate detection (hash-based) ---------------------------------
        row_hashes: set[str] = set()
        duplicate_rows = 0
        for rec in valid_records:
            row_hash = hashlib.md5(
                json.dumps(rec, sort_keys=True, default=str).encode("utf-8"),
                usedforsecurity=False,
            ).hexdigest()
            if row_hash in row_hashes:
                duplicate_rows += 1
            else:
                row_hashes.add(row_hash)

        if duplicate_rows > 0:
            warnings.append(f"Found {duplicate_rows} duplicate records")

        # --- Key consistency --------------------------------------------------
        first_keys = set(valid_records[0].keys())
        inconsistent_schemas = sum(
            1 for rec in valid_records if set(rec.keys()) != first_keys
        )
        if inconsistent_schemas > 0:
            warnings.append(
                f"{inconsistent_schemas} records have different keys than the first record"
            )

        # --- Sample data ------------------------------------------------------
        for rec in valid_records[:_MAX_SAMPLE_ROWS]:
            # Stringify nested values for the sample
            sample_rec = {
                k: (json.dumps(v) if isinstance(v, (dict, list)) else str(v) if v is not None else "")
                for k, v in rec.items()
            }
            sample_data.append(sample_rec)

        is_valid = len(errors) == 0
        return ValidationResult(
            is_valid=is_valid,
            row_count=len(valid_records),
            column_count=col_count,
            columns=columns,
            schema_hash=schema_hash,
            errors=errors,
            warnings=warnings,
            sample_data=sample_data,
        )

    # ── Router ────────────────────────────────────────────────────────────

    @staticmethod
    async def validate_file(
        file_data: bytes, file_name: str, file_type: str
    ) -> ValidationResult:
        """Route to the correct validator based on *file_type*."""
        normalised = file_type.lower().strip().lstrip(".")

        if normalised in ("csv", "text/csv"):
            return await DataValidator.validate_csv(file_data, file_name)
        elif normalised in ("json", "application/json"):
            return await DataValidator.validate_json(file_data, file_name)
        else:
            return ValidationResult(
                is_valid=False,
                row_count=0,
                column_count=0,
                columns=[],
                schema_hash="",
                errors=[f"Unsupported file type: {file_type}"],
                warnings=[],
                sample_data=[],
            )

    # ── Schema hash ───────────────────────────────────────────────────────

    @staticmethod
    def compute_schema_hash(columns: list[str]) -> str:
        """SHA-256 of sorted, lowercased column names.

        This deterministic hash lets callers detect schema drift between
        successive dataset versions.
        """
        normalised = sorted(c.strip().lower() for c in columns)
        payload = "|".join(normalised).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()
