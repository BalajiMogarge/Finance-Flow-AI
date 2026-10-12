"""Database persistence for Finance Flow AI.

Configures SQLAlchemy engine and session factory with support for
Neon PostgreSQL (pooled runtime connections) and SQLite for local development.
Implements PgBouncer transaction mode compatibility, SSL requirements,
and automatic connection retry for Neon cold-start wakeups.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import settings

logger = logging.getLogger(__name__)


def create_app_engine(database_url: str):
    connect_args = {}

    if settings.IS_SQLITE:
        connect_args["check_same_thread"] = False
        eng = create_engine(
            database_url,
            connect_args=connect_args,
            poolclass=StaticPool if ":memory:" in database_url else None,
            future=True,
        )
    else:
        # PostgreSQL / Neon Pooled Configuration
        connect_args["sslmode"] = "require"
        # Disable prepared statements for PgBouncer transaction pooling mode in psycopg 3
        connect_args["prepare_threshold"] = None

        eng = create_engine(
            database_url,
            connect_args=connect_args,
            pool_pre_ping=True,
            pool_recycle=300,
            pool_size=3,
            max_overflow=2,
            future=True,
        )

        # Retry once on connection failure to seamlessly handle Neon scale-to-zero wakeups
        @event.listens_for(eng, "do_connect")
        def retry_connection_on_wake(dialect, conn_rec, cargs, cparams):
            max_retries = 1
            for attempt in range(max_retries + 1):
                try:
                    return dialect.connect(*cargs, **cparams)
                except Exception as exc:
                    if attempt < max_retries:
                        logger.warning(
                            "Database connection attempt failed (possible Neon cold start). Retrying in 1s... Error: %s",
                            exc,
                        )
                        time.sleep(1.0)
                        continue
                    raise

    return eng


engine = create_app_engine(settings.DATABASE_URL)


class Base(DeclarativeBase):
    """Common declarative base shared by every ORM model."""


SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    future=True,
)


def init_db() -> None:
    """Idempotently create tables if they do not exist."""
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    """Yield a database session and ensure it is closed afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
