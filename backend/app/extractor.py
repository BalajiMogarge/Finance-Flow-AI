"""Regex-based field extraction from OCR output.

The :func:`extract_invoice_fields` function takes the dict produced by
:func:`app.ocr.image_to_text` and pulls out the fields a finance team
cares about: ``invoice_number``, ``vendor``, ``date``, ``GSTIN``,
``subtotal``, ``CGST``, ``SGST`` and ``total``.

The patterns are deliberately tolerant — OCR is noisy, so each field
falls back to a list of increasingly permissive patterns and finally to
``None`` if nothing matches. Numbers are normalised to ``float`` so the
frontend can render them directly.
"""

from __future__ import annotations

import re
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Number parsing
# ---------------------------------------------------------------------------

# Matches an amount like "1,234.56", "1234.56", "1.234,56" or "1234".
# Group 1 is the integer part, group 2 the fractional part. The regex
# intentionally accepts an Indian-style "1,23,456.78" grouping.
_NUMBER_PATTERN = re.compile(
    r"""
    (?<![A-Za-z0-9])              # not glued to an alphanumeric char on the left
    (?P<int>\d{1,3}(?:[,]\d{2,3})*|\d+)  # 1234 or 1,23,456
    (?:[.](?P<frac>\d{1,2}))?     # optional .56
    (?![A-Za-z0-9])               # not glued on the right
    """,
    re.VERBOSE,
)


def _parse_number(raw: str) -> Optional[float]:
    """Parse a numeric token pulled out of OCR text into a float.

    Handles commas as thousands separators and a single dot as the decimal
    mark. Returns ``None`` when the input can't be interpreted.
    """
    if raw is None:
        return None
    cleaned = raw.replace(",", "").replace(" ", "").strip()
    # OCR sometimes swaps '.' and ',' for decimal marks.
    if cleaned.count(".") > 1 and "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif cleaned.count(",") == 1 and cleaned.count(".") == 0:
        cleaned = cleaned.replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _find_amount_after_label(
    text: str, label_patterns: list[re.Pattern[str]]
) -> Optional[float]:
    """Return the first numeric amount that appears after any of the labels."""
    for pattern in label_patterns:
        for match in pattern.finditer(text):
            tail = text[match.end(): match.end() + 80]
            # Skip stray percent markers (e.g. "CGST @9%: 360.00") so we
            # don't pick up the tax rate as the tax amount.
            tail = re.sub(r"\s*@\s*\d+(?:\.\d+)?\s*%", " ", tail)
            amount_match = _NUMBER_PATTERN.search(tail)
            if amount_match:
                value = _parse_number(amount_match.group(0))
                if value is not None:
                    return value
    return None


# ---------------------------------------------------------------------------
# Field-specific extractors
# ---------------------------------------------------------------------------

# Invoice number — "Invoice #INV-10248", "Inv No: 10248", "Bill No 0001".
# The label token (e.g. "no", "number") must end at a word boundary so we
# don't accidentally match it as a prefix of a longer word like
# "Northwind" (which starts with "No").
_INVOICE_NUMBER_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"\b(?:invoice|tax\s*invoice|receipt)\b\s*"
        r"(?:#(?=\s)|no(?:\.|\b)|number\b|num(?:\.|\b))\s*[:\-]?\s*"
        r"(?P<value>[A-Za-z0-9][A-Za-z0-9\-/]{1,30}?)"
        r"(?=\s|$|[^A-Za-z0-9\-/])",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:inv|bill)\b\s*"
        r"(?:#(?=\s)|no(?:\.|\b)|number\b|num(?:\.|\b))\s*[:\-]?\s*"
        r"(?P<value>[A-Za-z0-9][A-Za-z0-9\-/]{1,30}?)"
        r"(?=\s|$|[^A-Za-z0-9\-/])",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:invoice|inv)\b\s*[:#\-]\s*"
        r"(?P<value>[A-Za-z0-9][A-Za-z0-9\-/]{1,30}?)"
        r"(?=\s|$|[^A-Za-z0-9\-/])",
        re.IGNORECASE,
    ),
]

# GSTIN — 15-character Indian GST identifier: 2-digit state code, 5-letter
# PAN prefix, 4-digit PAN sequence, 1-letter PAN check, 1 alphanumeric
# entity code, 1 letter (typically 'Z'), 1 alphanumeric checksum. The
# checksum is alphanumeric, not strictly a letter, so the final character
# class is ``[A-Z0-9]``.
_GSTIN_PATTERN = re.compile(
    r"\b(?P<value>\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9][A-Z][A-Z0-9])\b",
    re.IGNORECASE,
)

# Dates — capture common formats and normalise them to ISO ``YYYY-MM-DD``.
# We keep several patterns ordered from most to least specific.
_DATE_PATTERNS: list[re.Pattern[str]] = [
    # 26 Aug 2026 / 26-August-2026
    re.compile(
        r"\b(?P<d>\d{1,2})[\s./\-]+(?P<m>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
        r"[a-z]*[\s./\-]+(?P<y>\d{2,4})\b",
        re.IGNORECASE,
    ),
    # 2026-08-26 / 2026/08/26 / 2026.08.26
    re.compile(r"\b(?P<y>\d{4})[\-./](?P<m>\d{1,2})[\-./](?P<d>\d{1,2})\b"),
    # 26-08-2026 / 26/08/2026 / 26.08.2026
    re.compile(r"\b(?P<d>\d{1,2})[\-./](?P<m>\d{1,2})[\-./](?P<y>\d{2,4})\b"),
    # 26-Aug-2026
    re.compile(
        r"\b(?P<d>\d{1,2})[\s./\-]+(?P<m>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
        r"[a-z]*[\s./\-]+(?P<y>\d{2,4})\b",
        re.IGNORECASE,
    ),
]

