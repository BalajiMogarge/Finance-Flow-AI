"""Lightweight validation of extracted invoice fields.

The validator runs after OCR + extraction and before the decision
module. It checks:
- Required fields (invoice_number, total)
- Indian GSTIN format, valid state codes (01-38, 97, 99), and Luhn mod 36 checksum
- Mathematical consistency: subtotal + cgst + sgst == total (<= 1.00 INR tolerance)
- Soft policy warnings: high value (>= 200,000 INR), missing vendor, missing date
"""

from __future__ import annotations

import re
from typing import Any

ALPHABET_36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
VALID_STATE_CODES = {f"{i:02d}" for i in range(1, 39)} | {"97", "99"}

_GSTIN_FORMAT_REGEX = re.compile(
    r"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9][A-Z][A-Z0-9]$",
    re.IGNORECASE,
)

HIGH_VALUE_THRESHOLD = 200_000.0  # INR


def validate_gstin_checksum(gstin: str) -> tuple[bool, str]:
    """Validate 15-char Indian GSTIN structure, state code, and Mod 36 checksum.

    Returns:
        (is_valid, reason)
    """
    if not gstin or len(gstin.strip()) != 15:
        return False, "GSTIN must be exactly 15 characters long"

    cleaned = gstin.strip().upper()
    if not _GSTIN_FORMAT_REGEX.match(cleaned):
        return False, "GSTIN format is invalid (must be 2-digit state + 10-char PAN + 1 entity + Z + check digit)"

    state_code = cleaned[:2]
    if state_code not in VALID_STATE_CODES:
        return False, f"Invalid state code '{state_code}' in GSTIN (must be 01-38, 97, or 99)"

    total = 0
    factor = 1
    for ch in cleaned[:14]:
        idx = ALPHABET_36.find(ch)
        if idx == -1:
            return False, f"Invalid character '{ch}' in GSTIN"
        product = idx * factor
        total += (product // 36) + (product % 36)
        factor = 1 if factor == 2 else 2

    expected_check_digit = ALPHABET_36[(36 - (total % 36)) % 36]
    actual_check_digit = cleaned[14]

    if actual_check_digit != expected_check_digit:
        return (
            False,
            f"Invalid GSTIN checksum: expected check digit '{expected_check_digit}', got '{actual_check_digit}'",
        )

    return True, "Valid GSTIN"


def _is_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str) and not value.strip():
        return False
    return True


def amounts_consistent(fields: dict[str, Any]) -> bool:
    """Check if subtotal + taxes equals total within 1.00 INR tolerance.

    Handles:
    - Intra-state GST: subtotal + cgst + sgst == total
    - Inter-state GST: subtotal + igst == total
    - Combined taxes: subtotal + cgst + sgst + igst == total (if multiple present)
    """
    subtotal = fields.get("subtotal")
    total = fields.get("total")
    cgst = fields.get("cgst")
    sgst = fields.get("sgst")
    igst = fields.get("igst")

    if subtotal is None or total is None:
        return True  # Insufficient information to penalize

    try:
        subtotal_val = float(subtotal)
        total_val = float(total)
        cgst_val = float(cgst) if cgst is not None else None
        sgst_val = float(sgst) if sgst is not None else None
        igst_val = float(igst) if igst is not None else None

        has_cgst_sgst = cgst_val is not None and sgst_val is not None
        has_igst = igst_val is not None

        # If no tax fields are extracted, cannot penalize
        if not has_cgst_sgst and not has_igst:
            return True

        candidates: list[float] = []

        # 1. Inter-state IGST
        if has_igst:
            candidates.append(subtotal_val + igst_val)
            if cgst_val is not None or sgst_val is not None:
                candidates.append(subtotal_val + igst_val + (cgst_val or 0.0) + (sgst_val or 0.0))

        # 2. Intra-state CGST + SGST
        if has_cgst_sgst:
            candidates.append(subtotal_val + cgst_val + sgst_val)

        for expected in candidates:
            if round(abs(expected - total_val), 2) <= 1.00:
                return True

        return False
    except (TypeError, ValueError):
        return False


def validate_invoice(fields: dict[str, Any]) -> dict[str, Any]:
    """Validate extracted invoice dictionary.

    Returns:
        dict: {"passed": bool, "errors": list[str], "warnings": list[str]}
    """
    fields = fields or {}
    errors: list[str] = []
    warnings: list[str] = []

    # --- Hard validation rules ---
    if not _is_present(fields.get("invoice_number")):
        errors.append("invoice_number is missing")
    if not _is_present(fields.get("total")):
        errors.append("total amount is missing")

    gstin = fields.get("gstin")
    if gstin is not None:
        is_valid, reason = validate_gstin_checksum(str(gstin))
        if not is_valid:
            errors.append(reason)

    if not amounts_consistent(fields):
        errors.append("subtotal + taxes does not match total within 1.00 INR tolerance")

    # --- Soft warning rules ---
    if not _is_present(fields.get("vendor")):
        warnings.append("vendor name is missing")
    if not _is_present(fields.get("date")):
        warnings.append("invoice date is missing")

    total = fields.get("total")
    if isinstance(total, (int, float)) and total >= HIGH_VALUE_THRESHOLD:
        warnings.append(
            f"high-value invoice (>= {HIGH_VALUE_THRESHOLD:,.0f} INR) — policy review required"
        )

    return {
        "passed": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }
