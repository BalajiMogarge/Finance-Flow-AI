"""Tests covering production features: insights calculation, pagination, search,

filtering, file size limit (413), media type validation (415), and rate limiting (429).
"""

import io
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.database import Base, get_db
from app.main import app
from app.models import Invoice, User, Organization
from app.auth import hash_password, create_access_token
from app.rate_limit import upload_rate_limiter, api_rate_limiter


@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(test_db):
    def override_get_db():
        try:
            yield test_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    # Clear rate limit sliding windows before tests
    upload_rate_limiter.history.clear()
    import tempfile
    import shutil
    from app.config import settings

    temp_dir = tempfile.mkdtemp()
    orig_upload_dir = settings.UPLOAD_DIR
    settings.UPLOAD_DIR = Path(temp_dir)

    with TestClient(app) as c:
        yield c

    settings.UPLOAD_DIR = orig_upload_dir
    shutil.rmtree(temp_dir, ignore_errors=True)
    app.dependency_overrides.clear()


class TestProductionFeatures:
    def test_insights_empty_and_populated(self, client: TestClient, test_db):
        # 1. Empty database insights
        res = client.get("/insights")
        assert res.status_code == 200
        data = res.json()
        assert data["top_vendor"] == "No data"
        assert data["approval_rate"] == 0.0
        assert data["high_value_count"] == 0
        assert data["accuracy"] == 0.0

        # 2. Populate invoices
        now = datetime.now(timezone.utc)
        inv1 = Invoice(
            filename="inv1.png",
            vendor="Acme Corp",
            invoice_number="INV-001",
            total=250000.0,
            decision="APPROVE",
            created_at=now,
        )
        inv2 = Invoice(
            filename="inv2.png",
            vendor="Acme Corp",
            invoice_number="INV-002",
            total=50000.0,
            decision="APPROVE",
            created_at=now - timedelta(days=10),
        )
        inv3 = Invoice(
            filename="inv3.png",
            vendor="Beta Ltd",
            invoice_number="INV-003",
            total=10000.0,
            decision="REJECT",
            created_at=now - timedelta(days=45),
        )
        test_db.add_all([inv1, inv2, inv3])
        test_db.commit()

        # All-time insights
        res_all = client.get("/insights")
        assert res_all.status_code == 200
        d_all = res_all.json()
        assert d_all["top_vendor"] == "Acme Corp"
        assert d_all["approval_rate"] == round((2 / 3) * 100, 1)
        assert d_all["high_value_count"] == 1
        assert d_all["accuracy"] == 100.0

        # Filtered insights (last 30 days): inv3 is 45 days old, so only inv1 and inv2 match
        res_30 = client.get("/insights?days=30")
        assert res_30.status_code == 200
        d_30 = res_30.json()
        assert d_30["top_vendor"] == "Acme Corp"
        assert d_30["approval_rate"] == 100.0
        assert d_30["high_value_count"] == 1

    def test_invoices_filtering_and_pagination(self, client: TestClient, test_db):
        inv1 = Invoice(
            filename="sample1.png",
            vendor="Vendor Alpha",
            invoice_number="INV-A1",
            total=1000.0,
            decision="APPROVE",
            is_duplicate=False,
        )
        inv2 = Invoice(
            filename="sample2.png",
            vendor="Vendor Beta",
            invoice_number="INV-B2",
            total=2000.0,
            decision="REJECT",
            is_duplicate=False,
        )
        inv3 = Invoice(
            filename="sample3.png",
            vendor="Vendor Alpha",
            invoice_number="INV-A2",
            total=3000.0,
            decision="PENDING REVIEW",
            is_duplicate=True,
        )
        test_db.add_all([inv1, inv2, inv3])
        test_db.commit()

        # Search by vendor
        res = client.get("/invoices?search=Alpha")
        assert res.status_code == 200
        items = res.json()
        assert len(items) == 2
        assert all("Alpha" in it["vendor"] for it in items)

        # Filter by decision
        res_dec = client.get("/invoices?decision=REJECT")
        assert res_dec.status_code == 200
        items_dec = res_dec.json()
        assert len(items_dec) == 1
        assert items_dec[0]["invoice_number"] == "INV-B2"

        # Filter by is_duplicate
        res_dup = client.get("/invoices?is_duplicate=true")
        assert res_dup.status_code == 200
        items_dup = res_dup.json()
        assert len(items_dup) == 1
        assert items_dup[0]["is_duplicate"] is True

        # Pagination: page_size=2
        res_page = client.get("/invoices?page=1&page_size=2")
        assert res_page.status_code == 200
        assert len(res_page.json()) == 2

    def test_upload_rejects_unsupported_file_type(self, client: TestClient):
        # Text file disguised with .png extension
        fake_png = io.BytesIO(b"This is just a plain text file pretending to be PNG.")
        res = client.post(
            "/upload",
            files={"file": ("fake.png", fake_png, "image/png")},
        )
        assert res.status_code == 415
        assert "signature mismatch" in res.json()["detail"]

    def test_upload_rejects_oversized_file(self, client: TestClient, monkeypatch):
        # Set max upload size to 100 bytes for testing
        from app.config import settings

        monkeypatch.setattr(settings, "MAX_UPLOAD_BYTES", 100)

        # Valid PNG header + junk > 100 bytes
        png_header = b"\x89PNG\r\n\x1a\n" + (b"0" * 200)
        res = client.post(
            "/upload",
            files={"file": ("large.png", io.BytesIO(png_header), "image/png")},
        )
        assert res.status_code == 413
        assert "maximum allowed size" in res.json()["detail"]

    def test_rate_limiter_exceeded(self, client: TestClient):
        upload_rate_limiter.requests_per_minute = 2
        try:
            for _ in range(2):
                client.post("/upload", files={"file": ("test.png", io.BytesIO(b"fake"), "image/png")})
            # 3rd request should exceed limit
            r_blocked = client.post("/upload", files={"file": ("test.png", io.BytesIO(b"fake"), "image/png")})
            assert r_blocked.status_code == 429
            assert "Rate limit exceeded" in r_blocked.json()["detail"]
        finally:
            upload_rate_limiter.requests_per_minute = 30
