"""Tests for security, authentication, magic byte checks, duplicate tracking, and review workflows."""

from __future__ import annotations

import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient

from app import database
from app.auth import create_access_token, hash_password, verify_password
from app.database import Base
from app.file_utils import calculate_sha256, detect_file_type
from app.main import app
from app.models import AuditLog, Invoice, Organization, User

TEST_DB_PATH = BACKEND_DIR / "test_security.db"
TEST_DATABASE_URL = f"sqlite:///{TEST_DB_PATH.as_posix()}"


def _stub_ocr(confidence: float = 0.95) -> dict:
    return {
        "lines": [{"text": "Invoice #INV-9999", "confidence": confidence}],
        "text": "Invoice #INV-9999\nVendor: Global Logistics Ltd\nTotal: 2500.00",
        "average_confidence": confidence,
        "line_count": 3,
    }


class SecurityAndUploadTests(unittest.TestCase):
    def setUp(self):
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

        self.test_engine = database.create_engine(
            TEST_DATABASE_URL,
            connect_args={"check_same_thread": False},
            future=True,
        )
        self._orig_engine = database.engine
        database.engine = self.test_engine
        database.SessionLocal = database.sessionmaker(
            bind=self.test_engine,
            autoflush=False,
            autocommit=False,
            future=True,
        )

        Base.metadata.create_all(bind=self.test_engine)

        def _override_get_db():
            db = database.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[database.get_db] = _override_get_db
        self.client = TestClient(app)

    def tearDown(self):
        database.engine = self._orig_engine
        self.test_engine.dispose()
        app.dependency_overrides.pop(database.get_db, None)
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

    # ----------------------------------------------------------------------
    # Password Hashing & JWT Auth
    # ----------------------------------------------------------------------
    def test_password_hashing_and_verification(self):
        hashed = hash_password("SuperSecret123!")
        self.assertTrue(verify_password("SuperSecret123!", hashed))
        self.assertFalse(verify_password("WrongPassword", hashed))

    def test_user_registration_and_login_flow(self):
        # Register
        reg_payload = {
            "email": "test@acme.com",
            "password": "Password123!",
            "full_name": "Test Reviewer",
            "role": "reviewer",
            "organization_name": "Acme Corp",
        }
        res = self.client.post("/auth/register", json=reg_payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("access_token", data)
        token = data["access_token"]

        # Access /auth/me with token
        me_res = self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.json()
        self.assertEqual(me_data["email"], "test@acme.com")
        self.assertEqual(me_data["role"], "reviewer")
        self.assertEqual(me_data["organization_name"], "Acme Corp")

        # Login
        login_res = self.client.post(
            "/auth/login",
            json={"email": "test@acme.com", "password": "Password123!"},
        )
        self.assertEqual(login_res.status_code, 200)
        self.assertIn("access_token", login_res.json())

    # ----------------------------------------------------------------------
    # Magic-Byte File Type Verification
    # ----------------------------------------------------------------------
    def test_magic_byte_rejects_spoofed_file(self):
        # A file named .png containing fake/executable text
        fake_png = b"THIS IS NOT A REAL PNG IMAGE"
        files = {"file": ("malicious.png", fake_png, "image/png")}
        res = self.client.post("/upload", files=files)
        self.assertEqual(res.status_code, 415)
        self.assertIn("signature mismatch", res.json()["detail"].lower())

    def test_magic_byte_accepts_valid_png(self):
        valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
        with patch("app.main.image_to_text", return_value=_stub_ocr(0.9)):
            files = {"file": ("valid.png", valid_png, "image/png")}
            res = self.client.post("/upload", files=files)
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["status"], "processed")

    # ----------------------------------------------------------------------
    # Duplicate Invoice Detection
    # ----------------------------------------------------------------------
    def test_duplicate_file_detection(self):
        valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRunique_data_123"
        with patch("app.main.image_to_text", return_value=_stub_ocr(0.9)):
            # First upload
            res1 = self.client.post("/upload", files={"file": ("inv1.png", valid_png, "image/png")})
            self.assertEqual(res1.status_code, 200)
            self.assertFalse(res1.json()["is_duplicate"])

            # Second upload of the identical file
            res2 = self.client.post("/upload", files={"file": ("inv1_copy.png", valid_png, "image/png")})
            self.assertEqual(res2.status_code, 200)
            self.assertTrue(res2.json()["is_duplicate"])
            # Duplicate triggers policy warning
            warnings = res2.json()["validation"]["warnings"]
            self.assertTrue(any("duplicate" in w.lower() for w in warnings))

    # ----------------------------------------------------------------------
    # Human Review Workflow & Audit Log
    # ----------------------------------------------------------------------
    def test_human_review_workflow_and_audit_trail(self):
        valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR_review_test"
        with patch("app.main.image_to_text", return_value=_stub_ocr(0.60)):  # review band
            res = self.client.post("/upload", files={"file": ("pending.png", valid_png, "image/png")})
            inv_id = res.json()["id"]

        # Verify initial decision is PENDING REVIEW
        invoices = self.client.get("/invoices").json()
        target = next(i for i in invoices if i["id"] == inv_id)
        self.assertEqual(target["decision"], "PENDING REVIEW")

        # Submit human review: approve with notes
        review_res = self.client.post(
            f"/invoices/{inv_id}/review",
            json={"decision": "APPROVE", "notes": "Approved by CFO after PO verification."},
        )
        self.assertEqual(review_res.status_code, 200)
        self.assertEqual(review_res.json()["decision"], "APPROVE")
        self.assertEqual(review_res.json()["risk_level"], "LOW")

        # Check audit trail
        audit_res = self.client.get(f"/invoices/{inv_id}/audit")
        self.assertEqual(audit_res.status_code, 200)
        logs = audit_res.json()
        self.assertGreaterEqual(len(logs), 2)  # upload_processed + human_review
        review_log = next(l for l in logs if l["action"] == "human_review")
        self.assertEqual(review_log["previous_state"], "PENDING REVIEW")
        self.assertEqual(review_log["new_state"], "APPROVE")
        self.assertIn("CFO", review_log["notes"])


if __name__ == "__main__":
    unittest.main()
