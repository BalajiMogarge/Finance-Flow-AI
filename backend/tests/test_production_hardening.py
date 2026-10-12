"""Comprehensive production hardening test suite.

Verifies:
1. GSTIN checksum validation (valid, invalid checksum, bad state code)
2. Arithmetic tolerance (<= 1.00 INR boundary condition)
3. Date parsing (YYYY-MM-DD, DD-Mon-YYYY, DD/MM/YYYY)
4. Amount parsing (European 1.234,56 vs Indian 1,23,456.78)
5. Decision boundaries (confidence 39/40/84/85 and total 199,999 vs 200,000 INR)
6. Magic-byte spoofing (exe disguised as .pdf -> 415)
7. Duplicate detection (SHA-256 uniqueness per organization)
8. Tenant isolation (cross-organization access returns 404)
"""

import io

import pytest
from app.auth import create_access_token, hash_password
from app.database import Base, get_db
from app.decision import make_decision
from app.extractor import extract_invoice_fields
from app.main import app
from app.models import Invoice, Organization, User
from app.validator import amounts_consistent, validate_gstin_checksum, validate_invoice
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# ---------------------------------------------------------------------------
# Test Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def db_session():
    """Isolated in-memory database session."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session):
    """FastAPI TestClient with overridden get_db dependency."""
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# 1. GSTIN Checksum Tests
# ---------------------------------------------------------------------------

class TestGSTINValidation:
    def test_valid_gstin_checksum(self):
        # Maharashtra (27) with valid Luhn mod 36 check digit 'V'
        is_valid, msg = validate_gstin_checksum("27AAPFU0939F1ZV")
        assert is_valid is True
        assert msg == "Valid GSTIN"

        # Delhi (07) with valid check digit '4'
        is_valid, msg = validate_gstin_checksum("07AAAAA0000A1Z4")
        assert is_valid is True

    def test_invalid_gstin_checksum(self):
        # Check digit corrupted from 'V' to '9'
        is_valid, msg = validate_gstin_checksum("27AAPFU0939F1Z9")
        assert is_valid is False
        assert "Invalid GSTIN checksum" in msg

    def test_bad_state_code(self):
        # 98 is outside valid state codes (01-38, 97, 99)
        is_valid, msg = validate_gstin_checksum("98AAPFU0939F1ZV")
        assert is_valid is False
        assert "Invalid state code '98'" in msg

        # 00 is also invalid
        is_valid, msg = validate_gstin_checksum("00AAPFU0939F1ZV")
        assert is_valid is False
        assert "Invalid state code '00'" in msg


# ---------------------------------------------------------------------------
# 2. Arithmetic Tolerance Tests
# ---------------------------------------------------------------------------

class TestArithmeticTolerance:
    def test_exact_match(self):
        fields = {"subtotal": 1000.0, "cgst": 90.0, "sgst": 90.0, "total": 1180.0}
        assert amounts_consistent(fields) is True

    def test_within_tolerance_boundary(self):
        # Difference = 0.50 INR
        fields = {"subtotal": 1000.0, "cgst": 90.0, "sgst": 90.0, "total": 1180.50}
        assert amounts_consistent(fields) is True

        # Difference exactly 1.00 INR
        fields = {"subtotal": 1000.0, "cgst": 90.0, "sgst": 90.0, "total": 1181.00}
        assert amounts_consistent(fields) is True

    def test_exceeds_tolerance_boundary(self):
        # Difference = 1.01 INR (exceeds <= 1.00 INR limit)
        fields = {"subtotal": 1000.0, "cgst": 90.0, "sgst": 90.0, "total": 1181.01}
        assert amounts_consistent(fields) is False

        # Difference = 50.00 INR
        fields = {"subtotal": 1000.0, "cgst": 90.0, "sgst": 90.0, "total": 1230.00}
        assert amounts_consistent(fields) is False


# ---------------------------------------------------------------------------
# 3. Date Parsing Tests
# ---------------------------------------------------------------------------

class TestDateParsing:
    def test_iso_date_parsing(self):
        fields = extract_invoice_fields({"text": "Tax Invoice\nDate: 2024-05-15\nTotal: 500.00"})
        assert fields["date"] == "2024-05-15"

    def test_dd_mon_yyyy_parsing(self):
        fields = extract_invoice_fields({"text": "Tax Invoice\nDate: 15-May-2024\nTotal: 500.00"})
        assert fields["date"] == "2024-05-15"

        fields_space = extract_invoice_fields({"text": "Tax Invoice\nDate: 15 May 2024\nTotal: 500.00"})
        assert fields_space["date"] == "2024-05-15"

    def test_dd_mm_yyyy_parsing(self):
        fields = extract_invoice_fields({"text": "Tax Invoice\nDate: 15/05/2024\nTotal: 500.00"})
        assert fields["date"] == "2024-05-15"


# ---------------------------------------------------------------------------
# 4. Amount Parsing Tests
# ---------------------------------------------------------------------------

class TestAmountParsing:
    def test_european_amount_parsing(self):
        fields = extract_invoice_fields({"text": "Grand Total: 1.234,56"})
        assert fields["total"] == 1234.56

    def test_indian_grouped_amount_parsing(self):
        fields = extract_invoice_fields({"text": "Grand Total: 1,23,456.78"})
        assert fields["total"] == 123456.78

    def test_us_standard_amount_parsing(self):
        fields = extract_invoice_fields({"text": "Grand Total: 12,345.67"})
        assert fields["total"] == 12345.67


# ---------------------------------------------------------------------------
# 5. Decision Boundaries Tests
# ---------------------------------------------------------------------------

class TestDecisionBoundaries:
    def _base_clean_fields(self, total: float):
        return {
            "vendor": "Acme Supplies Pvt Ltd",
            "invoice_number": "INV-1001",
            "date": "2024-05-15",
            "gstin": "27AAPFU0939F1ZV",
            "subtotal": total,
            "total": total,
        }

    def test_confidence_39_reject(self):
        fields = self._base_clean_fields(1000.0)
        val = validate_invoice(fields)
        res = make_decision(val, fields, confidence=0.39)
        assert res["decision"] == "REJECT"
        assert res["risk_level"] == "HIGH"
        assert "below the 0.40 threshold" in res["reason"]

    def test_confidence_40_pending_review(self):
        fields = self._base_clean_fields(1000.0)
        val = validate_invoice(fields)
        res = make_decision(val, fields, confidence=0.40)
        assert res["decision"] == "PENDING REVIEW"
        assert res["risk_level"] == "MEDIUM"

    def test_confidence_84_pending_review(self):
        fields = self._base_clean_fields(1000.0)
        val = validate_invoice(fields)
        res = make_decision(val, fields, confidence=0.84)
        assert res["decision"] == "PENDING REVIEW"
        assert res["risk_level"] == "MEDIUM"

    def test_confidence_85_approve_under_threshold(self):
        fields = self._base_clean_fields(199_999.0)
        val = validate_invoice(fields)
        assert val["passed"] is True
        assert len(val["warnings"]) == 0
        res = make_decision(val, fields, confidence=0.85)
        assert res["decision"] == "APPROVE"
        assert res["risk_level"] == "LOW"

    def test_confidence_85_pending_review_at_200k_boundary(self):
        # At >= 200,000 INR, policy warning is emitted -> routes to PENDING REVIEW
        fields = self._base_clean_fields(200_000.0)
        val = validate_invoice(fields)
        assert any("policy review required" in w for w in val["warnings"])
        res = make_decision(val, fields, confidence=0.85)
        assert res["decision"] == "PENDING REVIEW"
        assert res["risk_level"] == "MEDIUM"


# ---------------------------------------------------------------------------
# 6. Magic-Byte Spoofing Tests
# ---------------------------------------------------------------------------

class TestMagicByteSpoofing:
    def test_executable_spoofed_as_pdf_rejected(self, client: TestClient):
        # Windows/DOS PE header 'MZ' disguised with .pdf filename
        exe_payload = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00" + b"A" * 100
        res = client.post(
            "/api/invoices",
            files={"file": ("malicious_invoice.pdf", io.BytesIO(exe_payload), "application/pdf")},
        )
        assert res.status_code == 415
        assert "signature mismatch" in res.json()["detail"].lower()

    def test_plain_text_spoofed_as_png_rejected(self, client: TestClient):
        fake_text = b"This is just plain text content with no PNG header."
        res = client.post(
            "/api/invoices",
            files={"file": ("fake_invoice.png", io.BytesIO(fake_text), "image/png")},
        )
        assert res.status_code == 415


# ---------------------------------------------------------------------------
# 7. Duplicate Detection Tests
# ---------------------------------------------------------------------------

class TestDuplicateDetection:
    def test_async_duplicate_detection(self, client: TestClient):
        valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRunique_duplicate_payload_999"

        # 1. First upload -> 202 Accepted
        res1 = client.post(
            "/api/invoices",
            files={"file": ("invoice_1.png", io.BytesIO(valid_png), "image/png")},
        )
        assert res1.status_code == 202
        data1 = res1.json()
        assert data1["status"] == "processing"
        first_id = data1["id"]

        # 2. Second upload of exact same bytes -> Recognized as duplicate without 500 error
        res2 = client.post(
            "/api/invoices",
            files={"file": ("invoice_copy.png", io.BytesIO(valid_png), "image/png")},
        )
        assert res2.status_code == 202
        data2 = res2.json()
        assert data2["is_duplicate"] is True
        assert data2["id"] == first_id


# ---------------------------------------------------------------------------
# 8. Multi-Tenant Isolation Tests
# ---------------------------------------------------------------------------

class TestTenantIsolation:
    def test_cross_tenant_access_returns_404(self, client: TestClient, db_session):
        # Create Org A and Org B
        org_a = Organization(name="Tenant Alpha")
        org_b = Organization(name="Tenant Beta")
        db_session.add_all([org_a, org_b])
        db_session.commit()

        # Create User A (Org A) and User B (Org B)
        user_a = User(
            email="alice@alpha.com",
            hashed_password=hash_password("password123"),
            organization_id=org_a.id,
            role="reviewer",
        )
        user_b = User(
            email="bob@beta.com",
            hashed_password=hash_password("password123"),
            organization_id=org_b.id,
            role="reviewer",
        )
        db_session.add_all([user_a, user_b])
        db_session.commit()

        # Seed invoice for Org A
        inv_a = Invoice(
            organization_id=org_a.id,
            filename="alpha_confidential.pdf",
            vendor="Alpha Vendor",
            invoice_number="INV-ALPHA-01",
            total=50000.0,
            decision="APPROVE",
            status="completed",
        )
        db_session.add(inv_a)
        db_session.commit()
        db_session.refresh(inv_a)

        # Generate tokens
        token_a = create_access_token({"sub": str(user_a.id), "org_id": org_a.id, "role": user_a.role})
        token_b = create_access_token({"sub": str(user_b.id), "org_id": org_b.id, "role": user_b.role})

        headers_a = {"Authorization": f"Bearer {token_a}"}
        headers_b = {"Authorization": f"Bearer {token_b}"}

        # User A can access Org A invoice
        res_a = client.get(f"/api/invoices/{inv_a.id}", headers=headers_a)
        assert res_a.status_code == 200
        assert res_a.json()["id"] == inv_a.id

        # User B attempting to access Org A invoice MUST return 404 (not 403, preventing resource enumeration)
        res_b = client.get(f"/api/invoices/{inv_a.id}", headers=headers_b)
        assert res_b.status_code == 404
        assert res_b.json()["detail"] == "Invoice not found."

        # User B attempting to view audit trail of Org A invoice -> 404
        res_b_audit = client.get(f"/api/invoices/{inv_a.id}/audit", headers=headers_b)
        assert res_b_audit.status_code == 404

        # User B attempting human review on Org A invoice -> 404
        res_b_review = client.post(
            f"/api/invoices/{inv_a.id}/review",
            headers=headers_b,
            json={"decision": "REJECT", "notes": "Unauthorized override attempt"},
        )
        assert res_b_review.status_code == 404

        # Listing invoices for User B should NOT include Org A's invoice
        res_b_list = client.get("/api/invoices", headers=headers_b)
        assert res_b_list.status_code == 200
        items_b = res_b_list.json()["items"]
        assert all(item["id"] != inv_a.id for item in items_b)
