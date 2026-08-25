from pathlib import Path
import shutil

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

# Folder where uploaded invoices will be stored
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# MIME types / extensions that EasyOCR can read directly.
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


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
    file_path = UPLOAD_DIR / file.filename

    # Persist the upload first so the client always gets something back, even
    # if OCR fails downstream.
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    suffix = file_path.suffix.lower()
    response: dict = {
        "filename": file.filename,
        "saved_to": str(file_path),
        "status": "uploaded",
    }

    # OCR is only wired for image invoices for now. PDF support lands in the
    # next step; unknown extensions are still accepted but skipped.
    if suffix in IMAGE_EXTENSIONS:
        try:
            ocr_result = image_to_text(file_path)
        except Exception as exc:  # noqa: BLE001 - surface OCR failures to caller
            raise HTTPException(
                status_code=500,
                detail=f"OCR failed for {file.filename}: {exc}",
            ) from exc

        fields = extract_invoice_fields(ocr_result)
        validation = validate_invoice(fields)
        decision = make_decision(
            validation,
            fields,
            ocr_result.get("average_confidence"),
        )

        # Persist the processed invoice. The response payload below
        # remains identical to the previous contract — the database
        # write is purely additive.
        _save_invoice(db, file.filename, fields, decision)

        response["status"] = "processed"
        response["ocr"] = ocr_result
        response["fields"] = fields
        response["validation"] = validation
        response["decision"] = decision

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
