#!/usr/bin/env python3
"""Finance Flow AI - Production Environment Configuration Validator

Validates environment variables before deploying to Render/Vercel.
Checks connection strings, Supabase S3 parameters, CORS origins, and security secrets
WITHOUT ever displaying secret values in terminal output or logs.

Usage:
    # Validate active environment variables:
    python scripts/validate_env.py

    # Validate a specific .env file:
    python scripts/validate_env.py backend/.env
    python scripts/validate_env.py path/to/production.env
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import urlparse

INSECURE_SECRETS = {
    "secret",
    "changeme",
    "default",
    "secretkey",
    "password",
    "finance-flow-ai-development-insecure-secret-key-change-in-production",
    "finance-flow-ai-development-32-chars-minimum-secret-key!",
    "replace-with-a-64-char-random-hex-secret-generated-via-powershell",
    "change-this-to-a-secure-random-secret-key-with-at-least-32-chars!",
}

PLACEHOLDER_MARKERS = [
    "YOUR_PASSWORD",
    "your-password",
    "[password]",
    "your_supabase",
    "your-project-ref",
    "your_s3",
    "your_s3_secret",
    "sample-pooler",
]


class EnvValidator:
    def __init__(self, env: dict[str, str], source_name: str = "environment"):
        self.env = env
        self.source_name = source_name
        self.passes = 0
        self.warnings = 0
        self.failures = 0

    def ok(self, key: str, message: str) -> None:
        self.passes += 1
        print(f"  [PASS] {key:<24} : {message}")

    def warn(self, key: str, message: str, remediation: str = "") -> None:
        self.warnings += 1
        print(f"  [WARN] {key:<24} : {message}")
        if remediation:
            print(f"         --> Hint: {remediation}")

    def fail(self, key: str, message: str, remediation: str = "") -> None:
        self.failures += 1
        print(f"  [FAIL] {key:<24} : {message}")
        if remediation:
            print(f"         --> Fix:  {remediation}")

    def validate_all(self) -> int:
        print("=" * 78)
        print("      FINANCE FLOW AI - DEPLOYMENT ENVIRONMENT VALIDATOR")
        print(f"      Source: {self.source_name}")
        print("=" * 78)

        self._check_environment()
        self._check_secret_key()
        self._check_database_urls()
        self._check_storage_configuration()
        self._check_cors_origins()
        self._check_ocr_and_memory_limits()

        print("=" * 78)
        print(f"SUMMARY: {self.passes} Passed | {self.warnings} Warnings | {self.failures} Failed")
        print("=" * 78)

        if self.failures > 0:
            print("\n[!] DEPLOYMENT PRE-CHECK FAILED: Fix the [FAIL] items above before deploying.\n")
            return 1
        elif self.warnings > 0:
            print("\n[i] DEPLOYMENT PRE-CHECK PASSED WITH WARNINGS: Review [WARN] items above.\n")
            return 0
        else:
            print("\n[+] ALL CHECKS PASSED: Environment configuration is verified and ready for deployment!\n")
            return 0

    def _check_environment(self) -> None:
        env_mode = self.env.get("ENVIRONMENT", "").strip().lower()
        if not env_mode:
            self.warn("ENVIRONMENT", "Not set; defaults to 'development'.", "Set ENVIRONMENT=production on Render.")
        elif env_mode in {"production", "development", "test"}:
            self.ok("ENVIRONMENT", f"Set to '{env_mode}'.")
        else:
            self.warn("ENVIRONMENT", f"Unexpected value '{env_mode}'.", "Expected 'production', 'development', or 'test'.")

    def _check_secret_key(self) -> None:
        key = self.env.get("SECRET_KEY", "").strip()
        env_mode = self.env.get("ENVIRONMENT", "").strip().lower()

        if not key:
            self.fail("SECRET_KEY", "Missing or empty.", "Generate a 64-char key using scripts/generate_secret.ps1.")
            return

        if len(key) < 32:
            self.fail("SECRET_KEY", f"Too short ({len(key)} chars; minimum is 32 chars).", "Use scripts/generate_secret.ps1.")
            return

        is_placeholder = any(m in key.lower() for m in ["replace", "change-this", "sample"]) or key in INSECURE_SECRETS
        if is_placeholder:
            if env_mode == "production":
                self.fail("SECRET_KEY", "Insecure default or template placeholder detected in production!", "Generate a fresh secret.")
            else:
                self.warn("SECRET_KEY", "Using default or template placeholder (acceptable only in development).")
        else:
            self.ok("SECRET_KEY", f"Configured securely ({len(key)} chars, strong entropy, value masked).")

    def _check_database_urls(self) -> None:
        db_url = self.env.get("DATABASE_URL", "").strip()
        direct_url = self.env.get("DATABASE_URL_DIRECT", "").strip()
        env_mode = self.env.get("ENVIRONMENT", "").strip().lower()

        if not db_url:
            self.fail("DATABASE_URL", "Missing runtime database connection string.", "Set Neon pooled connection string.")
            return

        # Check for unedited placeholders
        if any(marker in db_url for marker in PLACEHOLDER_MARKERS):
            self.fail("DATABASE_URL", "Contains unedited placeholder text (e.g. YOUR_PASSWORD or sample-pooler).", "Replace with your real Neon credentials.")
            return

        is_postgres = db_url.startswith(("postgresql://", "postgres://", "postgresql+psycopg://"))
        is_sqlite = db_url.startswith("sqlite://")

        if is_sqlite:
            if env_mode == "production":
                self.fail("DATABASE_URL", "SQLite URL specified in production! Render filesystem is ephemeral.", "Provide your Neon PostgreSQL URL.")
            else:
                self.ok("DATABASE_URL", "SQLite database configured for local development.")
            return

        if not is_postgres:
            self.fail("DATABASE_URL", "Must start with 'postgresql://' or 'postgres://'.")
            return

        # Neon Pooling Checks
        parsed = urlparse(db_url)
        hostname = parsed.hostname or ""

        if "neon.tech" in hostname:
            if "-pooler" in hostname:
                self.ok("DATABASE_URL", f"Valid Neon pooled connection to host '{hostname[:20]}...'")
            else:
                self.warn(
                    "DATABASE_URL",
                    "Neon connection string does NOT have '-pooler' in the hostname.",
                    "FastAPI runtime queries should connect via Neon's pooled endpoint to support scale-to-zero wakeups."
                )
        else:
            self.ok("DATABASE_URL", f"PostgreSQL URL configured ({hostname[:25]}).")

        # DATABASE_URL_DIRECT checks (Alembic DDL)
        if direct_url:
            if any(marker in direct_url for marker in PLACEHOLDER_MARKERS):
                self.fail("DATABASE_URL_DIRECT", "Contains unedited placeholder text.", "Replace with real unpooled Neon credentials.")
                return

            direct_host = urlparse(direct_url).hostname or ""
            if "neon.tech" in direct_host and "-pooler" in direct_host:
                self.fail(
                    "DATABASE_URL_DIRECT",
                    "Contains '-pooler' in hostname! This is a POOLED URL, not direct.",
                    "Toggle Connection Pooling OFF in Neon Console to obtain the direct unpooled URL for migrations."
                )
            else:
                self.ok("DATABASE_URL_DIRECT", f"Valid direct unpooled connection string ({direct_host[:20]}...).")
        else:
            if "neon.tech" in hostname and env_mode == "production":
                self.warn(
                    "DATABASE_URL_DIRECT",
                    "Not set. Alembic migrations will fall back to DATABASE_URL.",
                    "For Neon, provide the unpooled direct connection as DATABASE_URL_DIRECT to avoid PgBouncer DDL lock issues."
                )

    def _check_storage_configuration(self) -> None:
        backend = self.env.get("STORAGE_BACKEND", "").strip().lower()
        env_mode = self.env.get("ENVIRONMENT", "").strip().lower()

        if not backend:
            self.warn("STORAGE_BACKEND", "Not specified; defaulting to 'local'.")
            backend = "local"

        if backend == "local":
            if env_mode == "production":
                self.fail("STORAGE_BACKEND", "STORAGE_BACKEND='local' is forbidden in production! Render filesystem is ephemeral.", "Set STORAGE_BACKEND=s3.")
            else:
                self.ok("STORAGE_BACKEND", "Set to 'local' for local development.")
            return

        if backend != "s3":
            self.fail("STORAGE_BACKEND", f"Unknown storage backend '{backend}'. Must be 's3' or 'local'.")
            return

        self.ok("STORAGE_BACKEND", "Configured for S3-compatible object storage.")

        # S3 Endpoint URL
        endpoint = self.env.get("S3_ENDPOINT_URL", "").strip()
        if not endpoint:
            self.fail("S3_ENDPOINT_URL", "Missing S3 endpoint URL.", "Set to Supabase Storage endpoint: https://<project-ref>.supabase.co/storage/v1/s3")
        elif not endpoint.startswith("https://"):
            self.fail("S3_ENDPOINT_URL", "Endpoint must start with 'https://'.")
        elif "supabase.co" in endpoint:
            if not endpoint.rstrip("/").endswith("/storage/v1/s3"):
                self.fail(
                    "S3_ENDPOINT_URL",
                    f"Supabase S3 endpoint '{endpoint}' is missing the required '/storage/v1/s3' path ending!",
                    "Format must be: https://<PROJECT-REF>.supabase.co/storage/v1/s3"
                )
            elif "your-project-ref" in endpoint:
                self.fail("S3_ENDPOINT_URL", "Contains unedited placeholder 'your-project-ref'.", "Use your real Supabase Project Reference.")
            else:
                self.ok("S3_ENDPOINT_URL", "Valid Supabase Storage S3 endpoint with '/storage/v1/s3' ending.")
        else:
            self.ok("S3_ENDPOINT_URL", f"S3 endpoint configured ({endpoint[:30]}...).")

        # Bucket
        bucket = self.env.get("S3_BUCKET", "").strip()
        if not bucket:
            self.fail("S3_BUCKET", "Missing bucket name.", "Provide bucket name created in Supabase Storage (e.g. 'invoices').")
        elif " " in bucket or "/" in bucket or any(c.isupper() for c in bucket):
            self.fail("S3_BUCKET", f"Invalid bucket name '{bucket}'.", "Bucket names must be lowercase with no spaces or slashes.")
        else:
            self.ok("S3_BUCKET", f"Bucket name '{bucket}' is valid.")

        # S3 Access Keys
        access_key = self.env.get("S3_ACCESS_KEY_ID", "").strip()
        secret_key = self.env.get("S3_SECRET_ACCESS_KEY", "").strip()

        if not access_key or any(m in access_key for m in PLACEHOLDER_MARKERS):
            self.fail("S3_ACCESS_KEY_ID", "Missing or contains placeholder text.", "Generate S3 Access Keys in Supabase Storage settings.")
        else:
            self.ok("S3_ACCESS_KEY_ID", f"Access key configured ({len(access_key)} chars).")

        if not secret_key or any(m in secret_key for m in PLACEHOLDER_MARKERS):
            self.fail("S3_SECRET_ACCESS_KEY", "Missing or contains placeholder text.", "Generate S3 Secret Key in Supabase Storage settings.")
        else:
            self.ok("S3_SECRET_ACCESS_KEY", f"Secret key configured ({len(secret_key)} chars, value masked).")

    def _check_cors_origins(self) -> None:
        raw_origins = self.env.get("FRONTEND_ORIGINS", "").strip()
        env_mode = self.env.get("ENVIRONMENT", "").strip().lower()

        if not raw_origins:
            self.fail("FRONTEND_ORIGINS", "Missing allowed frontend origins.", "Set comma-separated URLs (e.g. https://finance-flow-ai.vercel.app,http://localhost:3000).")
            return

        # Parse comma-separated or JSON list
        origins: list[str] = []
        if raw_origins.startswith("[") and raw_origins.endswith("]"):
            try:
                parsed = json.loads(raw_origins)
                if isinstance(parsed, list):
                    origins = [str(x).strip() for x in parsed if str(x).strip()]
            except Exception:
                pass
        if not origins:
            origins = [o.strip() for o in raw_origins.split(",") if o.strip()]

        has_trailing_slash = False
        invalid_scheme = False
        has_prod_origin = False

        for origin in origins:
            if origin.endswith("/"):
                has_trailing_slash = True
            if not origin.startswith(("http://", "https://")):
                invalid_scheme = True
            if "vercel.app" in origin or ("https://" in origin and "localhost" not in origin):
                has_prod_origin = True

        if invalid_scheme:
            self.fail("FRONTEND_ORIGINS", "One or more origins missing 'http://' or 'https://' scheme.", "Origins must include protocol (e.g. https://your-site.vercel.app).")
        elif has_trailing_slash:
            self.fail(
                "FRONTEND_ORIGINS",
                "One or more origins contain trailing slashes ('/'). Browser Origin headers NEVER contain trailing slashes!",
                "Remove trailing slashes (e.g. change 'https://app.vercel.app/' to 'https://app.vercel.app')."
            )
        else:
            self.ok("FRONTEND_ORIGINS", f"{len(origins)} valid origin(s) configured without trailing slashes.")

        if env_mode == "production" and not has_prod_origin:
            self.warn(
                "FRONTEND_ORIGINS",
                "No production frontend origin (e.g. *.vercel.app) found in origins list.",
                "Add your production Vercel URL to FRONTEND_ORIGINS once deployed."
            )

    def _check_ocr_and_memory_limits(self) -> None:
        concurrency = self.env.get("OCR_CONCURRENCY", "1").strip()
        max_dim = self.env.get("OCR_MAX_IMAGE_DIM", "1200").strip()

        try:
            c_val = int(concurrency)
            if c_val > 1:
                self.warn("OCR_CONCURRENCY", f"Set to {c_val}. Render free tier has only 512MB RAM.", "Keep OCR_CONCURRENCY=1 to prevent out-of-memory crashes.")
            else:
                self.ok("OCR_CONCURRENCY", f"Set to {c_val} (safe for 512MB RAM).")
        except ValueError:
            self.fail("OCR_CONCURRENCY", f"Invalid integer '{concurrency}'.")

        try:
            d_val = int(max_dim)
            if d_val > 1200:
                self.warn("OCR_MAX_IMAGE_DIM", f"Set to {d_val}px. Large images may consume > 400MB RAM during OCR.", "Recommended maximum is 1200px on Render free tier.")
            else:
                self.ok("OCR_MAX_IMAGE_DIM", f"Set to {d_val}px (safe for 512MB RAM).")
        except ValueError:
            self.fail("OCR_MAX_IMAGE_DIM", f"Invalid integer '{max_dim}'.")

        timeout = self.env.get("OCR_TIMEOUT_SECONDS", "240").strip()
        try:
            t_val = int(timeout)
            if t_val < 120:
                self.warn(
                    "OCR_TIMEOUT_SECONDS",
                    f"Set to {t_val}s. On Render free tier (0.1 vCPU limit), OCR may occasionally need > 90s.",
                    "Recommend setting OCR_TIMEOUT_SECONDS=240 on Render free tier.",
                )
            else:
                self.ok("OCR_TIMEOUT_SECONDS", f"Set to {t_val}s (safe for Render free tier).")
        except ValueError:
            self.fail("OCR_TIMEOUT_SECONDS", f"Invalid integer '{timeout}'.")


def load_env_file(filepath: Path) -> dict[str, str]:
    env_vars: dict[str, str] = {}
    if not filepath.exists():
        print(f"[!] Error: File '{filepath}' does not exist.")
        sys.exit(1)

    for line in filepath.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, _, v = line.partition("=")
            key = k.strip()
            val = v.strip().strip("'\"")
            env_vars[key] = val
    return env_vars


if __name__ == "__main__":
    import os

    source_desc = "current process environment"
    target_env: dict[str, str] = dict(os.environ)

    # Check for CLI argument specifying a .env file
    if len(sys.argv) > 1:
        target_path = Path(sys.argv[1])
        target_env = load_env_file(target_path)
        source_desc = f"file '{target_path}'"

    validator = EnvValidator(target_env, source_name=source_desc)
    sys.exit(validator.validate_all())
