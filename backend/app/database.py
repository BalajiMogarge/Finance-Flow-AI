"""SQLite persistence for Finance Flow AI.

This module wires up a single SQLAlchemy ``Engine`` and a configured
``sessionmaker`` for the rest of the application. The database file
lives at the project root as ``finance_flow.db`` so that the FastAPI
process and the test suite can both connect to it without any extra
configuration.

A small :func:`get_db` helper is exposed for FastAPI dependency
injection — the same pattern used by the FastAPI documentation. Tests
that don't go through ``TestClient`` can call :func:`SessionLocal``
directly and remember to close the session when they're done.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

# Resolve the SQLite file relative to the backend package so the path is
# stable regardless of the working directory the server is launched from.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATABASE_URL = f"sqlite:///{(_BACKEND_ROOT / 'finance_flow.db').as_posix()}"

# ``check_same_thread=False`` lets the same connection be used across
# FastAPI's thread pool. SQLAlchemy's pool still serialises access for
# SQLite, which is exactly what we want for a single-writer workload.
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    future=True,
)


# ---------------------------------------------------------------------------
# Declarative base
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    """Common declarative base shared by every ORM model."""


# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------

# ``autoflush=False`` keeps intermediate state visible in tests and lets
# the route handlers control when changes hit the database.
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    future=True,
)


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

def get_db() -> Session:
    """Yield a database session and ensure it is closed afterwards.

    Used as a FastAPI dependency::

        @app.get("/invoices")
        def list_invoices(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
