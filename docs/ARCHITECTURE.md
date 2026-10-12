# Finance Flow AI — System Architecture

Finance Flow AI is an enterprise-grade automated invoice processing, deterministic validation, and human-in-the-loop reconciliation platform.

---

## 1. High-Level Target Architecture

```mermaid
flowchart TD
    Client["Client Browser\n(Next.js 15 App Router)"]
    Vercel["Frontend Host\n(Vercel Edge / Serverless)"]
    RenderService["Backend Host\n(Render Docker Web Service, Port $PORT / 8000)"]
    FastAPI["FastAPI Application\n(Async Uvicorn, Non-root UID 1000)"]
    DBPool["Neon PgBouncer Pooler\n(DATABASE_URL, sslmode=require)"]
    DBDirect["Neon Direct Compute\n(DATABASE_URL_DIRECT, Alembic Only)"]
    NeonDB[("Neon PostgreSQL Database\n(Indexes, Migrations, Audits)")]
    S3Storage[("Private S3 Bucket\n(Neon Object Storage / Supabase S3)")]

    Client -->|HTTPS / Next.js Pages| Vercel
    Client -->|REST API with JWT & CORS| RenderService
    RenderService --> FastAPI
    FastAPI -->|Connection Pool & Retries| DBPool
    FastAPI -.->|Startup Migrations| DBDirect
    DBPool --> NeonDB
    DBDirect --> NeonDB
    FastAPI -->|Boto3 Presigned URLs| S3Storage
    Client -.->|Direct 15m Presigned Download| S3Storage
```

---

## 2. Core Architectural Pillars

### A. Deterministic Rule Engine (Zero LLM in Approval Path)
Financial reconciliation requires 100% auditable, repeatable outcomes. To eliminate hallucination risks, latency spikes, and regulatory non-compliance:
- **Zero LLM dependency**: LLMs are completely excluded from validation calculations, checksums, and financial approvals.
- **Indian GSTIN Verification**: Validates 15-character alphanumeric format, state code boundaries (01–38, 97, 99), and executes the ISO/IEC 7064 (Luhn mod 36) checksum algorithm.
- **Arithmetic Consistency**: Verifies that `Subtotal + Taxes == Total` within a tight tolerance boundary of $\le \text{INR } 1.00$ to accommodate rounding.
- **Deterministic Decision Thresholds**:
  - `Confidence < 0.40` $\rightarrow$ `REJECT`
  - `0.40 <= Confidence < 0.85` $\rightarrow$ `PENDING REVIEW`
  - `Confidence >= 0.85` AND `Total < INR 200,000` $\rightarrow$ `APPROVE`
  - `Total >= INR 200,000` $\rightarrow$ `PENDING REVIEW` (Strict enterprise segregation of duties).

### B. High-Performance Text Extraction & Render 512 MB Optimization
- **Digital PDF Fast-Path (`pypdf`)**: Native digital invoices containing embedded text layers bypass optical recognition, finishing extraction in under 150 ms with negligible RAM overhead.
- **Lightweight Fallback (`RapidOCR`)**: Scanned PDFs and image uploads (PNG, JPEG, TIFF, WEBP, BMP) are processed using RapidOCR powered by ONNX Runtime CPU.
- **Elimination of Heavy Frameworks**: Tesseract, PyTorch, and EasyOCR were completely removed, replacing 700+ MB dependencies with ~14 MB quantized ONNX models.
- **Measured RAM Footprint**:
  | Execution Stage | Working Set (Current) | Peak Working Set (RSS) | Headroom under 512 MB |
  |---|---|---|---|
  | Baseline Python process | 16.44 MB | 16.44 MB | 495.56 MB (96.8%) |
  | FastAPI + DB Models loaded | 86.81 MB | 86.81 MB | 425.19 MB (83.0%) |
  | RapidOCR init & warmup | 153.76 MB | 229.91 MB | 282.09 MB (55.1%) |
  | Digital PDF extraction (`pypdf`) | 161.49 MB | 229.91 MB | 282.09 MB (55.1%) |
  | Scanned receipt extraction (`RapidOCR`) | 165.34 MB | **280.38 MB** | **231.62 MB (45.2% free)** |
- **Pre-baked Models**: Model weights are packaged directly into the container image during Docker build to avoid runtime network downloads or startup delays.
- **Configurable Concurrency**: Regulated via an asynchronous semaphore controlled by `OCR_CONCURRENCY` (default: 1) to prevent CPU or memory starvation.

### C. Asynchronous Ingestion & Task Orchestration
To avoid long-lived HTTP socket timeouts and client disconnects:
1. `POST /api/invoices`:
   - Validates magic bytes (detects spoofed extensions such as `.exe` renamed to `.pdf`).
   - Rejects payloads exceeding 10 MB.
   - Computes SHA-256 digest of binary content.
   - Checks `(organization_id, sha256)` index for instant duplicate detection.
   - Saves file to S3 private storage.
   - Creates `invoices` row with `status='processing'`.
   - Returns HTTP 202 Accepted immediately.
2. Background Worker Execution:
   - Dispatches extraction and deterministic validation under a hard 90-second timeout.
   - Updates record to `completed` or `failed` (persisting `error_reason`).
3. Container Crash Recovery:
   - On container startup, any invoices stuck in `processing` older than 10 minutes are marked as `failed` with reasons indicating container restart interruption.

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Client
    participant Frontend as Next.js 15 Frontend
    participant API as FastAPI Backend (Render)
    participant Storage as S3 Object Storage
    participant DB as Neon PostgreSQL

    User->>Frontend: Select & upload invoice (PDF / Image)
    Frontend->>Frontend: Client validation (Format, <= 10 MB)
    Frontend->>API: POST /api/invoices
    API->>API: Magic byte check & SHA-256 calculation
    API->>DB: Check (org_id, sha256) duplicate index
    API->>Storage: Upload binary to private S3 bucket
    API->>DB: Insert Invoice (status='processing')
    API-->>Frontend: HTTP 202 Accepted (Invoice ID, status='processing')
    
    par Async Processing
        API->>API: Fast-path pypdf / RapidOCR ONNX fallback
        API->>API: Execute deterministic validator (GSTIN, Math, Policy)
        API->>DB: Update Invoice (status='completed', decision, extracted fields)
        API->>DB: Append AuditLog entry ('invoice_created')
    and Client Polling
        loop Every 2s (with backoff)
            Frontend->>API: GET /api/invoices/{id}
            API->>DB: Fetch invoice status & details
            API-->>Frontend: Return status & progress
        end
    end
    Frontend-->>User: Display completed verification & audit trail
```

---

## 3. Security & Multi-Tenancy Architecture

1. **Strict Organization Scoping**: Every database query is scoped by `organization_id`. Attempting to access another organization's invoice returns `404 Not Found`.
2. **Short-Lived Presigned URLs**: Invoice documents are stored in private S3 buckets. Direct access URLs expire after 15 minutes.
3. **Data Protection**: GSTIN numbers and raw invoice contents are never logged at INFO level.
4. **Resilient Connection Handling**: Connection recycling (`pool_recycle=300`), health pre-pings (`pool_pre_ping=True`), and automatic retry listeners recover seamlessly from Neon database scale-to-zero wake-ups.
