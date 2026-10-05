# Finance Flow AI — Interactive Demo Walkthrough

This guide provides an end-to-end walkthrough for demonstrating Finance Flow AI's production capabilities.

---

## 🚀 Key Talking Points

1. **Deterministic Rule Engine:** Approvals, rejections, and review queue flags are governed by 100% deterministic tax arithmetic and GSTIN checksum validation—not stochastic LLM hallucinations.
2. **Dual-Engine Ingestion:** High-speed digital PDF text extraction via `pypdf` paired with PyTorch/EasyOCR for scanned raster images, optimized to run reliably within Render's 512 MB memory boundary.
3. **Enterprise Audit & Compliance:** Built-in duplicate invoice detection (SHA-256 content hashing), human-in-the-loop review queues, and tamper-evident audit trails.
4. **Production Persistence:** PostgreSQL schema managed via Alembic migrations, with transparent support for durable object storage (AWS S3 / Cloudflare R2).

---

## 🎤 Step-by-Step Demo Script

### Step 1: Dashboard Overview
* Navigate to the root URL `/`.
* Highlight the **Key Metrics** cards (Total Invoices, Approved, Pending Review, Rejected). These counters reflect live database records.
* Point out the **AI Insights** panel (top vendor spend, approval rate percentage, and verification accuracy computed dynamically from invoice records).

### Step 2: Uploading Invoices & Dual-Engine Processing
* Drag-and-drop or select a sample invoice:
  * **Test Case A (Digital PDF):** Upload a digital PDF. Point out the instant extraction speed ($< 500$ ms) and zero OCR latency.
  * **Test Case B (High-Fidelity Image):** Upload a sample PNG/JPEG. The backend runs OCR within the concurrency semaphore, downscaling if oversized.
* Inspect the **Upload Result Panel**:
  * Show extracted fields: Vendor Name, Invoice Number, GSTIN, Date, Subtotal, CGST, SGST, and Total.
  * Show the validation breakdown: GSTIN format and mod-36 checksum, and tax math verification ($\text{Subtotal} + \text{CGST} + \text{SGST} = \text{Total}$).
  * Show the deterministic decision and risk badge (`APPROVE` / `LOW`, `REJECT` / `HIGH`, or `PENDING REVIEW` / `MEDIUM`).

### Step 3: Duplicate Invoice Detection
* Re-upload the exact same invoice file.
* Observe that the system flags **Duplicate detected**:
  * The file hash matches an existing record in the database.
  * The result panel displays the warning banner.
  * The invoice is flagged as `is_duplicate: true` to prevent fraudulent double-payments.

### Step 4: The Invoices Directory & Filter Tabs
* Click **Invoices** in the top navigation bar (or navigate to `/invoices`).
* Demonstrate the tab filters:
  * **All Invoices:** Complete historical ledger.
  * **Review Queue:** Invoices requiring human attention (`PENDING REVIEW`).
  * **Approved:** High-confidence reconciled invoices.
  * **Rejected:** Invoices failing compliance or tax math.
  * **Duplicates:** Filtered ledger of flagged duplicate submissions.
* Test the search bar: type a vendor name or invoice number (e.g. `Acme`) and observe real-time filtering.

### Step 5: Human Review & Audit Trail
* Click on the **Review Queue** tab.
* Find an invoice marked `PENDING REVIEW` and click **Review**.
* Enter an auditor note (e.g., *"Manually verified supplier GST portal filing. Approved for disbursement."*) and click **Approve Invoice**.
* Notice that the invoice status immediately updates to `Approved` with `LOW` risk.
* Click the **History** (clock) button on the invoice row to open the **Audit Trail Modal**:
  * Show the chronological event history:
    1. `UPLOAD_PROCESSED`: Automated system ingestion and initial decision.
    2. `HUMAN_REVIEW`: Auditor decision, timestamp, and audit notes.

### Step 6: Navigation & Settings
* Check the **Vendors**, **Reports**, and **Settings** tabs in the navbar to showcase the integrated module structure and system configuration.
