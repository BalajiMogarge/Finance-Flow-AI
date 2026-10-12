# Finance Flow AI — API Reference

The Finance Flow AI backend is powered by FastAPI, exposing REST endpoints with JSON payloads, multipart uploads, JWT Bearer authentication, and rate limiting.

- **Base URL (Local)**: `http://localhost:8000`
- **Base URL (Production)**: `https://<your-service>.onrender.com`
- **Interactive OpenAPI Documentation**: `GET /docs` (Swagger UI) or `GET /redoc` (ReDoc)

---

## 1. Authentication & Security

All protected endpoints accept a standard Bearer Token header:
```http
Authorization: Bearer <access_token>
```

Rate limiting is enforced per client IP via `slowapi`:
- Authentication endpoints: 10 requests / minute
- Invoice ingestion endpoints: 20 requests / minute

When rate limits are exceeded, the API returns HTTP 429:
```json
{
  "error": "Rate limit exceeded: 10 per 1 minute"
}
```

---

## 2. Health & Readiness Probes

### GET `/health`
Instant lightweight liveness check (does not query the database or load models).

**Response (200 OK):**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2026-10-12T18:00:00.000000Z"
}
```

### GET `/health/ready`
Deep readiness probe verifying that Neon PostgreSQL is reachable and the OCR model engine is loaded into memory.

**Response (200 OK):**
```json
{
  "status": "ready",
  "database": "connected",
  "ocr_model": "loaded"
}
```

**Response (503 Service Unavailable):**
```json
{
  "status": "unhealthy",
  "detail": "Database connection failed"
}
```

---

## 3. Authentication Endpoints

### POST `/auth/register`
Register a new user and tenant organization.

**Request Body (`application/json`):**
```json
{
  "email": "finance@company.com",
  "password": "StrongPassword123!",
  "full_name": "Jane Doe",
  "role": "reviewer",
  "organization_name": "Acme Corp"
}
```

**Response (201 Created):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsIn...",
  "token_type": "bearer"
}
```

### POST `/auth/login`
Authenticate using email and password. Supports both JSON and OAuth2 `application/x-www-form-urlencoded` payloads.

**Request Body (`application/json`):**
```json
{
  "email": "finance@company.com",
  "password": "StrongPassword123!"
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsIn...",
  "token_type": "bearer"
}
```

### GET `/auth/me`
Retrieve user profile and organization membership for the currently authenticated user.

**Headers:**
```http
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "id": 1,
  "email": "finance@company.com",
  "full_name": "Jane Doe",
  "role": "reviewer",
  "organization_id": 1,
  "organization_name": "Acme Corp"
}
```

---

## 4. Ingestion & Invoice Processing

### POST `/api/invoices`
Asynchronous invoice upload endpoint. Validates file header magic bytes, checks for duplicates, stores the binary in private S3 storage, creates an invoice record with status `processing`, and queues background processing.

- **Content-Type**: `multipart/form-data`
- **Max File Size**: 10 MB
- **Supported Formats**: PDF, PNG, JPG, JPEG, WEBP, BMP, TIFF

**Form Data:**
- `file`: Binary file upload

**Response (202 Accepted — New File Queued):**
```json
{
  "id": 42,
  "filename": "INV-2026-001.pdf",
  "status": "processing",
  "message": "Invoice uploaded and queued for processing"
}
```

**Response (200 OK — Duplicate File Detected):**
```json
{
  "id": 12,
  "filename": "INV-2026-001.pdf",
  "status": "completed",
  "is_duplicate": true,
  "message": "Duplicate invoice detected. Returning existing record."
}
```

### GET `/api/invoices/{id}`
Retrieve invoice status, extracted data, deterministic validation rules, decision, and presigned file URL.

**Query Parameters:**
None.

**Response (200 OK):**
```json
{
  "id": 42,
  "filename": "INV-2026-001.pdf",
  "status": "completed",
  "error_reason": null,
  "vendor": "Acme Industrial Supplies Pvt Ltd",
  "invoice_number": "INV-2026-001",
  "gstin": "27AABCU9603R1ZM",
  "total": 147500.00,
  "decision": "APPROVE",
  "confidence": 0.94,
  "risk_level": "LOW",
  "is_duplicate": false,
  "storage_type": "s3",
  "is_ephemeral": false,
  "file_url": "https://<supabase-endpoint>/object/sign/invoices/...",
  "fields": {
    "vendor": "Acme Industrial Supplies Pvt Ltd",
    "invoice_number": "INV-2026-001",
    "gstin": "27AABCU9603R1ZM",
    "date": "2026-03-15",
    "subtotal": 125000.00,
    "cgst": 11250.00,
    "sgst": 11250.00,
    "total": 147500.00
  },
  "validation": {
    "passed": true,
    "errors": [],
    "warnings": []
  },
  "ocr": {
    "engine": "pypdf_fastpath",
    "confidence": 0.94,
    "text_length": 842
  },
  "reviewed_by": null,
  "reviewed_at": null,
  "review_notes": null,
  "created_at": "2026-10-12T18:00:00.000000Z"
}
```

