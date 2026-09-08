from pathlib import Path, PurePosixPath
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .decision import make_decision
from .extractor import extract_invoice_fields
from .models import Invoice
from .ocr import image_to_text
from .validator import validate_invoice

# Ensure the schema exists before the first request comes in. This is
# cheap and idempotent so it's safe to call at import time.
Base.metadata.create_all(bind=engine)

app = FastAPI()

# Allow the Next.js frontend to talk to FastAPI.
# The dashboard runs on :3001 and also fetches via 127.0.0.1:8000, so both
# loopback origins are permitted.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Folder where uploaded invoices will be stored.
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# MIME types / extensions that EasyOCR can read directly.
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
UPLOAD_CHUNK_SIZE = 1024 * 1024


def _display_filename(filename: str | None) -> str:
    """Return a basename safe to display; never use it for storage."""
    candidate = PurePosixPath((filename or "upload").replace("\\", "/")).name
    return candidate.replace("\x00", "") or "upload"


def _save_invoice(
    db: Session,
    filename: str | None,
    fields: dict,
    decision_result: dict,
) -> Invoice:
    """Persist the processed invoice and return the saved row.

    Pulled out of ``/upload`` so it can be unit-tested independently
    and so the route handler stays focused on the HTTP concerns.
    """
    record = Invoice(
        filename=filename,
        vendor=fields.get("vendor"),
        invoice_number=fields.get("invoice_number"),
        gstin=fields.get("gstin"),
        total=fields.get("total"),
        decision=decision_result.get("decision"),
        confidence=decision_result.get("confidence"),
        risk_level=decision_result.get("risk_level"),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/upload")
async def upload_invoice(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    filename = _display_filename(file.filename)
    suffix = Path(filename).suffix.lower()
    if suffix not in IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail="Unsupported file type. Upload a PNG, JPG, WebP, BMP, or TIFF image.",
        )

    file_path = UPLOAD_DIR / f"{uuid4().hex}{suffix}"
    written = 0
    try:
        with file_path.open("xb") as buffer:
            while chunk := await file.read(UPLOAD_CHUNK_SIZE):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Upload exceeds the 10 MB limit.")
                buffer.write(chunk)
    except Exception:
        file_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    response: dict = {
        "filename": filename,
        "status": "processed",
    }

    try:
        ocr_result = image_to_text(file_path)
        fields = extract_invoice_fields(ocr_result)
        validation = validate_invoice(fields)
        decision = make_decision(validation, fields, ocr_result.get("average_confidence"))
        _save_invoice(db, filename, fields, decision)
        response["ocr"] = ocr_result
        response["fields"] = fields
        response["validation"] = validation
        response["decision"] = decision
    except Exception as exc:
        db.rollback()
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Processing failed for {filename}.") from exc

    return response


@app.get("/invoices")
def list_invoices(db: Session = Depends(get_db)):
    """Return processed invoices, newest first.

    Only the fields the dashboard renders are included so the payload
    stays small. The shape mirrors the example in the task brief.
    """
    rows = (
        db.query(Invoice)
        .order_by(Invoice.created_at.desc(), Invoice.id.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "filename": row.filename,
            "vendor": row.vendor,
            "invoice_number": row.invoice_number,
            "gstin": row.gstin,
            "total": row.total,
            "decision": row.decision,
            "confidence": row.confidence,
            "risk_level": row.risk_level,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@app.get("/stats")
def invoice_stats(db: Session = Depends(get_db)):
    """Return dashboard counters derived from the invoices table.

    ``total`` is the number of stored invoices. ``approved``,
    ``rejected`` and ``pending`` count rows by their decision value
    (case-insensitive — OCR pipelines sometimes flip the casing).
    """
    total = db.query(func.count(Invoice.id)).scalar() or 0

    def _count(matcher) -> int:
        return (
            db.query(func.count(Invoice.id))
            .filter(matcher(Invoice.decision))
            .scalar()
            or 0
        )

    approved = _count(lambda d: func.upper(d) == "APPROVE")
    rejected = _count(lambda d: func.upper(d) == "REJECT")
    pending = _count(
        lambda d: func.upper(d).in_(["PENDING REVIEW", "PENDING"])
    )

    return {
        "total": int(total),
        "approved": int(approved),
        "rejected": int(rejected),
        "pending": int(pending),
    }


@app.get("/insights")
def invoice_insights(db: Session = Depends(get_db)):
    """Return high-level AI insights based on historical invoice data.

    Calculates top vendor, approval rate, and verification accuracy.
    """
    total = db.query(func.count(Invoice.id)).scalar() or 0
    if total == 0:
        return {
            "top_vendor": "No data",
            "approval_rate": 0.0,
            "high_value_count": 0,
            "accuracy": 0.0,
        }

    # Most frequent vendor
    top_vendor_row = (
        db.query(Invoice.vendor, func.count(Invoice.id))
        .filter(Invoice.vendor != None)
        .group_by(Invoice.vendor)
        .order_by(func.count(Invoice.id).desc())
        .first()
    )
    top_vendor = top_vendor_row[0] if top_vendor_row else "Unknown"

    # Approval rate (%)
    approved_count = db.query(func.count(Invoice.id)).filter(func.upper(Invoice.decision) == "APPROVE").scalar() or 0
    approval_rate = (approved_count / total) * 100

    # High-value approved invoices (>= 200,000)
    high_value_count = db.query(func.count(Invoice.id)).filter(
        func.upper(Invoice.decision) == "APPROVE",
        Invoice.total >= 200_000
    ).scalar() or 0

    # Accuracy: (Approved + Rejected) / Total
    verified_count = db.query(func.count(Invoice.id)).filter(
        func.upper(Invoice.decision).in_(["APPROVE", "REJECT"])
    ).scalar() or 0
    accuracy = (verified_count / total) * 100

    return {
        "top_vendor": top_vendor,
        "approval_rate": round(approval_rate, 1),
        "high_value_count": int(high_value_count),
        "accuracy": round(accuracy, 1),
    }
