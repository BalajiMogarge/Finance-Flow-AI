"""FastAPI application entrypoint for Finance Flow AI.

Provides asynchronous invoice ingestion (POST /api/invoices returning 202 Accepted),
deterministic validation and decision pipelines, role-based multi-tenancy,
health and readiness probes, and SlowAPI rate limiting.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from slowapi.errors import RateLimitExceeded
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from .auth import (
    create_access_token,
    get_current_user,
    get_optional_user,
    hash_password,
    verify_password,
)
from .config import settings
from .database import SessionLocal, engine, get_db, init_db  # noqa: F401
from .decision import make_decision
from .extractor import extract_invoice_fields
from .file_utils import calculate_sha256, detect_file_type, extract_text_from_pdf
from .models import AuditLog, Invoice, Organization, User
from .ocr import image_to_text, init_ocr, is_ocr_ready
from .rate_limit import limiter, rate_limit_exceeded_handler
from .storage import get_storage_provider
from .validator import validate_invoice

# Configure application logging (never log invoice contents or GSTINs at INFO)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("finance_flow_ai")

UPLOAD_CHUNK_SIZE = 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: initialize database, warm up OCR, and recover stale jobs."""
    logger.info("Initializing application schema and directories...")
    init_db()
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # Warm up RapidOCR model at startup
    try:
        init_ocr()
    except Exception as exc:
        logger.warning("Could not warm up OCR reader on startup: %s", exc)

    # Reconcile orphaned processing rows (stuck > 10 minutes from server restarts)
    try:
        db = SessionLocal()
        try:
            cutoff = datetime.now(UTC) - timedelta(minutes=10)
            stuck_invoices = (
                db.query(Invoice)
                .filter(Invoice.status == "processing", Invoice.created_at <= cutoff)
                .all()
            )
            for inv in stuck_invoices:
                inv.status = "failed"
                inv.error_reason = (
                    "Processing interrupted by server restart or exceeded maximum job duration."
                )
            if stuck_invoices:
                db.commit()
                logger.info("Marked %d stuck invoice(s) as failed on startup recovery.", len(stuck_invoices))
        finally:
            db.close()
    except Exception as exc:
        logger.warning("Failed to reconcile stale processing invoices on startup: %s", exc)

    yield


app = FastAPI(
    title="Finance Flow AI API",
    description="Enterprise-grade invoice verification, extraction, and audit reconciliation platform.",
    version="2.1.0",
    lifespan=lifespan,
)

# Attach slowapi rate limiter state and error handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Ensure internal stack traces are never exposed to clients."""
    if isinstance(exc, HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=getattr(exc, "headers", None),
        )
    logger.error("Unhandled internal server error: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Please contact support."},
    )


# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.FRONTEND_ORIGINS,
    allow_origin_regex=settings.FRONTEND_PREVIEW_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str | None = None
    role: str | None = "reviewer"
    organization_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ReviewRequest(BaseModel):
    decision: str = Field(..., description="APPROVE or REJECT")
    notes: str = Field(..., min_length=1, description="Required note explaining human review decision")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _display_filename(filename: str | None) -> str:
    candidate = PurePosixPath((filename or "upload").replace("\\", "/")).name
    return candidate.replace("\x00", "") or "upload"


def _resolve_tenant_org(db: Session, user: User | None) -> int:
    """Resolve active organization id for current user or default tenant."""
    if user and user.organization_id is not None:
        return user.organization_id

    default_org = db.query(Organization).filter(Organization.name == "Default Organization").first()
    if not default_org:
        default_org = Organization(name="Default Organization")
        db.add(default_org)
        db.commit()
        db.refresh(default_org)
    return default_org.id


# ---------------------------------------------------------------------------
# Background Pipeline Execution
# ---------------------------------------------------------------------------

