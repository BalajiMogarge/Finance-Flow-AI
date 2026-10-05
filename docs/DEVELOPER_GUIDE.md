# Developer Guide (v2.0.0)

A practical onboarding document for developers working on Finance Flow AI. After reading this you should be able to set up the local repository, run both applications, execute the complete test suite, and understand how the end-to-end processing pipeline functions.

---

## 1. Prerequisites

| Tool | Version | Notes |
| :--- | :--- | :--- |
| **Python** | 3.10 – 3.12 | Recommended Python 3.11/3.12. |
| **Node.js** | 18.18+ / 20 LTS | Required by Next.js 15. |
| **npm** | 9+ | Uses package-lock.json in `frontend/`. |
| **Git** | Any recent | |

---

## 2. Local Setup

### 2.1 Backend Setup

```bash
cd backend
python -m venv .venv

# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Run database migrations
alembic upgrade head
```

### 2.2 Frontend Setup

```bash
cd ../frontend
npm install
```

---

## 3. Running Locally

### 3.1 Backend (FastAPI / Uvicorn)

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

* Liveness probe: `GET http://127.0.0.1:8000/health`
* Swagger UI: `http://127.0.0.1:8000/docs`
* Upload endpoint: `POST http://127.0.0.1:8000/upload`

### 3.2 Frontend (Next.js 15)

```bash
cd frontend
npm run dev
```

* Dev UI: `http://localhost:3000`
* Connects to backend configured in `.env.local` (`NEXT_PUBLIC_API_URL=http://localhost:8000`).

---

## 4. Running the Tests

The backend test suite includes 32 tests across 5 test modules covering unit logic, persistence, extraction, security, and production features:

```bash
# From repository root or backend/
pytest -v
```

### Test Suite Structure

| Test File | Focus & Coverage |
| :--- | :--- |
| `backend/tests/test_decision.py` | Deterministic decision rules (`APPROVE`, `REJECT`, `PENDING REVIEW`), GSTIN checksum verification, response schema consistency. |
| `backend/tests/test_extractor.py` | Regex field extraction, European & Indian numerical normalization, calendar date validation. |
| `backend/tests/test_persistence.py` | SQLite/Postgres persistence, sorted invoices retrieval, statistics counting. |
| `backend/tests/test_security_and_upload.py` | PBKDF2 password hashing, user registration, JWT generation, magic-byte checking, duplicate file hashing, human-review workflow, and audit trail logs. |
| `backend/tests/test_production_features.py` | AI insights computation with time filtering (`days`), invoice search and pagination, 413 size guards, 415 media errors, and sliding-window rate limiters. |

---

## 5. Pipeline Stages & Modules

### 5.1 Ingestion & File Sniffing (`app/file_utils.py`)
* Sniffs binary magic bytes (`%PDF-`, `\x89PNG`, `\xff\xd8\xff`, `RIFF`, `II*`, `MM*`).
* Rejects mismatched extensions or unapproved binaries with `415 Unsupported Media Type`.
* Computes SHA-256 hash of the content to detect exact file duplicates within the organization.

### 5.2 Text Extraction (`app/ocr.py` & `app/file_utils.py`)
* **Digital PDF:** If `%PDF-` header is detected, text is extracted via `pypdf` in memory with zero OCR overhead.
* **Raster Images:** Processed via PyTorch/EasyOCR under an `asyncio.Semaphore(1)` gate. Oversized images are downscaled to 1600px, run under `torch.no_grad()`, and collected with `gc.collect()`.

### 5.3 Field Extraction (`app/extractor.py`)
* Extracts Invoice Number, Vendor, GSTIN, Date, Subtotal, CGST, SGST, and Total using robust regular expressions and Indian number grouping parsers.

### 5.4 Validation & Business Rules (`app/validator.py`)
* Calculates GSTIN mod-36 checksum.
* Confirms arithmetic equality: $\text{Subtotal} + \text{CGST} + \text{SGST} = \text{Total} \pm 0.05$.

### 5.5 Deterministic Decision Engine (`app/decision.py`)
* **`APPROVE`:** Zero errors/warnings and confidence $\ge 0.85$.
* **`REJECT`:** GSTIN error, invoice number missing, math discrepancy, or confidence $< 0.40$.
* **`PENDING REVIEW`:** Mid-confidence, company policy warnings, or missing optional fields.

### 5.6 Storage & Persistence (`app/storage.py`, `app/database.py`, `app/models.py`)
* Manages persistence across SQLite/PostgreSQL with connection pooling and pre-ping.
* Abstract storage provider tracks `is_ephemeral` status to accurately disclose ephemeral local filesystems.
