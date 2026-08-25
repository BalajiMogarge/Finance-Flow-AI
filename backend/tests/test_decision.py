"""Tests for the invoice decision pipeline.

The tests are split into two layers:

* :class:`DecisionUnitTests` exercises :func:`app.decision.make_decision`
  with hand-crafted validation/field/confidence fixtures. This is the
  fast, deterministic core of the suite.
* :class:`UploadEndpointTests` exercises the wired-up ``/upload``
  endpoint with a stub OCR backend to make sure the response payload
  matches the contract documented in the task.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

# Make the ``app`` package importable when running ``pytest`` from the
# backend directory.
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.decision import make_decision  # noqa: E402


# A checksum-valid 15-character GSTIN. The checksum digit was chosen
# so it passes :func:`app.decision._gstin_checksum_is_valid`.
VALID_GSTIN = "22AAAAA0000A1Z0"


def _approved_fields() -> dict:
    """Fields for a clean invoice that should auto-approve."""
    return {
        "invoice_number": "INV-10248",
        "vendor": "ACME Pvt Ltd",
        "date": "2026-08-20",
        "gstin": VALID_GSTIN,
        "subtotal": 1000.0,
        "cgst": 90.0,
        "sgst": 90.0,
        "total": 1180.0,
    }


def _approved_validation() -> dict:
    return {"passed": True, "errors": [], "warnings": []}


class DecisionUnitTests(unittest.TestCase):
    """Direct tests of :func:`make_decision`."""

    # ------------------------------------------------------------------
    # APPROVE
    # ------------------------------------------------------------------
    def test_approved_invoice(self):
        result = make_decision(
            _approved_validation(),
            _approved_fields(),
            confidence=0.95,
        )

        self.assertEqual(result["decision"], "APPROVE")
        self.assertEqual(result["risk_level"], "LOW")
        self.assertGreaterEqual(result["confidence"], 0.85)
        # The reason should mention the success path.
        self.assertIn("passed", result["reason"].lower())

    # ------------------------------------------------------------------
    # REJECT
    # ------------------------------------------------------------------
    def test_rejected_invoice_missing_invoice_number(self):
        fields = _approved_fields()
        fields["invoice_number"] = None

        result = make_decision(
            _approved_validation(),
            fields,
            confidence=0.95,
        )

        self.assertEqual(result["decision"], "REJECT")
        self.assertEqual(result["risk_level"], "HIGH")
        self.assertIn("invoice number", result["reason"].lower())

    def test_rejected_invoice_invalid_gstin(self):
        fields = _approved_fields()
        fields["gstin"] = "INVALID-GSTIN"

        result = make_decision(
            _approved_validation(),
            fields,
            confidence=0.95,
        )

        self.assertEqual(result["decision"], "REJECT")
        self.assertEqual(result["risk_level"], "HIGH")
        self.assertIn("gstin", result["reason"].lower())

    def test_rejected_invoice_amount_inconsistency(self):
        fields = _approved_fields()
        fields["total"] = 9999.99  # far away from subtotal + taxes

        result = make_decision(
            _approved_validation(),
            fields,
            confidence=0.95,
        )

        self.assertEqual(result["decision"], "REJECT")
        self.assertEqual(result["risk_level"], "HIGH")
        self.assertIn("amount", result["reason"].lower())

    def test_rejected_invoice_low_confidence(self):
        result = make_decision(
            _approved_validation(),
            _approved_fields(),
            confidence=0.20,
        )

        self.assertEqual(result["decision"], "REJECT")
        self.assertEqual(result["risk_level"], "HIGH")
        self.assertIn("confidence", result["reason"].lower())

    # ------------------------------------------------------------------
    # PENDING REVIEW
    # ------------------------------------------------------------------
    def test_pending_review_company_policy_warning(self):
        validation = {
            "passed": True,
            "errors": [],
            "warnings": ["high-value invoice — policy review required"],
        }

        result = make_decision(
            validation,
            _approved_fields(),
            confidence=0.95,
        )

        self.assertEqual(result["decision"], "PENDING REVIEW")
        self.assertEqual(result["risk_level"], "MEDIUM")
        self.assertIn("policy", result["reason"].lower())

    def test_pending_review_mid_confidence(self):
        result = make_decision(
            _approved_validation(),
            _approved_fields(),
            confidence=0.65,
        )

        self.assertEqual(result["decision"], "PENDING REVIEW")
        self.assertEqual(result["risk_level"], "MEDIUM")
        self.assertIn("confidence", result["reason"].lower())

    def test_pending_review_missing_optional_fields(self):
        fields = _approved_fields()
        fields["vendor"] = None
        fields["date"] = None

        result = make_decision(
            _approved_validation(),
            fields,
            confidence=0.95,
        )

        self.assertEqual(result["decision"], "PENDING REVIEW")
        self.assertEqual(result["risk_level"], "MEDIUM")
        self.assertIn("missing", result["reason"].lower())

    # ------------------------------------------------------------------
    # Misc safety
    # ------------------------------------------------------------------
    def test_response_shape(self):
        result = make_decision(
            _approved_validation(),
            _approved_fields(),
            confidence=0.95,
        )
        self.assertEqual(
            set(result.keys()),
            {"decision", "confidence", "reason", "risk_level"},
        )


class UploadEndpointTests(unittest.TestCase):
    """End-to-end check of the ``/upload`` response payload.

    OCR is heavy and slow, so the tests stub :func:`app.ocr.image_to_text`
    to return a deterministic blob. That keeps the suite fast and
    avoids depending on a real image file.
    """

    def setUp(self):
        # Imported lazily so the unit tests above don't pay the cost
        # of loading FastAPI. We also stub out the heavy OCR
        # dependencies (numpy / easyocr) at import time — the tests
        # only need ``image_to_text`` to be patchable, never executed.
        import sys
        import types

        if "numpy" not in sys.modules:
            sys.modules["numpy"] = types.ModuleType("numpy")
        if "PIL" not in sys.modules:
            pil_stub = types.ModuleType("PIL")
            image_stub = types.ModuleType("PIL.Image")

            class _Image:
                def __init__(self, *args, **kwargs):
                    pass

                def load(self):
                    pass

                def convert(self, mode):
                    return self

            image_stub.open = _Image  # type: ignore[attr-defined]
            pil_stub.Image = image_stub  # type: ignore[attr-defined]
            sys.modules["PIL"] = pil_stub
            sys.modules["PIL.Image"] = image_stub
        if "easyocr" not in sys.modules:
            easyocr_stub = types.ModuleType("easyocr")

            class _Reader:
                def __init__(self, *args, **kwargs):
                    pass

                def readtext(self, image, detail=1, paragraph=False):
                    return []

            easyocr_stub.Reader = _Reader  # type: ignore[attr-defined]
            sys.modules["easyocr"] = easyocr_stub

        from fastapi.testclient import TestClient

        from app.main import app

        self.client = TestClient(app)

    def _stub_ocr(self, confidence: float = 0.95):
        return {
            "lines": [
                {"text": "Invoice #INV-10248", "confidence": confidence},
            ],
            "text": "Invoice #INV-10248\nTotal: 1180.00",
            "average_confidence": confidence,
            "line_count": 1,
        }

    def test_upload_response_shape_for_approved_invoice(self):
        with patch("app.main.image_to_text", return_value=self._stub_ocr(0.95)):
            # Minimal 1x1 PNG bytes — sufficient for the file upload
            # machinery; OCR is stubbed out anyway.
            files = {"file": ("invoice.png", b"\x89PNG\r\n\x1a\n", "image/png")}
            response = self.client.post("/upload", files=files)

        self.assertEqual(response.status_code, 200)
        payload = response.json()

        self.assertEqual(payload["status"], "processed")
        self.assertIn("filename", payload)
        self.assertIn("ocr", payload)
        self.assertIn("fields", payload)
        self.assertIn("validation", payload)
        self.assertIn("decision", payload)

        decision = payload["decision"]
        self.assertIn(decision["decision"], {"APPROVE", "REJECT", "PENDING REVIEW"})
        self.assertIn(decision["risk_level"], {"LOW", "MEDIUM", "HIGH"})

    def test_upload_response_shape_for_rejected_invoice(self):
        # Confidence is forced low so the decision module routes to
        # REJECT without us having to construct a malformed invoice.
        with patch("app.main.image_to_text", return_value=self._stub_ocr(0.20)):
            files = {"file": ("invoice.png", b"\x89PNG\r\n\x1a\n", "image/png")}
            response = self.client.post("/upload", files=files)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "processed")
        self.assertEqual(payload["decision"]["decision"], "REJECT")
        self.assertEqual(payload["decision"]["risk_level"], "HIGH")

    def test_upload_response_shape_for_pending_review_invoice(self):
        # Mid-range confidence lands in the PENDING REVIEW band.
        with patch("app.main.image_to_text", return_value=self._stub_ocr(0.65)):
            files = {"file": ("invoice.png", b"\x89PNG\r\n\x1a\n", "image/png")}
            response = self.client.post("/upload", files=files)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "processed")
        self.assertEqual(payload["decision"]["decision"], "PENDING REVIEW")
        self.assertEqual(payload["decision"]["risk_level"], "MEDIUM")


if __name__ == "__main__":
    unittest.main()
