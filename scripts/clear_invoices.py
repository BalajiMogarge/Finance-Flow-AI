#!/usr/bin/env python3
"""Finance Flow AI - Database Invoice Cleaner

Safely clears invoice records and audit logs from the database.
Supports local SQLite development as well as Neon PostgreSQL production.

Usage:
    # 1. Clear database specified in backend/.env (prompts for confirmation):
    python scripts/clear_invoices.py

    # 2. Clear a specific database (e.g. direct Neon URL):
    python scripts/clear_invoices.py "postgresql://neondb_owner:PASSWORD@ep-sample.us-east-2.aws.neon.tech/neondb?sslmode=require"

    # 3. Non-interactive bypass (for automated scripts):
    python scripts/clear_invoices.py --yes
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Resolve project paths
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.config import settings  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402


def get_target_url(custom_url: str | None) -> str:
    """Determine the database connection URL."""
    if custom_url:
        url = custom_url.strip()
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        return url

    # Default to direct URL if set (for DDL/truncate permissions), else runtime DATABASE_URL
    return settings.DATABASE_URL_DIRECT or settings.DATABASE_URL


def clear_invoices(db_url: str, force: bool = False) -> None:
    """Clear all records from audit_logs and invoices tables."""
    masked_url = db_url
    if "@" in db_url:
        proto_user, _, host_db = db_url.rpartition("@")
        masked_url = f"{proto_user.split(':')[0]}://***@{host_db}"

    print("=" * 65)
    print("      FINANCE FLOW AI - INVOICE DATABASE CLEANER")
    print("=" * 65)
    print(f"Target Database: {masked_url}")

    if not force:
        confirm = input("\nAre you sure you want to delete ALL invoices and audit logs? (y/N): ")
        if confirm.lower() not in {"y", "yes"}:
            print("[x] Operation cancelled. No data was deleted.")
            return

    engine = create_engine(db_url)
    is_sqlite = db_url.startswith("sqlite")

    with engine.begin() as conn:
        if is_sqlite:
            # SQLite does not support TRUNCATE CASCADE
            r1 = conn.execute(text("DELETE FROM audit_logs;"))
            r2 = conn.execute(text("DELETE FROM invoices;"))
            print(f"[+] SQLite: Deleted {r2.rowcount} invoice(s) and {r1.rowcount} audit log(s).")
        else:
            # PostgreSQL supports fast TRUNCATE CASCADE
            conn.execute(text("TRUNCATE TABLE audit_logs, invoices RESTART IDENTITY CASCADE;"))
            print("[+] PostgreSQL: Successfully truncated 'audit_logs' and 'invoices' tables.")

    print("[OK] Database invoice tables are now clean and empty.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clear invoices from Finance Flow AI database.")
    parser.add_argument("db_url", nargs="?", default=None, help="Optional connection string")
    parser.add_argument("--yes", "-y", action="store_true", help="Bypass interactive confirmation prompt")
    args = parser.parse_args()

    target = get_target_url(args.db_url)
    clear_invoices(target, force=args.yes)
