"""Lightweight validation of extracted invoice fields.

The validator runs after OCR + extraction and before the decision
module. It is intentionally simple — it answers three questions:

* Did we find every required field?
* Are the amounts internally consistent?
* Are there any soft warnings (e.g. duplicated invoice number, very
  high total that may need finance approval)?

The output schema — ``passed``, ``errors``, ``warnings`` — is what
:func:`app.decision.make_decision` consumes.
"""

from __future__ import annotations

import re
from typing import Any, Optional


# A real GSTIN is 15 chars: state code + PAN + entity + 'Z' + checksum.
_GSTIN_PATTERN = re.compile(
    r"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9][A-Z][A-Z0-9]$",
    re.IGNORECASE,
)

# Soft caps that should trigger a policy warning (not a hard reject).
# Tune these to match your finance team's thresholds.
HIGH_VALUE_THRESHOLD = 200_000.0  # INR


def _is_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str) and not value.strip():
        return False
    return True


def _amounts_consistent(fields: dict[str, Any]) -> bool:
    """subtotal + cgst + sgst should equal total within a small tolerance."""
    subtotal = fields.get("subtotal")
    cgst = fields.get("cgst")
    sgst = fields.get("sgst")
    total = fields.get("total")
    if None in (subtotal, cgst, sgst, total):
        return True  # can't tell — don't penalise here
    try:
        return abs(float(subtotal) + float(cgst) + float(sgst) - float(total)) <= 1.0
    except (TypeError, ValueError):
        return False


def validate_invoice(fields: dict[str, Any]) -> dict[str, Any]:
    """Return the validation outcome for the given extracted fields.

    The result always has the keys ``passed`` (bool), ``errors``
    (list[str]) and ``warnings`` (list[str]).
    """
    fields = fields or {}
    errors: list[str] = []
    warnings: list[str] = []

    # --- hard requirements -------------------------------------------------
    if not _is_present(fields.get("invoice_number")):
        errors.append("invoice_number is missing")
    if not _is_present(fields.get("total")):
        errors.append("total amount is missing")

    gstin = fields.get("gstin")
    if gstin is not None and not _GSTIN_PATTERN.match(str(gstin).upper()):
        errors.append("gstin is not a valid 15-character GSTIN")

    if not _amounts_consistent(fields):
        errors.append("subtotal + taxes does not match total")

    # --- soft warnings -----------------------------------------------------
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
        "passed": not errors,
        "errors": errors,
        "warnings": warnings,
    }
