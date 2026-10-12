# Finance Flow AI — Production Deployment Guide

This guide details the complete production deployment procedure for Finance Flow AI. Follow each phase in order.

```mermaid
flowchart LR
    Step1["1. Neon PostgreSQL\n(Pooled + Direct URLs)"] --> Step2["2. Supabase Storage\n(Private S3 Bucket)"]
    Step2 --> Step3["3. Hugging Face Space\n(FastAPI Docker Container)"]
    Step3 --> Step4["4. Vercel\n(Next.js 15 Frontend)"]
```

---

## Phase 1: Provision Neon PostgreSQL

1. **Create Project**:
   - Log into [Neon Console](https://console.neon.tech).
   - Create a new project (e.g., `finance-flow-prod`).
2. **Retrieve Connection Strings**:
   Neon provides two connection strings. You **must** capture both:
   - **Pooled URL (`DATABASE_URL`)**:
     - Toggle connection pooling **ON** in the Neon dashboard.
     - The hostname contains `-pooler`:
       ```text
       postgresql://user:password@ep-cool-snowflake-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
       ```
     - *Used for runtime queries by the FastAPI application.*
   - **Direct URL (`DATABASE_URL_DIRECT`)**:
     - Toggle connection pooling **OFF**.
     - The hostname does **not** contain `-pooler`:
       ```text
       postgresql://user:password@ep-cool-snowflake-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
       ```
     - *Used exclusively by Alembic migrations during container startup.*

---

## Phase 2: Configure Supabase S3-Compatible Storage

1. **Create Bucket**:
   - Log into [Supabase](https://supabase.com/dashboard).
   - Navigate to **Storage** $\rightarrow$ **New Bucket**.
   - Set Name to `invoices`.
   - **Ensure Public Bucket is OFF (Private Bucket)**.
2. **Generate S3 Credentials**:
   - Go to **Project Settings** $\rightarrow$ **Storage** $\rightarrow$ **S3 Access Keys**.
   - Generate a new S3 Access Key Pair:
     - `S3_ACCESS_KEY_ID`: Your generated Access Key ID.
     - `S3_SECRET_ACCESS_KEY`: Your generated Secret Access Key.
     - `S3_ENDPOINT_URL`: `https://<project-ref>.supabase.co/storage/v1/s3`
     - `S3_REGION`: Region of your Supabase project (e.g., `us-east-1`).
     - `S3_BUCKET`: `invoices`

---

## Phase 3: Deploy Backend on Hugging Face Spaces

1. **Create a Space**:
   - Go to [Hugging Face Spaces](https://huggingface.co/new-space).
   - Space Name: `finance-flow-ai-backend` (or your preferred name).
   - License: `mit` or `apache-2.0`.
   - Select **Docker** SDK.
   - Hardware: **CPU Basic** (2 vCPU, 16 GB RAM — Free tier).
2. **Configure Space Settings**:
   - In Space **Settings** $\rightarrow$ **Variables and Secrets**:
   - Add the following **Secrets**:

| Secret Name | Value Description |
|---|---|
| `DATABASE_URL` | Neon pooled connection string (`...-pooler...sslmode=require`) |
| `DATABASE_URL_DIRECT` | Neon direct connection string (`...sslmode=require`) |
| `SECRET_KEY` | Strong random string ($\ge 32$ chars, e.g. `openssl rand -hex 32`) |
| `STORAGE_BACKEND` | `s3` |
| `S3_ENDPOINT_URL` | Supabase S3 endpoint URL |
| `S3_REGION` | Supabase storage region (e.g. `us-east-1`) |
| `S3_ACCESS_KEY_ID` | Supabase S3 access key ID |
| `S3_SECRET_ACCESS_KEY` | Supabase S3 secret access key |
| `S3_BUCKET` | `invoices` |
| `FRONTEND_ORIGINS` | `["https://your-frontend.vercel.app"]` |
| `FRONTEND_PREVIEW_REGEX`| `^https://[a-zA-Z0-9-]+-your-team\.vercel\.app$` |

3. **Deploy Code**:
   - **Option A (GitHub Actions)**:
     Add your `HF_TOKEN` as a repository secret on GitHub. The workflow in `.github/workflows/sync-huggingface.yml` will automatically sync the `backend/` directory to your Space upon push.
   - **Option B (Direct Git Push)**:
     ```bash
     git remote add hf https://huggingface.co/spaces/<your-username>/<your-space-name>
     git subtree push --prefix backend hf main
     ```
4. **Verify Backend Health**:
   Once the Space build completes:
   - Visit: `https://<your-space-name>.hf.space/health` $\rightarrow$ should return `{"status": "healthy"}`.
   - Visit: `https://<your-space-name>.hf.space/health/ready` $\rightarrow$ should return `{"status": "ready", "database": "connected", "ocr_model": "loaded"}`.

---

## Phase 4: Deploy Frontend on Vercel

1. **Import Repository**:
   - Log into [Vercel](https://vercel.com).
   - Click **Add New Project** $\rightarrow$ import your Git repository.
2. **Project Settings**:
   - Framework Preset: **Next.js**.
   - Root Directory: `frontend`.
3. **Environment Variables**:
   Add the following environment variable in Vercel:

| Variable Name | Environment | Value |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Production, Preview | `https://<your-space-name>.hf.space` |

> **Critical**: Do not include trailing slashes in `NEXT_PUBLIC_API_URL`.

4. **Deploy**:
   - Click **Deploy**. Vercel will execute `npm run build` and launch the frontend.
5. **Update Backend CORS**:
   - Copy your production Vercel URL (e.g. `https://finance-flow-ai.vercel.app`).
   - In Hugging Face Space settings, update the `FRONTEND_ORIGINS` secret to include this exact domain:
     ```text
     ["https://finance-flow-ai.vercel.app"]
     ```

---

## Phase 5: Verification & Smoke Test Checklist

- [ ] Open frontend production URL in browser.
- [ ] Confirm no cold-start warning remains once backend is awake.
- [ ] Sign up or log into an organization account.
- [ ] Upload a digital invoice (`sample_digital_standard.pdf`):
  - Ingestion returns 202 Accepted.
  - Processing completes in $< 2$ seconds via fast-path.
  - Extracted fields, GSTIN verification, and arithmetic consistency pass.
- [ ] Upload a scanned receipt (`sample_scanned_receipt.png`):
  - Ingestion processes via CPU EasyOCR fallback.
  - Verification decision completes and reflects in dashboard.
- [ ] Click **View Original** on an invoice and verify the presigned S3 URL opens the document securely.
- [ ] Perform a human review approval/rejection with notes on a pending invoice and confirm the action is recorded in the audit trail.
