# Finance Flow AI — Live Demo & Presentation Guide

This guide is designed for presenting Finance Flow AI during live demonstrations and college defense sessions. It covers demo presentation flow, pre-demo warmup, sample invoice test cases, and the 100% offline laptop backup procedure.

---

## 1. Demo-Day Golden Rules

1. **Warm Up Render 5–10 Minutes Before Presentation**:
   Render's free tier spins down after 15 minutes of inactivity. Cold start takes 45–60 seconds.
   - Open `https://your-backend.onrender.com/health` in your browser before your turn.
   - Once it responds with `{"status": "healthy"}`, Render remains hot and responsive throughout your presentation.
2. **Have the Local Offline Mode Running in the Background**:
   Campus Wi-Fi can drop or throttle without warning. Keep the backend and frontend running on your laptop (`http://localhost:3000`). If cloud connectivity stumbles, switch browser tabs seamlessly to `localhost:3000`.

---

## 2. Complete Offline Laptop Setup (Zero Internet, Zero Docker)

Your laptop is your reliable fail-safe. It does not require Docker or internet connectivity.

### Step 1: Start the Backend (Terminal 1)
```powershell
cd c:\Users\admin\Desktop\Projects\FinancialManager\backend
.\.venv\Scripts\activate

# If using local SQLite or existing database:
alembic upgrade head

# Start FastAPI server on port 8000:
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
Verify backend is live: Open `http://127.0.0.1:8000/health` $\rightarrow$ `{"status": "healthy"}`.

### Step 2: Start the Frontend (Terminal 2)
```powershell
cd c:\Users\admin\Desktop\Projects\FinancialManager\frontend
npm run dev
```
Open `http://localhost:3000` in Google Chrome or Microsoft Edge.

### Step 3: Default Credentials
- **Email**: `admin@financeflow.ai`
- **Password**: `admin123`

---

## 3. Optional: Live Phone/Tablet Demo via Tunnel

If you want to demonstrate uploading an invoice from your mobile phone camera or tablet while running off your laptop:
```powershell
# In PowerShell:
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8000
```
Cloudflare outputs a public HTTPS URL (e.g. `https://random-word.trycloudflare.com`). You can set this as `NEXT_PUBLIC_API_URL` and access it from any mobile device!

---

## 4. Curated Demo Test Cases (Using `samples/`)

The repository includes curated test files in `samples/` designed to showcase each deterministic rule:

| File | Type | Expected Decision | Highlight / Talking Point |
|---|---|---|---|
| `sample_digital_standard.pdf` | Digital Vector PDF | **APPROVE** | **Fast-path demo**: Extracted in $<150$ ms via `pypdf`, 100% confidence. GSTIN valid, arithmetic balances, total under ₹200k. |
| `sample_scanned_receipt.png` | Scanned Image | **APPROVE** / **PENDING** | **RapidOCR fallback**: Optical extraction powered by ONNX Runtime CPU within 2.2 seconds. No heavy PyTorch needed. |
| `sample_high_value_capex.pdf` | High-Value Digital PDF | **PENDING REVIEW** | **Policy rule**: Amount $\ge \text{₹ } 200,000$. Enforces strict segregation of duties requiring manual manager sign-off. |
| `sample_math_mismatch.pdf` | Arithmetic Inconsistency | **REJECT** | **Mathematical check**: Subtotal + Tax $\neq$ Total ($> \text{₹ } 1.00$ tolerance). Deterministic rejection. |
| `sample_corrupt_spoofed.exe` (or rename) | Spoofed Executable | **HTTP 415 Error** | **Security check**: Magic byte inspection blocks non-standard binaries even if renamed to `.pdf`. |

---

## 5. Walkthrough Script for the Presentation

### Part 1: Problem Statement & Engineering Philosophy (1–2 minutes)
- *"Most modern AI tools wrap an LLM prompt around invoices. In finance, this introduces severe hallucination risks, non-deterministic math, high latency, and high cloud costs."*
- *"Finance Flow AI solves this through a deterministic architecture: AI/OCR only extracts the raw text. 100% of the approval, mathematical reconciliation, tax verification, and compliance checks are performed by deterministic code."*

### Part 2: Live Ingestion & Fast-Path Extraction (2 minutes)
1. Log into the dashboard at `http://localhost:3000` (or your live Vercel URL).
2. Upload `sample_digital_standard.pdf`:
   - Point out that the API returns `202 Accepted` immediately without blocking the browser.
   - Show how the background worker processes it via the `pypdf` fast-path in under 150 ms.
   - Review the extracted fields: Vendor, Invoice Number, GSTIN, Subtotal, CGST, SGST, and Total.
   - Show the green **APPROVE** badge.

### Part 3: Regulatory Verification & Arithmetic Audit (2 minutes)
1. Point to the **GSTIN Checksum**: Explain that it uses the ISO/IEC 7064 (Luhn mod 36) checksum algorithm required by the Indian Goods and Services Tax Network.
2. Point to the **Tax Reconciliation**: Explain the arithmetic balance check:
   $$\text{Subtotal} + \text{CGST} + \text{SGST} = \text{Total} \pm 1.00\text{ INR}$$
3. Upload `sample_high_value_capex.pdf`:
   - Show that despite clean OCR and valid GSTIN, it is flagged as **PENDING REVIEW** because the total exceeds ₹200,000 (enterprise segregation of duties).
   - Demonstrate the Human-in-the-Loop review action: approve with notes.
   - Point out the immutable audit log entry in the audit trail table.

### Part 4: Production Hardening & Low-Memory Optimization (1–2 minutes)
- *"Our backend is engineered to fit comfortably within Render's free 512 MB memory limit."*
- *"We eliminated PyTorch and Tesseract, replacing them with ONNX Runtime CPU (`RapidOCR`). Our peak memory footprint during active inference is only 280 MB, leaving 45% safety headroom under the 512 MB ceiling."*

---

## 6. Live Demo Troubleshooting

| Symptom | Quick Fix |
|---|---|
| Orange banner: *"Server is waking up..."* | Expected on Render free tier if asleep. Wait 45–60 s for automatic reconnection, or switch to your local `http://localhost:3000` tab. |
| Login fails with 401 | Verify you typed `admin@financeflow.ai` and `admin123`. |
| Port 8000 already in use | Run `Get-Process python \| Stop-Process` in PowerShell and restart `uvicorn`. |
| Upload fails with 415 | File extension or magic byte mismatch. Use the verified files in `samples/`. |