async def run_invoice_pipeline(invoice_id: int, db: Session | None = None) -> None:
    """Asynchronous background processing worker for an uploaded invoice."""
    should_close = False
    if db is None:
        db = SessionLocal()
        should_close = True
    try:
        inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
        if not inv or inv.status != "processing":
            return

        storage_key = inv.storage_key
        filename = inv.filename or "invoice"
        is_dup_initial = inv.is_duplicate

        # Close/commit read transaction so database is completely unlocked during OCR
        db.commit()

        t_start = time.time()
        logger.info("Invoice id=%d pipeline starting (file=%s)", invoice_id, filename)

        storage = get_storage_provider()
        content = storage.load(storage_key)
        file_type = detect_file_type(content, filename)
        logger.info("Invoice id=%d file loaded from storage in %.2fs", invoice_id, time.time() - t_start)

        ocr_result: dict[str, Any] = {}
        t_ocr = time.time()

        if file_type == "pdf":
            pdf_ocr = extract_text_from_pdf(content)
            if pdf_ocr and pdf_ocr.get("text"):
                ocr_result = pdf_ocr
            else:
                # Fallback to OCR on embedded page images in scanned PDF
                from pypdf import PdfReader

                all_lines: list[dict[str, Any]] = []
                all_confidences: list[float] = []
                try:
                    reader = PdfReader(io.BytesIO(content))
                    for page in reader.pages[:5]:  # limit to first 5 pages for memory safety
                        for img_obj in page.images:
                            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                                tmp.write(img_obj.data)
                                tmp_path = Path(tmp.name)
                            try:
                                page_ocr = await asyncio.to_thread(image_to_text, tmp_path)
                                all_lines.extend(page_ocr.get("lines", []))
                                if page_ocr.get("average_confidence"):
                                    all_confidences.append(page_ocr["average_confidence"])
                            finally:
                                tmp_path.unlink(missing_ok=True)
                except Exception as exc:
                    logger.warning("Scanned PDF image extraction error: %s", exc)

                if all_lines:
                    full_text = "\n".join(line["text"] for line in all_lines)
                    avg_conf = sum(all_confidences) / len(all_confidences) if all_confidences else 0.0
                    ocr_result = {
                        "lines": all_lines,
                        "text": full_text,
                        "average_confidence": avg_conf,
                        "line_count": len(all_lines),
                    }
                else:
                    ocr_result = {
                        "lines": [],
                        "text": "",
                        "average_confidence": 0.0,
                        "line_count": 0,
                    }
        else:
            with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix or ".png", delete=False) as tmp:
                tmp.write(content)
                tmp_path = Path(tmp.name)
            try:
                ocr_result = await asyncio.to_thread(image_to_text, tmp_path)
            finally:
                tmp_path.unlink(missing_ok=True)

        logger.info("Invoice id=%d OCR finished in %.2fs (lines=%d)", invoice_id, time.time() - t_ocr, len(ocr_result.get("lines", [])))

        t_val = time.time()
        fields = extract_invoice_fields(ocr_result)
        validation = validate_invoice(fields)
        logger.info("Invoice id=%d extraction & validation finished in %.2fs", invoice_id, time.time() - t_val)

        inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
        if not inv:
            return

        if is_dup_initial:
            inv.is_duplicate = True

        # Check vendor + invoice_number duplicates in the organization
        if fields.get("vendor") and fields.get("invoice_number"):
            dup_q = db.query(Invoice).filter(
                Invoice.organization_id == inv.organization_id,
                Invoice.vendor == fields["vendor"],
                Invoice.invoice_number == fields["invoice_number"],
                Invoice.id != inv.id,
            ).first()
            if dup_q:
                inv.is_duplicate = True
                validation["warnings"].append(
                    f"Duplicate invoice detected: vendor '{fields['vendor']}' already has invoice #{fields['invoice_number']} on record."
                )

        if inv.is_duplicate:
            validation["warnings"].append("Duplicate file: identical document was previously ingested.")

        decision = make_decision(validation, fields, ocr_result.get("average_confidence"))

        # Save extracted information
        inv.vendor = fields.get("vendor")
        inv.invoice_number = fields.get("invoice_number")
        inv.gstin = fields.get("gstin")
        inv.total = fields.get("total")
        inv.decision = decision.get("decision")
        inv.confidence = decision.get("confidence")
        inv.risk_level = decision.get("risk_level")
        inv.status = "completed"
        inv.error_reason = None
        inv.extracted_data = json.dumps(
            {
                "fields": fields,
                "validation": validation,
                "ocr": ocr_result,
                "decision": decision,
            }
        )

        audit_entry = AuditLog(
            invoice_id=inv.id,
            action="upload_processed",
            previous_state=None,
            new_state=inv.decision,
            notes=f"Automated extraction and rules evaluation completed with decision {inv.decision}.",
        )
        db.add(audit_entry)
        db.commit()
        logger.info("Invoice id=%d processed successfully with decision=%s", inv.id, inv.decision)

    except Exception as exc:
        logger.error("Invoice id=%d processing failed: %s", invoice_id, exc)
        db.rollback()
        inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
        if inv:
            inv.status = "failed"
            inv.error_reason = "Processing failed during OCR or field extraction."
            db.commit()
    finally:
        if should_close:
            db.close()


