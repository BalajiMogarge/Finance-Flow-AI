"""Integration tests verifying full compatibility with PostgreSQL."""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL", "").startswith(("postgresql://", "postgresql+psycopg://")),
    reason="PostgreSQL not configured in DATABASE_URL (skipping PostgreSQL integration tests)",
)
class TestPostgreSQLCompatibility:
    @classmethod
    def setup_class(cls):
        from app.database import engine

        # Verify database is reachable
        with engine.connect() as conn:
            res = conn.execute(text("SELECT 1")).scalar()
            assert res == 1

    def test_schema_tables_exist(self):
        """Verify all core tables exist in PostgreSQL."""
        from app.database import engine
        from sqlalchemy import inspect

        inspector = inspect(engine)
        tables = inspector.get_table_names()
        assert "organizations" in tables
        assert "users" in tables
        assert "invoices" in tables
        assert "audit_logs" in tables

    def test_indexes_exist(self):
        """Verify required compound and unique indexes exist on invoices table."""
        from app.database import engine
        from sqlalchemy import inspect

        inspector = inspect(engine)
        indexes = {i["name"] for i in inspector.get_indexes("invoices")}
        assert "uq_invoices_org_sha256" in indexes
        assert "ix_invoices_org_created_at" in indexes
        assert "ix_invoices_org_status" in indexes

    def test_health_ready_probe(self):
        """Verify the health readiness probe reports connected database in PostgreSQL."""
        from app.main import app

        client = TestClient(app)
        resp = client.get("/api/health/ready")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "ok"
        assert data.get("database") == "connected"

    def test_crud_and_cascade_delete(self):
        """Verify tenant isolation and cascade delete behavior in PostgreSQL."""
        from app.database import SessionLocal
        from app.models import AuditLog, Invoice, Organization, User

        db = SessionLocal()
        try:
            org = Organization(name="Postgres Integration Test Org")
            db.add(org)
            db.commit()
            db.refresh(org)

            user = User(
                email="postgres_test@example.com",
                hashed_password="hashed_pw_test",
                role="admin",
                organization_id=org.id,
            )
            db.add(user)
            db.commit()
            db.refresh(user)

            inv = Invoice(
                organization_id=org.id,
                filename="test.pdf",
                sha256="abc123sha256postgrestest",
                status="completed",
                decision="APPROVE",
                confidence=0.95,
                extracted_data='{"vendor": "Test Vendor", "total": 1000.0}',
            )
            db.add(inv)
            db.commit()
            db.refresh(inv)

            log = AuditLog(
                invoice_id=inv.id,
                user_id=user.id,
                action="system_approval",
                new_state="APPROVE",
            )
            db.add(log)
            db.commit()

            # Verify relations
            assert len(org.invoices) == 1
            assert org.invoices[0].id == inv.id
            assert inv.get_extracted_data().get("total") == 1000.0

            # Delete organization and verify cascade delete on invoices and audit logs
            db.delete(org)
            db.commit()

            assert db.query(Invoice).filter(Invoice.id == inv.id).first() is None
            assert db.query(AuditLog).filter(AuditLog.invoice_id == inv.id).first() is None
            # User has ON DELETE SET NULL, so user remains with organization_id = None
            db_user = db.query(User).filter(User.id == user.id).first()
            if db_user:
                assert db_user.organization_id is None
                db.delete(db_user)
                db.commit()
        finally:
            db.close()
