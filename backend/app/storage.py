"""Pluggable file storage for Finance Flow AI.

Provides transparent file persistence across local filesystems and S3-compatible
object stores (e.g. Cloudflare R2, AWS S3, Supabase Storage, MinIO).
Accurately reports whether storage is ephemeral or durable so that UI and logs
never misrepresent local temporary storage as permanent.
"""

from __future__ import annotations

import io
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from uuid import uuid4

from .config import settings


@dataclass
class StorageResult:
    key: str
    storage_type: str  # "local", "s3"
    is_ephemeral: bool
    size_bytes: int
    url: Optional[str] = None


class BaseStorage(ABC):
    @abstractmethod
    def save(self, filename: str, content: bytes, content_type: str) -> StorageResult:
        """Persist bytes and return metadata."""

    @abstractmethod
    def load(self, key: str) -> bytes:
        """Read bytes for a given storage key."""

    @abstractmethod
    def delete(self, key: str) -> None:
        """Remove a persisted file."""


class LocalFileStorage(BaseStorage):
    def __init__(self, upload_dir: Path) -> None:
        self.upload_dir = upload_dir
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        # On Render / container free tiers without a mounted disk volume,
        # the local disk is wiped on every restart / deploy.
        self.is_ephemeral = os.environ.get("RENDER") is not None and not os.environ.get(
            "PERSISTENT_DISK_MOUNTED"
        )

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
            url=None,
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


class S3FileStorage(BaseStorage):
    def __init__(self) -> None:
        import boto3
        from botocore.client import Config

        session = boto3.session.Session()
        self.bucket = settings.S3_BUCKET_NAME
        self.s3_client = session.client(
            service_name="s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            region_name=settings.S3_REGION,
            config=Config(s3={"addressing_style": "virtual"}),
        )

    def save(self, filename: str, content: bytes, content_type: str) -> StorageResult:
        ext = Path(filename).suffix.lower()
        key = f"invoices/{uuid4().hex}{ext}"
        self.s3_client.upload_fileobj(
            io.BytesIO(content),
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
        return StorageResult(
            key=key,
            storage_type="s3",
            is_ephemeral=False,
            size_bytes=len(content),
            url=f"{settings.S3_ENDPOINT_URL}/{self.bucket}/{key}"
            if settings.S3_ENDPOINT_URL
            else None,
        )

    def load(self, key: str) -> bytes:
        buffer = io.BytesIO()
        self.s3_client.download_fileobj(self.bucket, key, buffer)
        return buffer.getvalue()

    def delete(self, key: str) -> None:
        self.s3_client.delete_object(Bucket=self.bucket, Key=key)


def get_storage_provider() -> BaseStorage:
    """Return the configured storage provider."""
    if (
        settings.STORAGE_BACKEND == "s3"
        and settings.S3_BUCKET_NAME
        and settings.S3_ACCESS_KEY_ID
        and settings.S3_SECRET_ACCESS_KEY
    ):
        try:
            return S3FileStorage()
        except Exception:
            # Fallback to local storage if S3 initialization fails
            pass
    return LocalFileStorage(settings.UPLOAD_DIR)
