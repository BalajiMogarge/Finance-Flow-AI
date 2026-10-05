"""Database persistence for Finance Flow AI.

Configures SQLAlchemy engine and session factory with support for PostgreSQL
and SQLite, reading connection strings dynamically from the environment.
Includes connection pooling, thread safety, and explicit schema initialization.
"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

# Engine configuration: SQLite needs check_same_thread=False;
# PostgreSQL uses pooling and pre-ping to handle reconnects gracefully.
_connect_args = {"check_same_thread": False} if settings.IS_SQLITE else {}

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=_connect_args,
    pool_pre_ping=True,
    future=True,
)


class Base(DeclarativeBase):
    """Common declarative base shared by every ORM model."""


SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    future=True,
)


def init_db() -> None:
    """Idempotently create tables if they do not exist.

    Invoked explicitly during application lifespan or migrations, avoiding
    uncontrolled schema mutation at module import time.
    """
    Base.metadata.create_all(bind=engine)


def get_db() -> Session:
    """Yield a database session and ensure it is closed afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
