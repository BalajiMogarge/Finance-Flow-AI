# Finance Flow AI — API Reference (v2.0.0)

The Finance Flow AI backend is built with **FastAPI**. All operational endpoints are exposed with deterministic rules, RBAC security, rate-limiting, and comprehensive audit tracking.

---

## Base Conventions

* **Default Local Port:** `http://127.0.0.1:8000`
* **Default Production:** `https://finance-flow-ai-backend.onrender.com`
* **Content Type:** `application/json` (except `POST /upload` which accepts `multipart/form-data`)
* **Authentication:** Bearer token via `Authorization: Bearer <JWT>` header (optional for unauthenticated demo mode, mandatory for organization-scoped operations).
* **Rate Limits:**
  * General API: 120 requests/minute per client IP.
  * File Upload: 30 requests/minute per client IP.
  * HTTP status on violation: `429 Too Many Requests` with `Retry-After` header.

---

## Authentication Endpoints

### `POST /auth/register`
Create a new user and associate with an existing or new organization.

* **Request Body:**
```json
{
  "email": "auditor@company.com",
  "password": "StrongPassword123!",
  "full_name": "Jane Auditor",
  "role": "reviewer",
  "organization_name": "Acme Global"
}
```
* **Response `200 OK`:**
```json
{
  "id": 1,
  "email": "auditor@company.com",
  "full_name": "Jane Auditor",
  "role": "reviewer",
  "organization_id": 1
}
```
* **Errors:**
  * `400 Bad Request`: Email already registered.

---

### `POST /auth/login`
Authenticate and obtain a signed PyJWT bearer token. Supports both JSON body and OAuth2 form data.

* **Request Body (JSON):**
```json
{
  "email": "auditor@company.com",
  "password": "StrongPassword123!"
}
```
* **Response `200 OK`:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsIn...",
  "token_type": "bearer",
  "expires_in": 86400
}
```
* **Errors:**
  * `401 Unauthorized`: Invalid credentials.

---

### `GET /auth/me`
Retrieve the current authenticated user's profile and organization.

* **Headers:** `Authorization: Bearer <token>`
* **Response `200 OK`:**
```json
{
  "id": 1,
  "email": "auditor@company.com",
  "full_name": "Jane Auditor",
  "role": "reviewer",
  "organization_id": 1,
  "organization_name": "Acme Global"
}
```

---

## Invoice Operations

### `POST /upload`
Upload an invoice image or digital PDF. Executes magic-byte validation, duplicate hashing, OCR / digital extraction, validation rules, and deterministic decision engine.

* **Headers:** `Content-Type: multipart/form-data`
* **Form Field:** `file` (binary payload)
* **Supported Formats:**
  * Digital PDF (`.pdf`, signature `%PDF-`) — extracted directly via `pypdf` bypassing OCR.
  * Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tiff`) — processed via PyTorch/EasyOCR with memory downscaling.
* **Size Limit:** Max 10 MB (`MAX_UPLOAD_BYTES`).
* **Response `200 OK`:**
```json
{
  "id": 42,
  "filename": "invoice_1024.pdf",
  "saved_to": "uploads/a1b2c3d4.pdf",
  "storage_type": "local",
  "is_ephemeral": true,
  "file_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "is_duplicate": false,
  "status": "processed",
  "ocr": {
    "lines": [
      { "text": "Invoice #INV-2026-001", "confidence": 0.98 },
      { "text": "Total: ₹45,000.00", "confidence": 0.96 }
    ],
    "text": "Invoice #INV-2026-001\nTotal: ₹45,000.00",
    "average_confidence": 0.97,
    "line_count": 2
  },
  "fields": {
    "invoice_number": "INV-2026-001",
    "vendor": "Acme Logistics",
    "date": "2026-09-15",
    "gstin": "27AABCU9603R1ZM",
    "subtotal": 38135.59,
    "cgst": 3432.20,
    "sgst": 3432.20,
    "total": 45000.00
  },
  "validation": {
    "passed": true,
    "errors": [],
    "warnings": []
  },
  "decision": {
    "decision": "APPROVE",
    "confidence": 0.97,
    "reason": "Invoice passed all validation checks with high OCR confidence.",
    "risk_level": "LOW"
  }
}
```
* **Error Responses:**
  * `413 Content Too Large`: File exceeds 10 MB limit.
  * `415 Unsupported Media Type`: File magic bytes do not match valid image or PDF signatures.
  * `429 Too Many Requests`: Upload rate limit exceeded (30 req/min).