async def process_invoice_job(invoice_id: int) -> None:
    """Wrapper executing background pipeline with a hard 90-second timeout."""
    try:
        await asyncio.wait_for(run_invoice_pipeline(invoice_id), timeout=settings.OCR_TIMEOUT_SECONDS)
    except TimeoutError:
        logger.error("Processing timed out for invoice id=%d after %ds", invoice_id, settings.OCR_TIMEOUT_SECONDS)
        db = SessionLocal()
        try:
            inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
            if inv:
                inv.status = "failed"
                inv.error_reason = f"Processing timed out after {settings.OCR_TIMEOUT_SECONDS} seconds."
                db.commit()
        finally:
            db.close()
    except Exception as exc:
        logger.error("Fatal error executing background job for invoice id=%d: %s", invoice_id, exc)


# ---------------------------------------------------------------------------
# Health & Readiness Probes
# ---------------------------------------------------------------------------

@app.get("/api/health")
@app.get("/health")
def health():
    """Instant health probe (returns immediately without DB queries)."""
    return {"status": "ok"}


@app.get("/api/health/ready")
@app.get("/health/ready")
def health_ready(db: Session = Depends(get_db)):
    """Readiness probe checking database connectivity and OCR model availability."""
    db_ok = False
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:
        logger.error("Readiness probe DB check failed: %s", exc)

    ocr_ok = is_ocr_ready()

    if db_ok and ocr_ok:
        return {
            "status": "ready",
            "database": "connected",
            "ocr": "loaded",
            "storage": settings.STORAGE_BACKEND,
        }

    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "not_ready",
            "database": "connected" if db_ok else "unreachable",
            "ocr": "loaded" if ocr_ok else "unloaded",
        },
    )


# ---------------------------------------------------------------------------
# Auth Routes
# ---------------------------------------------------------------------------

@app.post("/api/auth/register")
@app.post("/auth/register")
def register_user(req: RegisterRequest, db: Session = Depends(get_db)):
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


@app.post("/api/auth/login")
@app.post("/auth/login")
@limiter.limit("10/minute")
def login_user(request: Request, req: LoginRequest, db: Session = Depends(get_db)):
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


@app.get("/api/auth/me")
@app.get("/auth/me")
def get_current_user_profile(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "organization_id": user.organization_id,
        "organization_name": user.organization.name if user.organization else None,
    }


# ---------------------------------------------------------------------------
# Invoice Routes (Async Ingestion + Polling + Management)
# ---------------------------------------------------------------------------

