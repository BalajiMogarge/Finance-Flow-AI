# Demo & Deployment Guide — Finance Flow AI

This guide explains how to deploy the Finance Flow AI platform and how to use it for a demo.

## 🚀 Deployment Architecture

The project consists of two separate layers that must be hosted differently.

### 1. Frontend (Next.js)
**Host:** Vercel (Recommended)
The frontend is a static-site generated (SSG) / server-side rendered (SSR) app. It can be deployed directly from GitHub to Vercel.

**Environment Variables:**
In the Vercel Dashboard, go to **Settings** $\rightarrow$ **Environment Variables** and add:
- `NEXT_PUBLIC_API_URL`: The absolute URL of your deployed backend (e.g., `https://finance-flow-api.onrender.com`).

### 2. Backend (FastAPI)
**Host:** Render, Railway, or AWS/GCP (NOT Vercel)
The backend **cannot** be deployed to Vercel for the following reasons:
- **PyTorch/EasyOCR Size**: The AI models and dependencies (like PyTorch) exceed Vercel's serverless function size limits.
- **Persistent Storage**: The application uses a SQLite database (`finance_flow.db`) and an `uploads/` folder. Vercel's filesystem is read-only and ephemeral; all data would be lost on every request.

**Recommended Setup (Render/Railway):**
1. Create a new Web Service.
2. Connect your GitHub repo.
3. Set the build command: `pip install -r backend/requirements.txt`.
4. Set the start command: `uvicorn backend.app.main:app --host 0.0.0.0 --port 10000`.
5. **Crucial**: Attach a **Persistent Disk** to `/app/backend` (or the root folder) so that `finance_flow.db` and the `uploads/` folder persist across restarts.

---

## 🎤 How to use for a Demo

To showcase the platform's capabilities, follow these steps:

### Step 1: The Dashboard Overview
- Open the deployed website.
- Point out the **Key Metrics** (Total, Approved, etc.) and the **AI Insights** section.
- Explain that these are derived in real-time from the processed invoice database.

### Step 2: The AI Pipeline (The "Magic")
- Click "Upload Invoices" or drag-and-drop a sample invoice image (PNG/JPG).
- **What's happening behind the scenes:**
    1. **OCR**: EasyOCR reads the image.
    2. **Extraction**: Regex-based logic pulls out the Vendor, Invoice #, GSTIN, and Amounts.
    3. **Validation**: The system checks if the arithmetic matches (Subtotal + Tax = Total).
    4. **Decision**: The AI assigns a risk level and an outcome (APPROVE / REJECT / PENDING).

### Step 3: Inspecting Results
- Once the upload is "Done", look at the **Upload Result Panel**.
- Show the extracted fields and the **Validation Errors/Warnings**.
- Point out the **Confidence Score** (how sure the AI is about the text).

### Step 4: Data Persistence
- Scroll down to the **Recent Invoices** table.
- Show that the newly uploaded invoice has been persisted to the database and now appears in the history.
- Note that the **AI Insights** and **Stats Cards** have updated automatically.
