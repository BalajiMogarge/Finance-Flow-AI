"""ORM models for Finance Flow AI.

The schema is intentionally minimal — a single :class:`Invoice` table
captures everything the dashboard needs to render the list and stats
endpoints. More relationships (vendors, line items, audit trail) can
be added later without disturbing the current contract.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Invoice(Base):
    """A processed invoice record.

    The fields mirror what the upload pipeline produces so we can save
    the result of OCR + extraction + validation + decision in a single
    insert. ``created_at`` is filled in by the database so every row
    has a stable, server-side timestamp.
    """

    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    invoice_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(32), nullable=True)

    total: Mapped[float | None] = mapped_column(Float, nullable=True)

    decision: Mapped[str | None] = mapped_column(String(32), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # ``server_default`` makes the database fill the timestamp so the
    # application code never has to remember to set it.
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper only
        return (
            f"<Invoice id={self.id} vendor={self.vendor!r} "
            f"decision={self.decision!r} total={self.total!r}>"
        )
