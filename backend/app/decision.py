"""Deterministic rule-based decision engine for invoice approvals.

Evaluates validation output, extracted fields, and OCR confidence:
- APPROVE: All validation checks pass, no policy warnings, OCR confidence >= 0.85.
- PENDING REVIEW: Confidence in [0.40, 0.85), soft policy warnings (e.g. total >= 200,000 INR),
  or missing optional fields.
- REJECT: Hard failures (missing invoice_number, invalid GSTIN checksum / bad state code,
  arithmetic mismatch > 1.00 INR), or OCR confidence < 0.40.

Zero LLM in the approval path — decisions are 100% deterministic and auditable.
"""

from __future__ import annotations

from typing import Any

from .validator import amounts_consistent, validate_gstin_checksum

# Decision boundary thresholds
APPROVE_CONFIDENCE = 0.85
REJECT_CONFIDENCE = 0.40


def _gstin_checksum_is_valid(gstin: str) -> bool:
    """Validate 15-character GSTIN checksum (returns bool)."""
    valid, _ = validate_gstin_checksum(gstin)
    return valid


def make_decision(
    validation: dict[str, Any],
    fields: dict[str, Any],
    confidence: float | None,
) -> dict[str, Any]:
    """Decide whether an invoice should be APPROVED, REJECTED, or PENDING REVIEW.

    Parameters:
        validation: output of validate_invoice
        fields: extracted invoice fields
        confidence: average OCR confidence [0.0, 1.0]

    Returns:
        dict: {"decision": str, "confidence": float, "reason": str, "risk_level": str}
    """
    validation = validation or {}
    fields = fields or {}
    try:
        confidence_val = float(confidence) if confidence is not None else 0.0
    except (TypeError, ValueError):
        confidence_val = 0.0

    errors = list(validation.get("errors", []) or [])
    warnings = list(validation.get("warnings", []) or [])

    # 1. HARD REJECT CHECKS
    gstin = fields.get("gstin")
    if gstin is not None:
        is_valid, reason = validate_gstin_checksum(str(gstin))
        if not is_valid:
            return _reject(confidence_val, f"GSTIN rejection: {reason}", "HIGH")

    if not fields.get("invoice_number"):
        return _reject(
            confidence_val,
            "Invoice number is missing — invoice cannot be matched to purchase order.",
            "HIGH",
        )

    if not amounts_consistent(fields):
        return _reject(
            confidence_val,
            "Amount inconsistency: subtotal + taxes does not match total within 1.00 INR tolerance.",
            "HIGH",
        )

    if errors:
        return _reject(confidence_val, f"Validation failure: {'; '.join(errors)}", "HIGH")

    if confidence_val < REJECT_CONFIDENCE:
        return _reject(
            confidence_val,
            f"OCR confidence {confidence_val:.2f} is below the {REJECT_CONFIDENCE:.2f} threshold.",
            "HIGH",
        )

    # 2. PENDING REVIEW CHECKS
    pending_reasons: list[str] = []

    if warnings:
        pending_reasons.append(f"Policy warning: {'; '.join(warnings)}")

    if REJECT_CONFIDENCE <= confidence_val < APPROVE_CONFIDENCE:
        pending_reasons.append(
            f"OCR confidence {confidence_val:.2f} is in review band [{REJECT_CONFIDENCE:.2f}, {APPROVE_CONFIDENCE:.2f})."
        )

    missing_optional = [k for k in ("vendor", "date") if not fields.get(k)]
    if missing_optional:
        pending_reasons.append(f"Missing fields: {', '.join(missing_optional)}")

    if pending_reasons:
        return _pending(confidence_val, " | ".join(pending_reasons), "MEDIUM")

    # 3. APPROVE PATH
    if validation.get("passed", False) and confidence_val >= APPROVE_CONFIDENCE:
        return _approve(
            confidence_val,
            "Invoice passed all validation checks and arithmetic reconciliation with high OCR confidence.",
            "LOW",
        )

    return _pending(confidence_val, "Manual review required.", "MEDIUM")


def _approve(confidence: float, reason: str, risk: str) -> dict[str, Any]:
    return {
        "decision": "APPROVE",
        "confidence": round(confidence, 4),
        "reason": reason,
        "risk_level": risk,
    }


def _reject(confidence: float, reason: str, risk: str) -> dict[str, Any]:
    return {
        "decision": "REJECT",
        "confidence": round(confidence, 4),
        "reason": reason,
        "risk_level": risk,
    }


def _pending(confidence: float, reason: str, risk: str) -> dict[str, Any]:
    return {
        "decision": "PENDING REVIEW",
        "confidence": round(confidence, 4),
        "reason": reason,
        "risk_level": risk,
    }
