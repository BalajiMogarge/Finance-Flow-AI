# Finance Flow AI — Production Deployment Guide

This guide covers end-to-end production deployment of Finance Flow AI using free and open-source tools:
* **Frontend:** Next.js 15 on **Vercel** (Hobby Plan)
* **Backend:** FastAPI on **Render** (Free Web Service)
* **Database:** Managed PostgreSQL (**Neon**, **Supabase**, or **Render Postgres**)
* **Object Storage:** Pluggable local ephemeral disk or durable **Cloudflare R2** / **AWS S3**

---

## 1. Hosting Tier Limitations & Verified Facts (October 2026)

| Provider & Tier | Limits & Behavior | Solution / Architecture in Finance Flow AI |
| :--- | :--- | :--- |
| **Render Web Service (Free)** | 512 MB RAM, 0.1 vCPU, 15m inactivity spin-down, ephemeral disk. | PyTorch/EasyOCR concurrency is limited to 1 via `asyncio.Semaphore(1)`. Images are downscaled to 1600px. Digital PDFs bypass OCR via `pypdf`. |
| **Render PostgreSQL (Free)** | 1 GB storage, **expires and shuts down after 30 days**. | For permanent production persistence, use a permanent free PostgreSQL tier such as **Neon Serverless Postgres** (0.5 GB permanent) or **Supabase** (500 MB permanent). Set `DATABASE_URL`. |
| **Render Filesystem (Free)** | Ephemeral. Uploaded files do not survive redeploys or restarts. | The backend exposes `is_ephemeral` so callers are aware of file status. For durable storage, set `STORAGE_BACKEND=s3` pointing to Cloudflare R2 (10 GB free) or AWS S3. |
| **Vercel Hobby Plan** | 60-second max function timeout, 250 MB bundle limit. | Next.js build is optimized with standalone tracing (`outputFileTracingRoot`). Static export & CSR utilized for instant responsiveness. |

---

## 2. Environment Variables Reference

### 2.1 Backend Environment Variables (Render)

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | **Yes** | `sqlite:///finance_flow.db` | PostgreSQL connection string (`postgresql://user:pass@host/db`). Render's legacy `postgres://` format is automatically converted. |
| `SECRET_KEY` | **Yes** (Prod) | `finance-flow-ai-development-...` | Cryptographic secret for signing PyJWT access tokens. Use `openssl rand -hex 32`. |
| `CORS_ALLOWED_ORIGINS` | No | `http://localhost:3000,http://localhost:3001` | Comma-delimited list of allowed frontend origins (e.g. `https://finance-flow-ai.vercel.app`). |
| `CORS_ORIGIN_REGEX` | No | `^https://.*\.vercel\.app$` | Regex allowing all Vercel production and preview deployment URLs. |
| `STORAGE_BACKEND` | No | `local` | `local` for disk storage or `s3` for durable object storage. |
| `MAX_UPLOAD_BYTES` | No | `10485760` (10 MB) | Maximum upload file size guard in bytes. |
| `OCR_CONCURRENCY_LIMIT`| No | `1` | Max concurrent OCR inferences. Keeps RAM $< 512$ MB. |
| `OCR_MAX_IMAGE_DIM` | No | `1600` | Max width or height for raster images before downscaling. |
| `S3_ENDPOINT_URL` | If `s3` | `None` | S3 endpoint URL (e.g., `https://<account-id>.r2.cloudflarestorage.com`). |
| `S3_BUCKET_NAME` | If `s3` | `None` | Name of the S3 / R2 bucket. |
| `S3_ACCESS_KEY_ID` | If `s3` | `None` | S3 API access key. |
| `S3_SECRET_ACCESS_KEY` | If `s3` | `None` | S3 secret access key. |
| `S3_REGION` | If `s3` | `auto` | Bucket region (`auto`, `us-east-1`, etc.). |

### 2.2 Frontend Environment Variables (Vercel)

| Variable | Required | Example | Description |
| :--- | :---: | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | **Yes** | `https://finance-flow-api.onrender.com` | Public base URL of your deployed FastAPI backend (no trailing slash). |

---

## 3. Ordered Deployment Steps

### Step 1: Provision Persistent Database
1. Create a free PostgreSQL instance on **Neon** (`https://neon.tech`), **Supabase** (`https://supabase.com`), or Render.
2. Copy the connection string (`postgresql://<user>:<password>@<host>/<database>?sslmode=require`).

### Step 2: Deploy Backend on Render
1. Connect your GitHub repository to Render.
2. Click **New + → Blueprint** to deploy using the included [`render.yaml`](../render.yaml), OR select **New Web Service**:
   * **Root Directory:** `backend`
   * **Runtime:** `Python 3`
   * **Build Command:** `pip install --upgrade pip && pip install -r requirements.txt && alembic upgrade head`
   * **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1`
   * **Plan:** Free
3. Add Environment Variables:
   * `DATABASE_URL`: Your Postgres connection string.
   * `SECRET_KEY`: A secure random 64-character hex string.
   * `STORAGE_BACKEND`: `local` (or `s3` if using R2/S3).
4. Deploy and verify health check: `https://<your-service>.onrender.com/health`.

### Step 3: Deploy Frontend on Vercel
1. In Vercel, import the GitHub repository.
2. Configure Project:
   * **Root Directory:** `frontend`
   * **Framework Preset:** `Next.js`
   * **Build Command:** `next build` (auto-detected)
   * **Output Directory:** `.next` (auto-detected)
3. Under **Environment Variables**, add:
   * `NEXT_PUBLIC_API_URL` = `https://<your-service>.onrender.com`
4. Click **Deploy**.

---

## 4. Database Migrations

Finance Flow AI manages schema changes via **Alembic**. Database creation at application import time has been removed to prevent race conditions during horizontal scaling.

To execute migrations locally or in CI/CD:
```bash
cd backend
alembic upgrade head
```

To create a new migration after updating `app/models.py`:
```bash
alembic revision --autogenerate -m "describe_changes"
alembic upgrade head
```
