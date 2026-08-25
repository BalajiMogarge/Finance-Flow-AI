# API Reference

The Finance Flow AI backend exposes a small REST API implemented in
**FastAPI**. All routes are defined in `backend/app/main.py`. The
service binds to `http://0.0.0.0:8000` by default and CORS is
configured to accept the Next.js dev server on `localhost:3000`,
`localhost:3001`, `127.0.0.1:3000`, and `127.0.0.1:3001`.

> **Scope note.** Only `/health` and `/upload` are implemented in
> `main.py`. The `/invoices` and `/stats` endpoints documented below
> are *not yet present* — they are listed for forward compatibility.

---

## Conventions

* **Base URL (local dev):** `http://127.0.0.1:8000`
* **Content type:** `application/json` unless noted.
* **Errors:** FastAPI's default error envelope is used
  (`{"detail": "..."}`). The backend does not currently expose a
  custom error schema.
* **CORS:** allowed origins are listed in
  [ARCHITECTURE.md](./ARCHITECTURE.md#technology-stack).

---

## Endpoints

### `GET /health`

| Aspect      | Value                                                      |
| ----------- | ---------------------------------------------------------- |
| Method      | `GET`                                                      |
| URL         | `/health`                                                  |
| Purpose     | Liveness probe. Returns a static `{"status": "healthy"}`. |

#### Request body

None.

#### Example request

```http
GET /health HTTP/1.1
Host: 127.0.0.1:8000
```

#### Example response — `200 OK`

```json
{
  "status": "healthy"
}
```

#### Error responses

None. This endpoint does not raise under normal operation.

---

### `POST /upload`

| Aspect      | Value                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| Method      | `POST`                                                                      |
| URL         | `/upload`                                                                   |
| Purpose     | Accept an invoice file, run OCR + extraction + validation + decision, and return the result. |
| Consumes    | `multipart/form-data` (`file` field)                                       |
| Produces    | `application/json`                                                          |

#### Request body

A single multipart field named `file` containing the invoice. Files
with image extensions recognised by EasyOCR
(`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tif`, `.tiff`) are
processed end-to-end. Any other extension is still accepted but is
returned with `status: "uploaded"` and no OCR data.

> The frontend currently advertises support for
> `["pdf", "png", "jpg", "jpeg", "webp"]` in
> `UploadCard.tsx`. PDF is not yet implemented server-side — PDF
> uploads will land in this branch with `status: "uploaded"`.

#### Response body — image upload

`200 OK`

```json
{
  "filename": "invoice-001.png",
  "saved_to": "uploads/invoice-001.png",
  "status": "processed",
  "ocr": {
    "lines": [
      { "text": "Invoice #INV-10248", "confidence": 0.96 },
      { "text": "Total: 1180.00",    "confidence": 0.91 }
    ],
    "text": "Invoice #INV-10248\nTotal: 1180.00",
    "average_confidence": 0.935,
    "line_count": 2
  },
  "fields": {
    "invoice_number": "INV-10248",
    "vendor": "ACME Pvt Ltd",
    "date": "2026-08-20",
    "gstin": "22AAAAA0000A1Z0",
    "subtotal": 1000.0,
    "cgst": 90.0,
    "sgst": 90.0,
    "total": 1180.0
  },
  "validation": {
    "passed": true,
    "errors": [],
    "warnings": []
  },
  "decision": {
    "decision": "APPROVE",
    "confidence": 0.935,
    "reason": "Invoice passed all validation checks with high OCR confidence.",
    "risk_level": "LOW"
  }
}
```

#### Response body — non-image upload (e.g. PDF)

`200 OK`

```json
{
  "filename": "invoice-001.pdf",
  "saved_to": "uploads/invoice-001.pdf",
  "status": "uploaded"
}
```

#### `decision` field reference

| Value             | Risk level | Meaning                                                                  |
| ----------------- | ---------- | ------------------------------------------------------------------------ |
| `APPROVE`         | `LOW`      | Validation passed, no warnings, OCR confidence ≥ 0.85.                   |
| `REJECT`          | `HIGH`     | Invalid GSTIN, missing invoice number, amount inconsistency, or OCR confidence < 0.40. |
| `PENDING REVIEW`  | `MEDIUM`   | Policy warning, mid-range confidence, or missing optional fields.        |

#### Example request — cURL

```bash
curl -X POST http://127.0.0.1:8000/upload \
  -F "file=@./sample_invoice.png"
```

#### Example request — JavaScript (browser)

```js
const form = new FormData();
form.append("file", file);

const res = await fetch("http://127.0.0.1:8000/upload", {
  method: "POST",
  body: form,
});
const json = await res.json();
```

#### Error responses

| Status | When                                                                | Body shape                  |
| ------ | ------------------------------------------------------------------- | --------------------------- |
| `500`  | EasyOCR fails to read the file (e.g. corrupt image, missing model). | `{"detail": "OCR failed for <name>: <reason>"}` |

There is no documented 4xx response path; missing-file requests are
rejected by FastAPI's standard `422 Unprocessable Entity` validation
with a body like `{"detail": [{"loc": [...], "msg": "...", "type": "..."}]}`.

---

### `GET /invoices` *(planned — not yet implemented)*

| Aspect      | Value                                                          |
| ----------- | -------------------------------------------------------------- |
| Method      | `GET`                                                          |
| URL         | `/invoices`                                                    |
| Purpose     | List previously processed invoices.                            |
| Status      | **Not implemented** in the current `main.py`. The frontend's `Navbar` links to `/invoices` but no route exists yet. |

Once the database is added this endpoint will return rows persisted
from previous `POST /upload` calls.

---

### `GET /stats` *(planned — not yet implemented)*

| Aspect      | Value                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| Method      | `GET`                                                                       |
| URL         | `/stats`                                                                    |
| Purpose     | Aggregate metrics for the dashboard's `StatsCards` component.               |
| Status      | **Not implemented** — the dashboard currently renders hard-coded numbers from `src/lib/dummy-data.ts`. |

The intended response will mirror the `Stat` type in
`src/lib/dummy-data.ts` (`label`, `value`, `delta`, `trend`,
`iconName`).

---

## Quick smoke test

```bash
# 1. Health check
curl http://127.0.0.1:8000/health

# 2. Upload a sample invoice (provided in the repo)
curl -X POST http://127.0.0.1:8000/upload -F "file=@backend/sample_invoice.png"
```
