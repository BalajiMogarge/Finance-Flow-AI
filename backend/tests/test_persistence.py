"""Tests for SQLite persistence and the new read endpoints.

The tests cover the three behaviours called out in the task brief:

* an invoice is saved after a successful ``/upload`` call,
* ``GET /invoices`` returns rows ordered by newest first,
* ``GET /stats`` counts approved / rejected / pending decisions
  correctly.

To keep the suite hermetic the tests redirect the SQLAlchemy engine to
an isolated ``test_finance_flow.db`` file via a monkey-patch on
``app.database.engine`` and recreate the schema on every setUp. The
stub for the OCR backend mirrors the one used in
``test_decision.py`` so this file stays self-contained.
"""

from __future__ import annotations

import os
import sys
import types
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

# Make the ``app`` package importable when running ``pytest`` from the
# backend directory.
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))


# ---------------------------------------------------------------------------
# Stub heavy OCR dependencies BEFORE app modules are imported. The tests
# only need ``image_to_text`` to be patchable, never executed.
# ---------------------------------------------------------------------------
def _install_stubs() -> None:
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


_install_stubs()


# Imports must come AFTER the stubs are in place so that ``app.main``
# doesn't try to import the real (heavy) OCR packages at import time.
from fastapi.testclient import TestClient  # noqa: E402

from app import database  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Invoice  # noqa: E402


# Path to the test-only SQLite file. Lives next to the package so the
# test database is easy to find and to delete.
TEST_DB_PATH = BACKEND_DIR / "test_finance_flow.db"
TEST_DATABASE_URL = f"sqlite:///{TEST_DB_PATH.as_posix()}"


def _stub_ocr(confidence: float = 0.95) -> dict:
    """Deterministic OCR payload used by the upload tests."""
    return {
        "lines": [
            {"text": "Invoice #INV-10248", "confidence": confidence},
        ],
        "text": "Invoice #INV-10248\nTotal: 1180.00",
        "average_confidence": confidence,
        "line_count": 1,
    }


class PersistenceTestBase(unittest.TestCase):
    """Shared setUp/tearDown that swaps the engine to a test database."""

    def setUp(self) -> None:
        # Remove any previous test database so each run starts clean.
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

        # Build a fresh engine pointed at the test file and rebind the
        # session factory + the FastAPI dependency override.
        self.test_engine = database.create_engine(
            TEST_DATABASE_URL,
            connect_args={"check_same_thread": False},
            future=True,
        )
        self._original_engine = database.engine
        database.engine = self.test_engine

        self._original_session = database.SessionLocal
        database.SessionLocal = database.sessionmaker(
            bind=self.test_engine,
            autoflush=False,
            autocommit=False,
            future=True,
        )

        # Patch the reference inside ``app.main`` too — it captured the
        # engine at import time.
        from app import main as main_module

        self._original_main_engine = main_module.engine
        main_module.engine = self.test_engine

        # Recreate the schema on the test database.
        Base.metadata.drop_all(bind=self.test_engine)
        Base.metadata.create_all(bind=self.test_engine)

        # Use FastAPI's dependency override so route handlers receive
        # sessions bound to the test engine.
        def _override_get_db():
            db = database.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[database.get_db] = _override_get_db
        self._app = app
        self.client = TestClient(app)

    def tearDown(self) -> None:
        # Restore the production engine + close the test one.
        database.engine = self._original_engine
        database.SessionLocal = self._original_session
        from app import main as main_module

        main_module.engine = self._original_main_engine
        self.test_engine.dispose()
        app.dependency_overrides.pop(database.get_db, None)
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class UploadPersistenceTests(PersistenceTestBase):
    """``/upload`` must persist the processed invoice."""

    def test_invoice_is_saved_after_upload(self):
        with patch("app.main.image_to_text", return_value=_stub_ocr(0.95)):
            files = {"file": ("invoice.png", b"\x89PNG\r\n\x1a\n", "image/png")}
            response = self.client.post("/upload", files=files)

        self.assertEqual(response.status_code, 200)

        # Response contract is unchanged.
        payload = response.json()
        self.assertEqual(payload["status"], "processed")
        self.assertIn("decision", payload)

        # The invoice must now be in the database.
        with database.SessionLocal() as session:
            rows = session.query(Invoice).all()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row.filename, "invoice.png")
        # ``total`` was extracted from the stubbed OCR text.
        self.assertEqual(row.total, 1180.0)
        self.assertEqual(row.decision, payload["decision"]["decision"])
        self.assertEqual(row.confidence, payload["decision"]["confidence"])
        self.assertEqual(row.risk_level, payload["decision"]["risk_level"])
        # Timestamp populated by the database default.
        self.assertIsInstance(row.created_at, datetime)