---

### `GET /invoices`
List stored invoices, sorted newest-first, with filtering and pagination.

* **Query Parameters:**
  * `decision`: Filter by decision outcome (`APPROVE`, `REJECT`, `PENDING REVIEW`).
  * `search`: Case-insensitive substring match against `invoice_number`, `vendor`, or `filename`.
  * `is_duplicate`: Boolean (`true` or `false`) to filter duplicate flags.
  * `page`: Page index (default: `1`, 1-indexed).
  * `page_size`: Number of records per page (default: `50`, max: `100`).
* **Response `200 OK`:** Array of invoice summaries:
```json
[
  {
    "id": 42,
    "filename": "invoice_1024.pdf",
    "vendor": "Acme Logistics",
    "invoice_number": "INV-2026-001",
    "gstin": "27AABCU9603R1ZM",
    "total": 45000.0,
    "decision": "APPROVE",
    "confidence": 0.97,
    "risk_level": "LOW",
    "is_duplicate": false,
    "storage_type": "local",
    "is_ephemeral": true,
    "created_at": "2026-10-06T00:30:00Z",
    "reviewed_by": null,
    "reviewed_at": null,
    "review_notes": null
  }
]
```

---

### `POST /invoices/{id}/review`
Submit a human review for an invoice in the `PENDING REVIEW` queue. Creates an immutable entry in the audit trail.

* **Headers:** `Authorization: Bearer <token>` (Recommended)
* **Request Body:**
```json
{
  "decision": "APPROVE",
  "notes": "Verified GST portal registration manually. Supplier cleared."
}
```
* **Response `200 OK`:**
```json
{
  "id": 42,
  "decision": "APPROVE",
  "risk_level": "LOW",
  "reviewed_by": "auditor@company.com",
  "reviewed_at": "2026-10-06T00:35:00Z",
  "review_notes": "Verified GST portal registration manually. Supplier cleared."
}
```
* **Errors:**
  * `400 Bad Request`: Decision must be either `APPROVE` or `REJECT`.
  * `404 Not Found`: Invoice not found.

---

### `GET /invoices/{id}/audit`
Fetch the chronological, tamper-evident audit history of an invoice.

* **Response `200 OK`:**
```json
[
  {
    "id": 101,
    "action": "UPLOAD_PROCESSED",
    "performed_by": "system",
    "previous_state": null,
    "new_state": "PENDING REVIEW",
    "notes": "Automated OCR extraction completed. Reason: Missing optional invoice date.",
    "created_at": "2026-10-06T00:30:00Z"
  },
  {
    "id": 102,
    "action": "HUMAN_REVIEW",
    "performed_by": "auditor@company.com",
    "previous_state": "PENDING REVIEW",
    "new_state": "APPROVE",
    "notes": "Verified GST portal registration manually. Supplier cleared.",
    "created_at": "2026-10-06T00:35:00Z"
  }
]
```

---

## Analytics & Health

### `GET /stats`
Return all-time counts for key metrics.

* **Response `200 OK`:**
```json
{
  "total": 128,
  "approved": 98,
  "rejected": 14,
  "pending": 16
}
```

---

### `GET /insights`
Return AI spend intelligence, top vendors, and accuracy metrics. Supports optional time-window filtering.

* **Query Parameters:**
  * `days`: Optional positive integer (e.g., `?days=30` to filter the last 30 days).
* **Response `200 OK`:**
```json
{
  "top_vendor": "Acme Logistics",
  "approval_rate": 76.6,
  "high_value_count": 8,
  "accuracy": 87.5
}
```

---

### `GET /health`
Liveness and readiness probe for container orchestrators and monitoring.

* **Response `200 OK`:**
```json
{
  "status": "healthy",
  "database": "connected",
  "storage": "local"
}
```