_MONTH_NAME_TO_NUMBER = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# Labels for the labelled amount fields. We look for the label and grab the
# first number on the same line (or just below it).
_SUBTOTAL_LABELS: list[re.Pattern[str]] = [
    re.compile(r"\b(?:sub[\s\-]?total|taxable\s+(?:value|amount)|net\s+amount)\b", re.IGNORECASE),
]
_CGST_LABELS: list[re.Pattern[str]] = [
    re.compile(r"\b(?:cgst|central\s+gst|central\s+tax)\b", re.IGNORECASE),
]
_SGST_LABELS: list[re.Pattern[str]] = [
    re.compile(r"\b(?:sgst|state\s+gst|state\s+tax|utgst)\b", re.IGNORECASE),
]
_TOTAL_LABELS: list[re.Pattern[str]] = [
    re.compile(r"\b(?:grand\s+total|invoice\s+total|total\s+amount|amount\s+due|balance\s+due|total)\b", re.IGNORECASE),
]

# The vendor / seller name usually appears in the first non-empty lines of
# the invoice. We try a few heuristics: "From: ACME", "Sold by", or just
# the first uppercase-heavy line.
_VENDOR_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"(?:from|sold\s+by|vendor|supplier|seller|bill\s+from|billed\s+from)"
        r"\s*[:\-]?\s*(?P<value>[A-Za-z][A-Za-z0-9&.,'\- ]{2,60})",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:m/s\.?|m/s)\s*(?P<value>[A-Za-z][A-Za-z0-9&.,'\- ]{2,60})",
        re.IGNORECASE,
    ),
]


def _normalise_date(year: int, month: int, day: int) -> Optional[str]:
    """Return ``YYYY-MM-DD`` if the components form a real date."""
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    if year < 100:
        year += 2000 if year < 70 else 1900
    if year < 1900 or year > 2100:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def _extract_invoice_number(text: str) -> Optional[str]:
    for pattern in _INVOICE_NUMBER_PATTERNS:
        match = pattern.search(text)
        if match:
            value = match.group("value").strip(" .,;:")
            # Strip trailing label fragments that OCR sometimes glues on.
            value = re.split(r"\s{2,}", value)[0]
            if value:
                return value
    return None


def _extract_gstin(text: str) -> Optional[str]:
    match = _GSTIN_PATTERN.search(text)
    if not match:
        return None
    return match.group("value").upper()


def _extract_date(text: str) -> Optional[str]:
    for pattern in _DATE_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        groups = match.groupdict()
        day_raw = groups.get("d")
        month_raw = groups.get("m")
        year_raw = groups.get("y")
        if not (day_raw and month_raw and year_raw):
            continue
        if month_raw.isdigit():
            month = int(month_raw)
        else:
            month = _MONTH_NAME_TO_NUMBER.get(month_raw[:3].lower())
            if month is None:
                continue
        try:
            day = int(day_raw)
            year = int(year_raw)
        except ValueError:
            continue
        normalised = _normalise_date(year, month, day)
        if normalised:
            return normalised
    return None


def _extract_vendor(text: str) -> Optional[str]:
    for pattern in _VENDOR_PATTERNS:
        match = pattern.search(text)
        if match:
            value = match.group("value").strip(" .,;:")
            # Drop anything past a stray newline.
            value = value.splitlines()[0].strip()
            if value:
                return value

    # Fallback: the first short line near the top of the invoice is usually
    # the company name. Skip lines that look like addresses, dates, or
    # pure-numeric tokens.
    for raw_line in text.splitlines():
        line = raw_line.strip(" -:.;,")
        if not line or len(line) < 3 or len(line) > 60:
            continue
        if line.lower().startswith(("invoice", "bill", "tax", "gstin", "gst", "date")):
            continue
        if _NUMBER_PATTERN.fullmatch(line):
            continue
        if any(ch.isalpha() for ch in line):
            return line
    return None


def _extract_amounts(text: str) -> dict[str, Optional[float]]:
    return {
        "subtotal": _find_amount_after_label(text, _SUBTOTAL_LABELS),
        "cgst": _find_amount_after_label(text, _CGST_LABELS),
        "sgst": _find_amount_after_label(text, _SGST_LABELS),
        "total": _find_amount_after_label(text, _TOTAL_LABELS),
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def extract_invoice_fields(ocr_output: dict[str, Any]) -> dict[str, Any]:
    """Extract structured invoice fields from an OCR result dict.

    Parameters
    ----------
    ocr_output:
        The dict returned by :func:`app.ocr.image_to_text`. Only the
        ``"text"`` key is consulted; everything else is ignored.

    Returns
    -------
    dict
        A dictionary with the keys ``invoice_number``, ``vendor``,
        ``date``, ``gstin``, ``subtotal``, ``cgst``, ``sgst`` and
        ``total``. Any field that couldn't be located is set to
        ``None``. Amounts are returned as ``float`` so the frontend
        can format them without further parsing.
    """
    text = (ocr_output or {}).get("text", "") or ""

    amounts = _extract_amounts(text)

    return {
        "invoice_number": _extract_invoice_number(text),
        "vendor": _extract_vendor(text),
        "date": _extract_date(text),
        "gstin": _extract_gstin(text),
        "subtotal": amounts["subtotal"],
        "cgst": amounts["cgst"],
        "sgst": amounts["sgst"],
        "total": amounts["total"],
    }