class InvoicesListTests(PersistenceTestBase):
    """``GET /invoices`` returns rows ordered newest-first."""

    def _seed(self) -> list[Invoice]:
        """Insert three invoices with controlled timestamps."""
        # Use distinct timestamps so the ordering is deterministic.
        now = datetime.utcnow()
        with database.SessionLocal() as session:
            rows = [
                Invoice(
                    filename="old.png",
                    vendor="OLD VENDOR",
                    invoice_number="INV-1",
                    total=100.0,
                    decision="APPROVE",
                    confidence=0.9,
                    risk_level="LOW",
                    created_at=now - timedelta(minutes=10),
                ),
                Invoice(
                    filename="middle.png",
                    vendor="MIDDLE VENDOR",
                    invoice_number="INV-2",
                    total=200.0,
                    decision="REJECT",
                    confidence=0.2,
                    risk_level="HIGH",
                    created_at=now - timedelta(minutes=5),
                ),
                Invoice(
                    filename="new.png",
                    vendor="NEW VENDOR",
                    invoice_number="INV-3",
                    total=300.0,
                    decision="PENDING REVIEW",
                    confidence=0.6,
                    risk_level="MEDIUM",
                    created_at=now,
                ),
            ]
            session.add_all(rows)
            session.commit()
            for row in rows:
                session.refresh(row)
        return rows

    def test_invoices_endpoint_returns_newest_first(self):
        self._seed()
        response = self.client.get("/invoices")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload), 3)

        vendors = [row["vendor"] for row in payload]
        self.assertEqual(vendors, ["NEW VENDOR", "MIDDLE VENDOR", "OLD VENDOR"])

        # Confirm the example shape: at least vendor / decision / total
        # are present and the totals match the seed data.
        first = payload[0]
        self.assertIn("vendor", first)
        self.assertIn("decision", first)
        self.assertIn("total", first)
        self.assertEqual(first["total"], 300.0)
        self.assertEqual(first["decision"], "PENDING REVIEW")


class StatsEndpointTests(PersistenceTestBase):
    """``GET /stats`` counts decisions correctly."""

    def _seed(self) -> None:
        with database.SessionLocal() as session:
            session.add_all(
                [
                    Invoice(
                        filename="a.png",
                        vendor="V1",
                        total=10.0,
                        decision="APPROVE",
                    ),
                    Invoice(
                        filename="b.png",
                        vendor="V2",
                        total=20.0,
                        decision="APPROVE",
                    ),
                    Invoice(
                        filename="c.png",
                        vendor="V3",
                        total=30.0,
                        decision="APPROVE",
                    ),
                    Invoice(
                        filename="d.png",
                        vendor="V4",
                        total=40.0,
                        decision="REJECT",
                    ),
                    Invoice(
                        filename="e.png",
                        vendor="V5",
                        total=50.0,
                        decision="REJECT",
                    ),
                    Invoice(
                        filename="f.png",
                        vendor="V6",
                        total=60.0,
                        decision="PENDING REVIEW",
                    ),
                ]
            )
            session.commit()

    def test_stats_counts_decisions(self):
        self._seed()
        response = self.client.get("/stats")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            payload,
            {"total": 6, "approved": 3, "rejected": 2, "pending": 1},
        )

    def test_stats_empty_database(self):
        # No rows seeded — counts should all be zero.
        response = self.client.get("/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"total": 0, "approved": 0, "rejected": 0, "pending": 0},
        )


if __name__ == "__main__":
    unittest.main()