---

## 5. Invoice Queries & Pagination

### GET `/api/invoices`
List invoices scoped strictly to the authenticated tenant. Supports server-side pagination, status filters, decision filters, vendor search, and date range filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number (1-indexed) |
| `page_size` | integer | `20` | Items per page (min: 1, max: 100) |
| `status` | string | `null` | Filter by ingestion status: `processing`, `completed`, `failed` |
| `decision` | string | `null` | Filter by decision: `APPROVE`, `REJECT`, `PENDING REVIEW` |
| `vendor` | string | `null` | Substring match against vendor name |
| `search` | string | `null` | Substring match across vendor, invoice number, and filename |
| `start_date`| string | `null` | ISO 8601 date string (e.g. `2026-01-01`) |
| `end_date` | string | `null` | ISO 8601 date string (e.g. `2026-12-31`) |
| `is_duplicate`| boolean | `null` | Filter duplicate documents |

**Response (200 OK):**
```json
{
  "items": [
    {
      "id": 42,
      "filename": "INV-2026-001.pdf",
      "status": "completed",
      "error_reason": null,
      "vendor": "Acme Industrial Supplies Pvt Ltd",
      "invoice_number": "INV-2026-001",
      "gstin": "27AABCU9603R1ZM",
      "total": 147500.00,
      "decision": "APPROVE",
      "confidence": 0.94,
      "risk_level": "LOW",
      "is_duplicate": false,
      "storage_type": "s3",
      "is_ephemeral": false,
      "reviewed_by": null,
      "reviewed_at": null,
      "review_notes": null,
      "created_at": "2026-10-12T18:00:00.000000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 20
}
```

---

## 6. Human Review & Audit Logging

### POST `/api/invoices/{id}/review`
Submit a human review decision on an invoice (e.g., approving or rejecting an invoice in `PENDING REVIEW`). A non-empty justification note is strictly mandatory and recorded in the immutable audit log.

**Request Body (`application/json`):**
```json
{
  "decision": "APPROVE",
  "notes": "Verified against Purchase Order PO-9842; bank account confirmed."
}
```

**Response (200 OK):**
```json
{
  "id": 42,
  "vendor": "Acme Industrial Supplies Pvt Ltd",
  "invoice_number": "INV-2026-001",
  "decision": "APPROVE",
  "risk_level": "LOW",
  "reviewed_at": "2026-10-12T18:15:00.000000Z",
  "review_notes": "Verified against Purchase Order PO-9842; bank account confirmed."
}
```

### GET `/api/invoices/{id}/audit`
Fetch the complete chronological audit trail of all actions performed on an invoice.

**Response (200 OK):**
```json
[
  {
    "id": 101,
    "action": "invoice_created",
    "previous_state": null,
    "new_state": "PENDING REVIEW",
    "notes": "Automated ingestion pipeline completed. Confidence: 0.81",
    "user_id": null,
    "created_at": "2026-10-12T18:00:00.000000Z"
  },
  {
    "id": 102,
    "action": "human_review",
    "previous_state": "PENDING REVIEW",
    "new_state": "APPROVE",
    "notes": "Verified against Purchase Order PO-9842; bank account confirmed.",
    "user_id": 1,
    "created_at": "2026-10-12T18:15:00.000000Z"
  }
]
```

---

## 7. Metrics & Analytics

### GET `/stats`
Aggregated counts of total, approved, rejected, and pending invoices.

**Response (200 OK):**
```json
{
  "total": 128,
  "approved": 94,
  "rejected": 12,
  "pending": 22
}
```

### GET `/insights`
Calculates 30-day invoice verification insights including top vendor, approval rates, high-value counts, and model accuracy.

**Query Parameters:**
- `days` (integer, optional, default: 30)

**Response (200 OK):**
```json
{
  "top_vendor": "Tata Consultancy Services",
  "approval_rate": 78.5,
  "high_value_count": 14,
  "accuracy": 99.2
}
```
