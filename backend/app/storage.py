"""Pluggable file storage for Finance Flow AI.

Provides transparent file persistence across S3-compatible private object stores
(e.g. Supabase Storage, Cloudflare R2, AWS S3, MinIO) and local filesystems (development only).
Private buckets are enforced; files are never exposed publicly and are accessed
only through short-lived presigned URLs.
"""

from __future__ import annotations

import io
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from .config import settings


@dataclass
class StorageResult:
    key: str
    storage_type: str  # "local", "s3"
    is_ephemeral: bool
    size_bytes: int
    url: str | None = None


class BaseStorage(ABC):
    @abstractmethod
    def save(self, filename: str, content: bytes, content_type: str) -> StorageResult:
        """Persist bytes and return metadata with storage key."""

    @abstractmethod
    def load(self, key: str) -> bytes:
        """Read bytes for a given storage key."""

    @abstractmethod
    def delete(self, key: str) -> None:
        """Remove a persisted file."""

    @abstractmethod
    def generate_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        """Generate a short-lived download URL for secure client access."""


class LocalFileStorage(BaseStorage):
    def __init__(self, upload_dir: Path) -> None:
        self.upload_dir = upload_dir
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.is_ephemeral = True

    def save(self, filename: str, content: bytes, content_type: str) -> StorageResult:
        ext = Path(filename).suffix.lower()
        unique_name = f"{uuid4().hex}{ext}"
        target_path = self.upload_dir / unique_name
        target_path.write_bytes(content)

        return StorageResult(
            key=unique_name,
            storage_type="local",
            is_ephemeral=self.is_ephemeral,
            size_bytes=len(content),
            url=f"/api/invoices/file/{unique_name}",
        )

    def load(self, key: str) -> bytes:
        target = self.upload_dir / key
        if not target.exists():
            raise FileNotFoundError(f"File {key} not found in local storage.")
        return target.read_bytes()

    def delete(self, key: str) -> None:
        target = self.upload_dir / key
        if target.exists():
            target.unlink(missing_ok=True)

    def generate_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        # Development mock URL for local file inspection
        return f"/api/invoices/file/{key}"


class S3FileStorage(BaseStorage):
    def __init__(self) -> None:
        import boto3
        from botocore.client import Config

        session = boto3.session.Session()
        self.bucket = settings.S3_BUCKET
        if not self.bucket:
            raise ValueError("S3_BUCKET must be specified when using STORAGE_BACKEND=s3.")

        self.s3_client = session.client(
            service_name="s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            region_name=settings.S3_REGION,
            config=Config(
                s3={"addressing_style": "virtual"},
                signature_version="s3v4",
            ),
        )

    def save(self, filename: str, content: bytes, content_type: str) -> StorageResult:
        ext = Path(filename).suffix.lower()
        key = f"invoices/{uuid4().hex}{ext}"
        self.s3_client.upload_fileobj(
            io.BytesIO(content),
            self.bucket,
            key,
            ExtraArgs={
                "ContentType": content_type,
            },
        )
        presigned = self.generate_presigned_url(key, expires_in=3600)
        return StorageResult(
            key=key,
            storage_type="s3",
            is_ephemeral=False,
            size_bytes=len(content),
            url=presigned,
        )

    def load(self, key: str) -> bytes:
        buffer = io.BytesIO()
        self.s3_client.download_fileobj(self.bucket, key, buffer)
        return buffer.getvalue()

    def delete(self, key: str) -> None:
        self.s3_client.delete_object(Bucket=self.bucket, Key=key)

    def generate_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        """Generate a short-lived presigned URL for private S3 objects."""
        return self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )


def get_storage_provider() -> BaseStorage:
    """Return the configured storage provider."""
    if settings.STORAGE_BACKEND == "s3":
        return S3FileStorage()
    return LocalFileStorage(settings.UPLOAD_DIR)
