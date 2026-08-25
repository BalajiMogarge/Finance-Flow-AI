"""Final approve/reject decision for an invoice.

Given the validation output, the extracted fields and the OCR average
confidence, :func:`make_decision` returns one of three outcomes:

* ``APPROVE`` — invoice passed every validation rule, has no warnings
  and was OCR'd with high confidence.
* ``REJECT`` — invoice has a hard failure (invalid GSTIN, missing
  invoice number, amount inconsistency) or OCR confidence is too low
  to trust the extracted values.
* ``PENDING REVIEW`` — invoice has a soft warning (e.g. company policy
  flag) or confidence is in the grey zone and a human should look at
  it before paying.

The shape of the returned dict matches what the ``/upload`` endpoint
emits to the frontend.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional


# ---------------------------------------------------------------------------
# Thresholds — keep them in one place so they can be tweaked by ops without
# hunting through the rule logic below.
# ---------------------------------------------------------------------------

# OCR average_confidence must be at least this to auto-approve.
APPROVE_CONFIDENCE = 0.85
# Below this, the document is too noisy to trust at all and gets rejected.
REJECT_CONFIDENCE = 0.40


# ---------------------------------------------------------------------------
# Rule helpers
# ---------------------------------------------------------------------------

# Indian GSTIN checksum. Implements the Luhn-style algorithm defined by
# the GSTN. Returns ``True`` when the checksum is valid. We do not
# require every digit to be uppercase here — caller is responsible for
# upper-casing the value before calling.
def _gstin_checksum_is_valid(gstin: str) -> bool:
    if not gstin or len(gstin) != 15:
        return False
    chars = gstin.upper()
    if not chars[:14].isalnum() or not chars[14].isalnum():
        return False

    # Character -> value map per the GSTN spec.
    value_map = {
        **{c: i for i, c in enumerate("0123456789")},
        **{c: i + 10 for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ")},
    }
    factor = 1
    total = 0
    for ch in chars[:14]:
        total += value_map[ch] * factor
        factor = 1 if factor == 2 else 2
        # If the product exceeds one digit, subtract 9 — equivalent to
        # summing the digits of the product.
        if factor == 2:
            # re-derive the running total with the doubled contribution
            pass
    # Simpler equivalent of the loop above, kept readable:
    total = 0
    for index, ch in enumerate(chars[:14]):
        product = value_map[ch] * (2 if index % 2 == 0 else 1)
        total += product if product < 10 else (product - 9)
    expected = (10 - (total % 10)) % 10
    return value_map[chars[14]] == expected


def _is_valid_gstin(value: Optional[str]) -> bool:
    """True if ``value`` looks like a real 15-character GSTIN."""
    if not value:
        return False
    if not isinstance(value, str):
        return False
    if len(value) != 15:
        return False
    return _gstin_checksum_is_valid(value)


def _collect_warnings(validation: dict[str, Any]) -> list[str]:
    """Return the list of soft warnings emitted by validation."""
    return list(validation.get("warnings", []) or [])


def _collect_errors(validation: dict[str, Any]) -> list[str]:
    """Return the list of hard errors emitted by validation."""
    return list(validation.get("errors", []) or [])


def _amounts_are_consistent(fields: dict[str, Any]) -> bool:
    """True if subtotal + cgst + sgst matches the total within 1 rupee.

    A small tolerance is used because OCR frequently drops the last
    paisa on rounded totals. We only check the arithmetic when all four
    numbers were actually extracted.
    """
    subtotal = fields.get("subtotal")
    cgst = fields.get("cgst")
    sgst = fields.get("sgst")
    total = fields.get("total")

    if None in (subtotal, cgst, sgst, total):
        return True  # not enough info — let validation flag missing fields

    try:
        computed = float(subtotal) + float(cgst) + float(sgst)
    except (TypeError, ValueError):
        return False
    return abs(computed - float(total)) <= 1.0


def _missing_optional_fields(fields: dict[str, Any]) -> list[str]:
    """List of optional fields that are absent — drives PENDING REVIEW."""
    optional = ["vendor", "date", "gstin"]
    return [name for name in optional if not fields.get(name)]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def make_decision(
    validation: dict[str, Any],
    fields: dict[str, Any],
    confidence: Optional[float],
) -> dict[str, Any]:
    """Decide whether an invoice should be APPROVED, REJECTED or PENDING REVIEW.

    Parameters
    ----------
    validation:
        Output of the validation stage. Expected keys: ``passed`` (bool),
        ``errors`` (list[str]) and ``warnings`` (list[str]).
    fields:
        Extracted invoice fields as returned by ``extract_invoice_fields``.
    confidence:
        Average OCR confidence in the range ``[0, 1]``. ``None`` is
        treated as zero.

    Returns
    -------
    dict
        ``{"decision", "confidence", "reason", "risk_level"}``.
    """
    validation = validation or {}
    fields = fields or {}
    try:
        confidence_value = float(confidence) if confidence is not None else 0.0
    except (TypeError, ValueError):
        confidence_value = 0.0

    errors = _collect_errors(validation)
    warnings = _collect_warnings(validation)

    # ------------------------------------------------------------------
    # REJECT path — checked first so hard failures always win.
    # ------------------------------------------------------------------
    if not _is_valid_gstin(fields.get("gstin")) and fields.get("gstin") is not None:
        return _reject(
            confidence_value,
            "Invalid GSTIN checksum; vendor identity cannot be confirmed.",
        )

    if not fields.get("invoice_number"):
        return _reject(
            confidence_value,
            "Invoice number is missing — invoice cannot be matched to a PO.",
        )

    if not _amounts_are_consistent(fields):
        return _reject(
            confidence_value,
            "Amount inconsistency: subtotal + taxes does not match the total.",
        )

    if confidence_value < REJECT_CONFIDENCE:
        return _reject(
            confidence_value,
            f"OCR confidence {confidence_value:.2f} is below the {REJECT_CONFIDENCE:.2f} threshold.",
        )

    # ------------------------------------------------------------------
    # PENDING REVIEW path — soft warnings, mid-range confidence, or
    # missing optional fields.
    # ------------------------------------------------------------------
    pending_reasons: list[str] = []

    if warnings:
        pending_reasons.append(
            "Company policy warning: " + "; ".join(warnings)
        )
    if REJECT_CONFIDENCE <= confidence_value < APPROVE_CONFIDENCE:
        pending_reasons.append(
            f"OCR confidence {confidence_value:.2f} is in the review band "
            f"[{REJECT_CONFIDENCE:.2f}, {APPROVE_CONFIDENCE:.2f})."
        )
    missing_optional = _missing_optional_fields(fields)
    if missing_optional:
        pending_reasons.append(
            "Missing optional fields: " + ", ".join(missing_optional)
        )

    if pending_reasons:
        return _pending(confidence_value, " ".join(pending_reasons))

    # ------------------------------------------------------------------
    # APPROVE path — clean validation, no warnings, high confidence.
    # ------------------------------------------------------------------
    if validation.get("passed") and confidence_value >= APPROVE_CONFIDENCE:
        return _approve(
            confidence_value,
            "Invoice passed all validation checks with high OCR confidence.",
        )

    # Fallback: validation didn't pass but no hard error was raised. Treat
    # as pending so a human can take a look.
    return _pending(
        confidence_value,
        "Validation did not pass; manual review required.",
    )


# ---------------------------------------------------------------------------
# Response builders
# ---------------------------------------------------------------------------

def _approve(confidence: float, reason: str) -> dict[str, Any]:
    return {
        "decision": "APPROVE",
        "confidence": round(confidence, 4),
        "reason": reason,
        "risk_level": "LOW",
    }


def _reject(confidence: float, reason: str) -> dict[str, Any]:
    return {
        "decision": "REJECT",
        "confidence": round(confidence, 4),
        "reason": reason,
        "risk_level": "HIGH",
    }


def _pending(confidence: float, reason: str) -> dict[str, Any]:
    return {
        "decision": "PENDING REVIEW",
        "confidence": round(confidence, 4),
        "reason": reason,
        "risk_level": "MEDIUM",
    }
