from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from uuid import uuid4
import asyncio
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, UploadFile, File, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .auth import (
    create_access_token,
    get_current_user,
    get_optional_user,
    hash_password,
    require_roles,
    verify_password,
)
from .config import settings
from .database import Base, engine, get_db, init_db
from .decision import make_decision
from .extractor import extract_invoice_fields
from .file_utils import calculate_sha256, detect_file_type, extract_text_from_pdf
from .models import AuditLog, Invoice, Organization, User
from .ocr import _ocr_semaphore, image_to_text
from .rate_limit import rate_limit_api, rate_limit_upload
from .storage import get_storage_provider
from .validator import validate_invoice

UPLOAD_CHUNK_SIZE = 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Ensure database schema and upload directories exist on startup."""
    init_db()
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="Finance Flow AI API",
    description="Enterprise-grade invoice verification, extraction, and audit reconciliation platform.",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS configuration supporting environment-defined origins and Vercel domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOWED_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = settings.UPLOAD_DIR
MAX_UPLOAD_BYTES = settings.MAX_UPLOAD_BYTES


# ---------------------------------------------------------------------------
# Request / Response Schemas
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None
    role: Optional[str] = "reviewer"  # admin, reviewer, viewer
    organization_name: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ReviewRequest(BaseModel):
    decision: str  # APPROVE, REJECT
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _display_filename(filename: str | None) -> str:
    """Return a basename safe to display; never use it for storage."""
    candidate = PurePosixPath((filename or "upload").replace("\\", "/")).name
    return candidate.replace("\x00", "") or "upload"


def _save_invoice(
    db: Session,
    filename: str | None,
    fields: dict,
    decision_result: dict,
    storage_key: str | None = None,
    storage_type: str = "local",
    is_ephemeral: bool = False,
    file_hash: str | None = None,
    is_duplicate: bool = False,
    organization_id: int | None = None,
) -> Invoice:
    """Persist the processed invoice and return the saved row."""
    record = Invoice(
        filename=filename,
        storage_key=storage_key,
        storage_type=storage_type,
        is_ephemeral=is_ephemeral,
        file_hash=file_hash,
        is_duplicate=is_duplicate,
        organization_id=organization_id,
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


async def _run_ocr(path: Path) -> dict:
    """Run OCR in a worker thread under the semaphore to avoid blocking the event loop."""
    async with _ocr_semaphore:
        return await asyncio.to_thread(image_to_text, path)


# ---------------------------------------------------------------------------
# Auth Routes
# ---------------------------------------------------------------------------

@app.post("/auth/register")
def register_user(req: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new user and optional organization."""
    existing = db.query(User).filter(User.email == req.email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists.",
        )

    org_name = req.organization_name or "Default Organization"
    org = db.query(Organization).filter(Organization.name == org_name).first()
    if not org:
        org = Organization(name=org_name)
        db.add(org)
        db.commit()
        db.refresh(org)

    user = User(
        email=req.email.lower(),
        hashed_password=hash_password(req.password),
        full_name=req.full_name,
        role=req.role if req.role in {"admin", "reviewer", "viewer"} else "reviewer",
        organization_id=org.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id), "role": user.role, "org_id": org.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "organization": org.name,
        },
    }


