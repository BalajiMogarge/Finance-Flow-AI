"""ORM models for Finance Flow AI.

Captures organizations, users, invoices, audit trails, and review workflows.
Includes multi-tenancy, SHA-256 duplicate detection, async pipeline states (processing/completed/failed),
and performance indexes required for Neon PostgreSQL.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Organization(Base):
    """An organization or enterprise tenant for data isolation."""

    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    users: Mapped[list[User]] = relationship("User", back_populates="organization")
    invoices: Mapped[list[Invoice]] = relationship("Invoice", back_populates="organization")


class User(Base):
    """An authenticated user in the platform."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(32), default="reviewer", nullable=False)  # admin, reviewer, viewer
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    organization: Mapped[Organization | None] = relationship("Organization", back_populates="users")


class Invoice(Base):
    """A processed invoice record with async job status, duplicate tracking, and review support."""

    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )

    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_type: Mapped[str] = mapped_column(String(32), default="local", nullable=False)
    is_ephemeral: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # SHA-256 for duplicate check
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    file_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)  # Kept for backward compatibility

    # Async lifecycle status: processing, completed, failed
    status: Mapped[str] = mapped_column(String(32), default="processing", nullable=False)
    error_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    vendor: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    invoice_number: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(32), nullable=True)

    total: Mapped[float | None] = mapped_column(Float, nullable=True)

    decision: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Serialized JSON of full extracted fields, validation result, and OCR payload
    extracted_data: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Duplicate tracking flag
    is_duplicate: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Human review workflow fields
    reviewed_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    organization: Mapped[Organization | None] = relationship("Organization", back_populates="invoices")
    audit_logs: Mapped[list[AuditLog]] = relationship("AuditLog", back_populates="invoice")

    __table_args__ = (
        Index("uq_invoices_org_sha256", "organization_id", "sha256", unique=True),
        Index("ix_invoices_org_created_at", "organization_id", "created_at"),
        Index("ix_invoices_org_status", "organization_id", "status"),
    )

    def get_extracted_data(self) -> dict[str, Any]:
        """Safely decode extracted_data JSON or return empty dict."""
        if not self.extracted_data:
            return {}
        try:
            return json.loads(self.extracted_data)
        except Exception:
            return {}


class AuditLog(Base):
    """Immutable audit trail for automated decisions and human reviews."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=True
    )
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)  # "upload_accepted", "upload_processed", "human_review"
    previous_state: Mapped[str | None] = mapped_column(String(64), nullable=True)
    new_state: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    invoice: Mapped[Invoice | None] = relationship("Invoice", back_populates="audit_logs")