@app.post("/api/invoices", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("20/minute")
async def create_invoice_async(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Validate file, persist to storage, insert processing row, and return 202."""
    from .rate_limit import upload_rate_limiter

    upload_rate_limiter.check(request.client.host if request.client else "unknown")
    filename = _display_filename(file.filename)

    # Stream chunks and enforce MAX_UPLOAD_BYTES limit
    chunks: list[bytes] = []
    total_bytes = 0
    while chunk := await file.read(UPLOAD_CHUNK_SIZE):
        total_bytes += len(chunk)
        if total_bytes > settings.MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"Upload exceeds maximum allowed size of {settings.MAX_UPLOAD_BYTES} bytes.",
            )
        chunks.append(chunk)

    await file.close()
    content = b"".join(chunks)

    # Validate media type by magic-bytes
    detect_file_type(content, filename)

    # Compute SHA-256 for duplicate tracking
    sha256 = calculate_sha256(content)
    org_id = _resolve_tenant_org(db, user)

    # Duplicate check within tenant
    existing = (
        db.query(Invoice)
        .filter(Invoice.organization_id == org_id, Invoice.sha256 == sha256)
        .first()
    )
    if existing:
        return {
            "id": existing.id,
            "filename": filename,
            "status": existing.status,
            "is_duplicate": True,
            "message": "Duplicate invoice already ingested for this organization.",
        }

    # Persist file
    storage = get_storage_provider()
    storage_res = storage.save(
        filename=filename,
        content=content,
        content_type=file.content_type or "application/octet-stream",
    )

    # Create invoice row with processing status
    invoice = Invoice(
        organization_id=org_id,
        filename=filename,
        storage_key=storage_res.key,
        storage_type=storage_res.storage_type,
        is_ephemeral=storage_res.is_ephemeral,
        sha256=sha256,
        file_hash=sha256,
        is_duplicate=False,
        status="processing",
        created_at=datetime.now(UTC),
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    # Dispatch background worker
    background_tasks.add_task(process_invoice_job, invoice.id)
    logger.info("Accepted invoice upload id=%d filename=%s (size=%d bytes)", invoice.id, filename, total_bytes)

    return {
        "id": invoice.id,
        "filename": invoice.filename,
        "status": "processing",
        "message": "Invoice upload accepted for processing.",
    }


# Backwards compatibility alias for /upload
@app.post("/upload")
@limiter.limit("20/minute")
async def legacy_upload(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Synchronous legacy upload for backwards compatibility with test suites."""
    from .rate_limit import upload_rate_limiter

    upload_rate_limiter.check(request.client.host if request.client else "unknown")
    filename = _display_filename(file.filename)
    chunks = []
    total_bytes = 0
    while chunk := await file.read(UPLOAD_CHUNK_SIZE):
        total_bytes += len(chunk)
        if total_bytes > settings.MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"Upload exceeds maximum allowed size of {settings.MAX_UPLOAD_BYTES} bytes.",
            )
        chunks.append(chunk)
    await file.close()
    content = b"".join(chunks)

    detect_file_type(content, filename)
    sha256 = calculate_sha256(content)
    org_id = _resolve_tenant_org(db, user)

    existing = (
        db.query(Invoice)
        .filter(Invoice.organization_id == org_id, Invoice.sha256 == sha256)
        .first()
    )
    if existing:
        extracted = existing.get_extracted_data()
        validation = dict(extracted.get("validation", {}))
        warnings = list(validation.get("warnings", []))
        if not any("duplicate" in w.lower() for w in warnings):
            warnings.append(
                f"Duplicate file: identical document previously processed as invoice #{existing.id}."
            )
        validation["warnings"] = warnings
        return {
            "id": existing.id,
            "filename": filename,
            "status": "processed",
            "fields": extracted.get("fields", {}),
            "validation": validation,
            "decision": extracted.get("decision", {}),
            "ocr": extracted.get("ocr", {}),
            "is_duplicate": True,
            "file_hash": existing.file_hash,
            "storage_type": existing.storage_type,
            "is_ephemeral": existing.is_ephemeral,
        }

    storage = get_storage_provider()
    storage_res = storage.save(filename, content, file.content_type or "application/octet-stream")

    invoice = Invoice(
        organization_id=org_id,
        filename=filename,
        storage_key=storage_res.key,
        storage_type=storage_res.storage_type,
        is_ephemeral=storage_res.is_ephemeral,
        sha256=sha256,
        file_hash=sha256,
        is_duplicate=False,
        status="processing",
        created_at=datetime.now(UTC),
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    # Run pipeline synchronously for legacy /upload callers
    await run_invoice_pipeline(invoice.id, db=db)
    db.refresh(invoice)

    extracted = invoice.get_extracted_data()
    return {
        "id": invoice.id,
        "filename": invoice.filename,
        "status": "processed",
        "fields": extracted.get("fields", {}),
        "validation": extracted.get("validation", {}),
        "decision": extracted.get("decision", {}),
        "ocr": extracted.get("ocr", {}),
        "is_duplicate": invoice.is_duplicate,
        "file_hash": invoice.file_hash,
        "storage_type": invoice.storage_type,
        "is_ephemeral": invoice.is_ephemeral,
    }


@app.get("/api/invoices/{invoice_id}")
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Retrieve an invoice by ID, scoped strictly to the requesting organization."""
    query = db.query(Invoice).filter(Invoice.id == invoice_id)
    if user and user.organization_id is not None:
        query = query.filter(Invoice.organization_id == user.organization_id)

    invoice = query.first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found.")

    storage = get_storage_provider()
    file_url = None
    if invoice.storage_key:
        try:
            file_url = storage.generate_presigned_url(invoice.storage_key)
        except Exception:
            file_url = None

    extracted = invoice.get_extracted_data()
    return {
        "id": invoice.id,
        "filename": invoice.filename,
        "status": invoice.status,
        "error_reason": invoice.error_reason,
        "vendor": invoice.vendor,
        "invoice_number": invoice.invoice_number,
        "gstin": invoice.gstin,
        "total": invoice.total,
        "decision": invoice.decision,
        "confidence": invoice.confidence,
        "risk_level": invoice.risk_level,
        "is_duplicate": invoice.is_duplicate,
        "fields": extracted.get("fields", {}),
        "validation": extracted.get("validation", {}),
        "ocr": extracted.get("ocr", {}),
        "file_url": file_url,
        "reviewed_by": invoice.reviewed_by,
        "reviewed_at": invoice.reviewed_at.isoformat() if invoice.reviewed_at else None,
        "review_notes": invoice.review_notes,
        "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
    }


@app.get("/api/invoices")
@app.get("/invoices")
def list_invoices(
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
    decision: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    vendor: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    is_duplicate: bool | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List invoices scoped to the current user's organization."""
    query = db.query(Invoice)
    if user and user.organization_id is not None:
        query = query.filter(Invoice.organization_id == user.organization_id)

    if status_filter:
        query = query.filter(Invoice.status == status_filter)

    if decision:
        query = query.filter(func.upper(Invoice.decision) == decision.upper())

    if vendor:
        query = query.filter(Invoice.vendor.ilike(f"%{vendor}%"))

    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
            query = query.filter(Invoice.created_at >= start_dt)
        except Exception:
            pass

    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
            query = query.filter(Invoice.created_at <= end_dt)
        except Exception:
            pass

    if is_duplicate is not None:
        query = query.filter(Invoice.is_duplicate == is_duplicate)

    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            (Invoice.vendor.ilike(search_filter))
            | (Invoice.invoice_number.ilike(search_filter))
            | (Invoice.filename.ilike(search_filter))
        )

    total_count = query.count()
    rows = (
        query.order_by(Invoice.created_at.desc(), Invoice.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = [
        {
            "id": row.id,
            "filename": row.filename,
            "status": row.status,
            "error_reason": row.error_reason,
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

    if request.url.path == "/invoices":
        return items

    return {
        "items": items,
        "total": total_count,
        "page": page,
        "page_size": page_size,
    }


@app.post("/api/invoices/{invoice_id}/review")
@app.post("/invoices/{invoice_id}/review")
def review_invoice(
    invoice_id: int,
    req: ReviewRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Human review decision on an invoice (approving or rejecting with required reason note)."""
    query = db.query(Invoice).filter(Invoice.id == invoice_id)
    if user and user.organization_id is not None:
        query = query.filter(Invoice.organization_id == user.organization_id)

    invoice = query.first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found.")

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
    invoice.reviewed_at = datetime.now(UTC)
    invoice.review_notes = req.notes

    audit_entry = AuditLog(
        invoice_id=invoice.id,
        user_id=user.id if user else None,
        action="human_review",
        previous_state=old_decision,
        new_state=new_decision,
        notes=req.notes,
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


@app.get("/api/invoices/{invoice_id}/audit")
@app.get("/invoices/{invoice_id}/audit")
def get_invoice_audit_trail(
    invoice_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Fetch immutable audit log trail for an invoice scoped by organization."""
    query = db.query(Invoice).filter(Invoice.id == invoice_id)
    if user and user.organization_id is not None:
        query = query.filter(Invoice.organization_id == user.organization_id)

    invoice = query.first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found.")

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


@app.get("/api/invoices/file/{key}")
def get_invoice_file_local(key: str):
    """Serve uploaded file locally for development environments."""
    storage = get_storage_provider()
    try:
        content = storage.load(key)
        media_type = "application/pdf" if key.endswith(".pdf") else "image/png"
        return Response(content=content, media_type=media_type)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found.")


@app.get("/api/stats")
@app.get("/stats")
def invoice_stats(
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    base_q = db.query(Invoice)
    if user and user.organization_id is not None:
        base_q = base_q.filter(Invoice.organization_id == user.organization_id)

    total = base_q.count()

    def _count(matcher) -> int:
        return base_q.filter(matcher(Invoice.decision)).count()

    approved = _count(lambda d: func.upper(d) == "APPROVE")
    rejected = _count(lambda d: func.upper(d) == "REJECT")
    pending = _count(lambda d: func.upper(d).in_(["PENDING REVIEW", "PENDING"]))

    return {
        "total": int(total),
        "approved": int(approved),
        "rejected": int(rejected),
        "pending": int(pending),
    }


@app.get("/api/insights")
@app.get("/insights")
def invoice_insights(
    days: int | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    base_q = db.query(Invoice)
    if user and user.organization_id is not None:
        base_q = base_q.filter(Invoice.organization_id == user.organization_id)

    if days and days > 0:
        cutoff = datetime.now(UTC) - timedelta(days=days)
        base_q = base_q.filter(Invoice.created_at >= cutoff)

    total = base_q.count()
    if total == 0:
        return {
            "top_vendor": "No data",
            "approval_rate": 0.0,
            "high_value_count": 0,
            "accuracy": 0.0,
        }

    top_vendor_row = (
        base_q.filter(Invoice.vendor.isnot(None))
        .with_entities(Invoice.vendor, func.count(Invoice.id))
        .group_by(Invoice.vendor)
        .order_by(func.count(Invoice.id).desc())
        .first()
    )
    top_vendor = top_vendor_row[0] if top_vendor_row else "Unknown"

    approved_count = base_q.filter(func.upper(Invoice.decision) == "APPROVE").count()
    approval_rate = (approved_count / total) * 100

    high_value_count = base_q.filter(
        func.upper(Invoice.decision) == "APPROVE",
        Invoice.total >= 200_000,
    ).count()

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
