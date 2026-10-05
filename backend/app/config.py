"""Application configuration for Finance Flow AI.

Reads settings from environment variables with sensible production and local defaults.
Handles Postgres vs SQLite configuration, CORS origins, storage targets, and OCR limits.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import List

_BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _clean_database_url(url: str) -> str:
    """Normalize database URL.

    Render and other PaaS providers supply ``postgres://`` in DATABASE_URL,
    which SQLAlchemy 1.4+ rejected in favor of ``postgresql://``.
    """
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


class Settings:
    def __init__(self) -> None:
        raw_db_url = os.environ.get(
            "DATABASE_URL",
            f"sqlite:///{(_BACKEND_ROOT / 'finance_flow.db').as_posix()}",
        )
        self.DATABASE_URL: str = _clean_database_url(raw_db_url)
        self.IS_SQLITE: bool = self.DATABASE_URL.startswith("sqlite")

        # CORS: parse comma-separated string, or use default local development origins
        raw_origins = os.environ.get("CORS_ALLOWED_ORIGINS")
        if raw_origins:
            self.CORS_ALLOWED_ORIGINS: List[str] = [
                origin.strip() for origin in raw_origins.split(",") if origin.strip()
            ]
        else:
            self.CORS_ALLOWED_ORIGINS = [
                "http://localhost:3000",
                "http://localhost:3001",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:3001",
            ]

        # Optional CORS regex for Vercel preview / deployment URLs (*.vercel.app)
        self.CORS_ORIGIN_REGEX: str | None = os.environ.get(
            "CORS_ORIGIN_REGEX",
            r"^https://.*\.vercel\.app$",
        )

        # Upload & file storage
        self.UPLOAD_DIR: Path = Path(
            os.environ.get("UPLOAD_DIR", str(_BACKEND_ROOT / "uploads"))
        ).resolve()
        self.MAX_UPLOAD_BYTES: int = int(
            os.environ.get("MAX_UPLOAD_BYTES", 10 * 1024 * 1024)
        )  # 10 MB

        # S3 / Object storage (optional durable storage)
        self.STORAGE_BACKEND: str = os.environ.get("STORAGE_BACKEND", "local").lower()
        self.S3_ENDPOINT_URL: str | None = os.environ.get("S3_ENDPOINT_URL")
        self.S3_BUCKET_NAME: str | None = os.environ.get("S3_BUCKET_NAME")
        self.S3_ACCESS_KEY_ID: str | None = os.environ.get("S3_ACCESS_KEY_ID")
        self.S3_SECRET_ACCESS_KEY: str | None = os.environ.get("S3_SECRET_ACCESS_KEY")
        self.S3_REGION: str = os.environ.get("S3_REGION", "auto")

        # Security & Authentication
        self.SECRET_KEY: str = os.environ.get(
            "SECRET_KEY",
            "finance-flow-ai-development-insecure-secret-key-change-in-production",
        )
        self.ALGORITHM: str = "HS256"
        self.ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
            os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", 60 * 24)
        )  # 24 hours

        # OCR & Resource limits (tuned for Render free-tier 512 MB memory limit)
        self.OCR_CONCURRENCY_LIMIT: int = int(
            os.environ.get("OCR_CONCURRENCY_LIMIT", "1")
        )
        self.OCR_MAX_IMAGE_DIM: int = int(
            os.environ.get("OCR_MAX_IMAGE_DIM", "1600")
        )  # Downscale dimension cap


settings = Settings()