@app.post("/auth/login")
def login_user(req: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate with email and password to receive a JWT session token."""
    user = db.query(User).filter(User.email == req.email.lower()).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    token = create_access_token({"sub": str(user.id), "role": user.role, "org_id": user.organization_id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "organization_id": user.organization_id,
        },
    }


@app.get("/auth/me")
def get_current_user_profile(user: User = Depends(get_current_user)):
    """Return the authenticated user profile."""
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "organization_id": user.organization_id,
        "organization_name": user.organization.name if user.organization else None,
    }


# ---------------------------------------------------------------------------
# Core Operational Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "database": "connected",
        "storage": settings.STORAGE_BACKEND,
    }


@app.post("/upload")
async def upload_invoice(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_optional_user),
):
    rate_limit_upload(request)
    filename = _display_filename(file.filename)
    suffix = Path(filename).suffix.lower()

    # Read file content with streaming size guard
    content_chunks = []
    written = 0
    while chunk := await file.read(UPLOAD_CHUNK_SIZE):
        written += len(chunk)
        if written > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Upload exceeds the 10 MB limit.")
        content_chunks.append(chunk)

    await file.close()
    content = b"".join(content_chunks)

    # Magic-byte validation
    file_type = detect_file_type(content, filename)

    # Calculate SHA-256 for duplicate check
    file_hash = calculate_sha256(content)
    org_id = user.organization_id if user else None

    # Check for duplicate file hash
    dup_query = db.query(Invoice).filter(Invoice.file_hash == file_hash)
    if org_id is not None:
        dup_query = dup_query.filter(Invoice.organization_id == org_id)
    existing_by_hash = dup_query.first()
    is_duplicate = existing_by_hash is not None

    # Persist via pluggable storage provider
    storage = get_storage_provider()
    storage_res = storage.save(filename, content, file.content_type or "application/octet-stream")

    # Save to local file_path for OCR processing if needed
    file_path = UPLOAD_DIR / storage_res.key
    if not file_path.exists():
        file_path.write_bytes(content)

    response: dict = {
        "filename": filename,
        "status": "processed",
    }

    try:
        if file_type == "pdf":
            # Extract digital text from PDF directly (0 memory OCR bypass)
            pdf_ocr = extract_text_from_pdf(content)
            if pdf_ocr:
                ocr_result = pdf_ocr
            else:
                # Scanned image inside PDF or rendering fallback
                ocr_result = await _run_ocr(file_path)
        else:
            ocr_result = await _run_ocr(file_path)

        fields = extract_invoice_fields(ocr_result)
        validation = validate_invoice(fields)

        # Duplicate checking by vendor and invoice number
        if fields.get("vendor") and fields.get("invoice_number"):
            dup_inv_q = db.query(Invoice).filter(
                Invoice.vendor == fields["vendor"],
                Invoice.invoice_number == fields["invoice_number"],
            )
            if org_id is not None:
                dup_inv_q = dup_inv_q.filter(Invoice.organization_id == org_id)
            existing_by_num = dup_inv_q.first()
            if existing_by_num:
                is_duplicate = True
                validation["warnings"].append(
                    f"Duplicate invoice detected: vendor '{fields['vendor']}' already has invoice #{fields['invoice_number']} on record (ID #{existing_by_num.id})."
                )

        if is_duplicate and existing_by_hash:
            validation["warnings"].append(
                f"Duplicate file: identical document previously processed as invoice #{existing_by_hash.id}."
            )

        decision = make_decision(validation, fields, ocr_result.get("average_confidence"))

        record = _save_invoice(
            db=db,
            filename=filename,
            fields=fields,
            decision_result=decision,
            storage_key=storage_res.key,
            storage_type=storage_res.storage_type,
            is_ephemeral=storage_res.is_ephemeral,
            file_hash=file_hash,
            is_duplicate=is_duplicate,
            organization_id=org_id,
        )

        # Audit log creation
        audit_entry = AuditLog(
            invoice_id=record.id,
            user_id=user.id if user else None,
            action="upload_processed",
            previous_state=None,
            new_state=decision.get("decision"),
            notes=f"Processed upload {filename}. Duplicate={is_duplicate}, Storage={storage_res.storage_type}.",
        )
        db.add(audit_entry)
        db.commit()

        # Build response preserving exact legacy contract plus additive fields
        response["ocr"] = ocr_result
        response["fields"] = fields
        response["validation"] = validation
        response["decision"] = decision
        response["id"] = record.id
        response["is_duplicate"] = is_duplicate
        response["file_hash"] = file_hash
        response["storage_type"] = storage_res.storage_type
        response["is_ephemeral"] = storage_res.is_ephemeral

    except Exception as exc:
        db.rollback()
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Processing failed for {filename}.") from exc

    return response


@app.get("/invoices")
def list_invoices(
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_optional_user),
    decision: Optional[str] = None,
    search: Optional[str] = None,
    is_duplicate: Optional[bool] = None,
    page: int = 1,
    page_size: int = 50,
):
    """Return processed invoices, optionally filtered by user org, status, and search."""
    query = db.query(Invoice)

    if user and user.organization_id is not None:
        query = query.filter(Invoice.organization_id == user.organization_id)

    if decision:
        query = query.filter(func.upper(Invoice.decision) == decision.upper())

    if is_duplicate is not None:
        query = query.filter(Invoice.is_duplicate == is_duplicate)

    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            (Invoice.vendor.ilike(search_filter))
            | (Invoice.invoice_number.ilike(search_filter))
            | (Invoice.filename.ilike(search_filter))
        )

    rows = (
        query.order_by(Invoice.created_at.desc(), Invoice.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
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
            "is_duplicate": row.is_duplicate,
            "storage_type": row.storage_type,
            "is_ephemeral": row.is_ephemeral,
            "reviewed_by": row.reviewed_by,
            "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
            "review_notes": row.review_notes,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@app.post("/invoices/{invoice_id}/review")
def review_invoice(
    invoice_id: int,
    req: ReviewRequest,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_optional_user),
):
    """Human review decision on an invoice (e.g. approving a PENDING REVIEW invoice)."""
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail=f"Invoice #{invoice_id} not found.")

    if req.decision.upper() not in {"APPROVE", "REJECT"}:
        raise HTTPException(
            status_code=400,
            detail="Review decision must be 'APPROVE' or 'REJECT'.",
        )

    old_decision = invoice.decision
    new_decision = req.decision.upper()

    invoice.decision = new_decision
    invoice.risk_level = "LOW" if new_decision == "APPROVE" else "HIGH"
    invoice.reviewed_by = user.id if user else None
    invoice.reviewed_at = datetime.now(timezone.utc)
    invoice.review_notes = req.notes

    audit_entry = AuditLog(
        invoice_id=invoice.id,
        user_id=user.id if user else None,
        action="human_review",
        previous_state=old_decision,
        new_state=new_decision,
        notes=req.notes or f"Manual review changed status from {old_decision} to {new_decision}.",
    )
    db.add(audit_entry)
    db.commit()
    db.refresh(invoice)

    return {
        "id": invoice.id,
        "vendor": invoice.vendor,
        "invoice_number": invoice.invoice_number,
        "decision": invoice.decision,
        "risk_level": invoice.risk_level,
        "reviewed_at": invoice.reviewed_at.isoformat() if invoice.reviewed_at else None,
        "review_notes": invoice.review_notes,
    }


@app.get("/invoices/{invoice_id}/audit")
def get_invoice_audit_trail(invoice_id: int, db: Session = Depends(get_db)):
    """Fetch immutable audit log trail for an invoice."""
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail=f"Invoice #{invoice_id} not found.")

    logs = (
        db.query(AuditLog)
        .filter(AuditLog.invoice_id == invoice_id)
        .order_by(AuditLog.created_at.asc())
        .all()
    )

    return [
        {
            "id": log.id,
            "action": log.action,
            "previous_state": log.previous_state,
            "new_state": log.new_state,
            "notes": log.notes,
            "user_id": log.user_id,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]


@app.get("/stats")
def invoice_stats(
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_optional_user),
):
    """Return dashboard counters derived from the invoices table."""
    base_q = db.query(Invoice)
    if user and user.organization_id is not None:
        base_q = base_q.filter(Invoice.organization_id == user.organization_id)

    total = base_q.count()

    def _count(matcher) -> int:
        q = base_q.filter(matcher(Invoice.decision))
        return q.count()

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
def invoice_insights(
    days: Optional[int] = None,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_optional_user),
):
    """Return high-level AI insights based on historical invoice data."""
    base_q = db.query(Invoice)
    if user and user.organization_id is not None:
        base_q = base_q.filter(Invoice.organization_id == user.organization_id)

    if days and days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        base_q = base_q.filter(Invoice.created_at >= cutoff)

    total = base_q.count()
    if total == 0:
        return {
            "top_vendor": "No data",
            "approval_rate": 0.0,
            "high_value_count": 0,
            "accuracy": 0.0,
        }

    # Most frequent vendor
    top_vendor_row = (
        base_q.filter(Invoice.vendor != None)
        .with_entities(Invoice.vendor, func.count(Invoice.id))
        .group_by(Invoice.vendor)
        .order_by(func.count(Invoice.id).desc())
        .first()
    )
    top_vendor = top_vendor_row[0] if top_vendor_row else "Unknown"

    # Approval rate (%)
    approved_count = base_q.filter(func.upper(Invoice.decision) == "APPROVE").count()
    approval_rate = (approved_count / total) * 100

    # High-value approved invoices (>= 200,000)
    high_value_count = base_q.filter(
        func.upper(Invoice.decision) == "APPROVE",
        Invoice.total >= 200_000,
    ).count()

    # Accuracy: (Approved + Rejected) / Total
    verified_count = base_q.filter(
        func.upper(Invoice.decision).in_(["APPROVE", "REJECT"])
    ).count()
    accuracy = (verified_count / total) * 100

    return {
        "top_vendor": top_vendor,
        "approval_rate": round(approval_rate, 1),
        "high_value_count": int(high_value_count),
        "accuracy": round(accuracy, 1),
    }
