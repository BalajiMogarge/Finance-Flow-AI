"""Application configuration for Finance Flow AI.

Uses pydantic-settings to load, validate, and document all configuration
from environment variables.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parent.parent

INSECURE_KEYS = {
    "secret",
    "changeme",
    "default",
    "secretkey",
    "password",
    "finance-flow-ai-development-insecure-secret-key-change-in-production",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Environment
    ENVIRONMENT: str = Field(default="development", description="Environment: development, test, production")

    # Database URLs
    # DATABASE_URL is the Neon POOLED connection string used at runtime
    DATABASE_URL: str = Field(
        default=f"sqlite:///{(_BACKEND_ROOT / 'finance_flow.db').as_posix()}",
        description="Neon pooled PostgreSQL connection URL (or SQLite for dev)",
    )
    # DATABASE_URL_DIRECT is the Neon unpooled / direct connection string used by Alembic
    DATABASE_URL_DIRECT: str | None = Field(
        default=None,
        description="Direct (non-pooled) PostgreSQL connection URL for Alembic migrations",
    )

    # Security & Authentication
    SECRET_KEY: str = Field(
        default="finance-flow-ai-development-32-chars-minimum-secret-key!",
        description="JWT secret key (minimum 32 characters)",
    )
    ALGORITHM: str = Field(default="HS256", description="JWT encryption algorithm")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=1440, description="Session expiration in minutes (24 hours)")

    # CORS Configuration
    FRONTEND_ORIGINS: str | list[str] = Field(
        default=["http://localhost:3000", "http://localhost:3001"],
        description="Allowed explicit frontend origins (comma-separated or JSON array)",
    )
    FRONTEND_PREVIEW_REGEX: str | None = Field(
        default=r"^https://finance-flow-ai(-[a-zA-Z0-9_-]+)*\.vercel\.app$",
        description="Regex pattern for scoped Vercel preview environments",
    )

    # Storage Backend
    STORAGE_BACKEND: str = Field(default="local", description="File storage: 's3' or 'local'")
    S3_ENDPOINT_URL: str | None = Field(default=None, description="S3-compatible endpoint (e.g. Supabase Storage)")
    S3_REGION: str = Field(default="us-east-1", description="S3 region")
    S3_ACCESS_KEY_ID: str | None = Field(default=None, description="S3 access key")
    S3_SECRET_ACCESS_KEY: str | None = Field(default=None, description="S3 secret key")
    S3_BUCKET: str | None = Field(default=None, description="Private S3 bucket name")

    # Local storage (dev only)
    UPLOAD_DIR: Path = Field(default=_BACKEND_ROOT / "uploads", description="Local uploads directory")
    MAX_UPLOAD_BYTES: int = Field(default=10 * 1024 * 1024, description="Maximum upload size in bytes (10 MB)")

    # OCR & Processing limits
    OCR_CONCURRENCY: int = Field(default=1, description="Maximum concurrent OCR jobs")
    OCR_MAX_IMAGE_DIM: int = Field(default=1600, description="Max width/height before downscaling image")
    OCR_TIMEOUT_SECONDS: int = Field(default=120, description="Hard timeout per OCR job in seconds")

    @property
    def IS_SQLITE(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def normalize_database_url(cls, v: str) -> str:
        if isinstance(v, str) and v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v

    @field_validator("DATABASE_URL_DIRECT", mode="before")
    @classmethod
    def normalize_direct_database_url(cls, v: str | None) -> str | None:
        if isinstance(v, str) and v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v

    @field_validator("FRONTEND_ORIGINS", mode="after")
    @classmethod
    def parse_frontend_origins(cls, v: Any) -> list[str]:
        if isinstance(v, str):
            v_str = v.strip()
            if v_str.startswith("[") and v_str.endswith("]"):
                try:
                    import json

                    parsed = json.loads(v_str)
                    if isinstance(parsed, list):
                        return [str(x).strip() for x in parsed if str(x).strip()]
                except Exception:
                    pass
            return [origin.strip() for origin in v_str.split(",") if origin.strip()]
        if isinstance(v, list):
            return [str(origin).strip() for origin in v if str(origin).strip()]
        return []

    def validate_production_requirements(self) -> None:
        """Validate critical production constraints upon application startup."""
        # 1. SECRET_KEY validation
        if not self.SECRET_KEY or len(self.SECRET_KEY) < 32:
            raise ValueError("SECRET_KEY is invalid: must be at least 32 characters long.")
        if self.ENVIRONMENT == "production" and self.SECRET_KEY in INSECURE_KEYS:
            raise ValueError("Insecure default SECRET_KEY detected in production. You must set a strong SECRET_KEY.")

        # 2. Storage backend validation
        if self.ENVIRONMENT == "production" and self.STORAGE_BACKEND == "local":
            raise ValueError(
                "STORAGE_BACKEND='local' is forbidden in production! S3-compatible private bucket storage must be configured."
            )


settings = Settings()
settings.validate_production_requirements()
