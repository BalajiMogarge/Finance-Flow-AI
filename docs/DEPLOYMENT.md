# Finance Flow AI — Production Deployment Guide

This guide details the complete production deployment procedure for Finance Flow AI across Neon PostgreSQL, S3 Object Storage, Render (FastAPI Docker), and Vercel (Next.js 15). Follow each phase in order.

```mermaid
flowchart LR
    Step1["1. Neon PostgreSQL\n(Pooled + Direct URLs)"] --> Step2["2. S3 Object Storage\n(Neon / Supabase Storage)"]
    Step2 --> Step3["3. Render Web Service\n(FastAPI Docker Container)"]
    Step3 --> Step4["4. Vercel Frontend\n(Next.js 15 App Router)"]
```

---

## Phase 1: Provision Neon PostgreSQL

1. **Create Project**:
   - Log into [Neon Console](https://console.neon.tech).
   - Create a project (e.g. `finance-flow-prod`).
2. **Collect Connection Strings**:
   Neon provides pooled and unpooled endpoints. You need both:
   - **Pooled URL (`DATABASE_URL`)**:
     - Toggle Connection Pooling **ON** in the Neon dashboard.
     - The hostname contains `-pooler`:
       ```text
       postgresql://neondb_owner:PASSWORD@ep-falling-star-b5qy3v1l-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require
       ```
     - *Used for runtime application queries via PgBouncer.*
   - **Direct URL (`DATABASE_URL_DIRECT`)**:
     - Toggle Connection Pooling **OFF**.
     - The hostname does **not** contain `-pooler`:
       ```text
       postgresql://neondb_owner:PASSWORD@ep-falling-star-b5qy3v1l.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require
       ```
     - *Used by Alembic migrations during container startup.*

---

## Phase 2: Configure S3 Object Storage

You can use either Neon Object Storage or Supabase Storage:

### Option A: Neon Object Storage (Recommended)
1. Initialize via the Neon CLI:
   ```bash
   neon config init
   neon deploy
   ```
2. Collect the generated S3 credentials:
   - `S3_ENDPOINT_URL`: Provided in Neon project storage settings
   - `S3_REGION`: Same as Neon region (e.g. `us-east-2`)
   - `S3_ACCESS_KEY_ID`: Your Neon storage access key
   - `S3_SECRET_ACCESS_KEY`: Your Neon storage secret key
   - `S3_BUCKET`: `uploads`

### Option B: Supabase Storage
1. Create a private bucket named `uploads` in Supabase Storage.
2. In Project Settings $\rightarrow$ Storage $\rightarrow$ S3 Access Keys, generate an S3 Access Key pair.

---

## Phase 3: Deploy Backend on Render

1. **Create New Web Service**:
   - Log into [Render Dashboard](https://dashboard.render.com).
   - Click **New** $\rightarrow$ **Web Service**.
   - Connect your GitHub repository (`FinanceFlowAI`).
2. **Service Configuration**:
   - **Name**: `finance-flow-backend` (or your preferred name)
   - **Branch**: `render-demo-ready` (or merged production branch)
   - **Root Directory**: `backend`
   - **Runtime**: **Docker**
   - **Instance Type**: **Free** (0.1 CPU, 512 MB RAM)
3. **Environment Variables**:
   Under the **Environment** tab, add the following variables:

| Variable | Value Description |
|---|---|
| `ENVIRONMENT` | `production` |
| `DATABASE_URL` | Neon pooled connection string (`...-pooler...sslmode=require`) |
| `DATABASE_URL_DIRECT` | Neon direct connection string (`...sslmode=require`) |
| `SECRET_KEY` | 32+ character random secret (e.g. `openssl rand -hex 32`) |
| `STORAGE_BACKEND` | `s3` |
| `S3_ENDPOINT_URL` | S3 endpoint URL |
| `S3_REGION` | S3 bucket region (e.g. `us-east-2`) |
| `S3_ACCESS_KEY_ID` | S3 access key ID |
| `S3_SECRET_ACCESS_KEY` | S3 secret access key |
| `S3_BUCKET` | `uploads` |
| `FRONTEND_ORIGINS` | `https://your-frontend.vercel.app` (update after Phase 4) |
| `FRONTEND_PREVIEW_REGEX`| `^https://[a-zA-Z0-9-]+-your-team\.vercel\.app$` |
| `OCR_CONCURRENCY` | `1` |

4. **Health Check Path**:
   - Set **Health Check Path** to `/health`.
5. **Deploy**:
   - Click **Create Web Service**. Render builds the Docker image and launches the container.
   - Note down your Render service URL (e.g. `https://finance-flow-backend.onrender.com`).

---

## Phase 4: Deploy Frontend on Vercel

1. **Import Project**:
   - Log into [Vercel](https://vercel.com).
   - Click **Add New** $\rightarrow$ **Project** $\rightarrow$ import your repository.
2. **Configure Settings**:
   - Framework Preset: **Next.js**
   - Root Directory: `frontend`
3. **Environment Variables**:
   Add the following environment variable:

| Variable | Environment | Value |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Production, Preview | `https://finance-flow-backend.onrender.com` |

> **Important**: Do not include a trailing slash in `NEXT_PUBLIC_API_URL`.

4. **Deploy**:
   - Click **Deploy**. Vercel will build and deploy Next.js 15.
5. **Update Backend CORS**:
   - Copy your assigned Vercel URL (e.g. `https://finance-flow-ai.vercel.app`).
   - In Render dashboard, update `FRONTEND_ORIGINS` to include this URL.

---

## Phase 5: Verification & Smoke Test Checklist

- [ ] **Liveness**: Visit `https://your-backend.onrender.com/health` $\rightarrow$ `{"status": "healthy"}`.
- [ ] **Readiness**: Visit `https://your-backend.onrender.com/health/ready` $\rightarrow$ `{"status": "ready", "database": "connected", "ocr_model": "loaded"}`.
- [ ] **Frontend Load**: Open your Vercel URL in a browser; verify no UI console errors.
- [ ] **Cold-Start Banner**: If Render was asleep, confirm the banner shows *"Server is waking up (up to ~60 s)"* and disappears automatically once online.
- [ ] **User Sign-In**: Log in with your organization user account.
- [ ] **Digital PDF Ingestion**: Upload `samples/sample_digital_standard.pdf`.
  - Ingestion returns `202 Accepted` immediately.
  - Processing completes via `pypdf` fast-path within 2 seconds.
  - Checksum, arithmetic balance, and decision reflect `APPROVE`.
- [ ] **Scanned Image Ingestion**: Upload `samples/sample_scanned_receipt.png`.
  - Processing completes via RapidOCR ONNX fallback.
  - Verification decision updates in dashboard.
- [ ] **Presigned Storage Access**: Click **View Document**; confirm presigned S3 URL opens the document securely.
- [ ] **Human Review**: Test approving/rejecting a pending invoice with review notes; verify audit log updates.
