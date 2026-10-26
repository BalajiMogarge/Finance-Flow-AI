# Finance Flow AI — Production Deployment Guide & Runbook

This runbook provides the exact, tested, step-by-step procedure for deploying a clean production instance of Finance Flow AI from scratch. Follow each phase in sequential order.

```mermaid
flowchart TD
    Phase1["Phase 1: Neon PostgreSQL\n(Serverless DB with Pooled & Direct URLs)"]
    Phase2["Phase 2: Supabase Storage\n(S3-Compatible Private Bucket & API Keys)"]
    Phase3["Phase 3: Render Web Service\n(FastAPI Docker Container on 512MB Free Tier)"]
    Phase4["Phase 4: Vercel Frontend\n(Next.js 15 App Router)"]
    Phase5["Phase 5: Update CORS Origins\n(Authorize Final Vercel Production Domain)"]
    Phase6["Phase 6: Verification & Smoke Test\n(UI Inspection & scripts/test_live_render.py)"]

    Phase1 --> Phase2
    Phase2 --> Phase3
    Phase3 --> Phase4
    Phase4 --> Phase5
    Phase5 --> Phase6
```

---

## 1. Environment Variables Matrix

Every variable required for production deployment is listed below. **Never commit secrets or paste them into public channels.**

| Environment Variable | Target Service | Dashboard / Source | Secret? | Format / Pattern | Purpose |
| :--- | :--- | :--- | :---: | :--- | :--- |
| `ENVIRONMENT` | Render | Render Dashboard | No | `production` | Enables production security constraints (enforces S3 storage & strong secrets). |
| `DATABASE_URL` | Render | Neon Dashboard | **Yes** | `postgresql://user:pass@ep-*-pooler.*.aws.neon.tech/neondb?sslmode=require` | Pooled connection string used by FastAPI at runtime (via PgBouncer). |
| `DATABASE_URL_DIRECT` | Render | Neon Dashboard | **Yes** | `postgresql://user:pass@ep-*.*.aws.neon.tech/neondb?sslmode=require` | Unpooled direct connection string used by Alembic migrations for DDL and locks. |
| `SECRET_KEY` | Render | PowerShell script | **Yes** | 64-character random hex string | Signs and verifies user JWT session tokens. |
| `ALGORITHM` | Render | Render Dashboard | No | `HS256` | Cryptographic algorithm for JWT encoding. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Render | Render Dashboard | No | `1440` | Session token lifetime (1440 minutes = 24 hours). |
| `STORAGE_BACKEND` | Render | Render Dashboard | No | `s3` | Enforces private S3-compatible cloud storage. |
| `S3_ENDPOINT_URL` | Render | Supabase Dashboard | No | `https://<project-ref>.supabase.co/storage/v1/s3` | S3 API endpoint. **Must end with `/storage/v1/s3`**. |
| `S3_REGION` | Render | Supabase Dashboard | No | `us-east-1` (or your chosen region) | Region hosting your Supabase storage bucket. |
| `S3_BUCKET` | Render | Supabase Dashboard | No | `invoices` | Private S3 bucket name for storing invoice documents. |
| `S3_ACCESS_KEY_ID` | Render | Supabase Dashboard | **Yes** | 32-character alphanumeric key | Access key credential for Supabase S3 storage. |
| `S3_SECRET_ACCESS_KEY` | Render | Supabase Dashboard | **Yes** | 64-character secret key | Secret access key credential for Supabase S3 storage. |
| `FRONTEND_ORIGINS` | Render | Render Dashboard | No | `https://<app>.vercel.app,http://localhost:3000` | Comma-separated list of allowed origins (**no trailing slash!**). |
| `FRONTEND_PREVIEW_REGEX` | Render | Render Dashboard | No | `^https://finance-flow-ai(-[a-zA-Z0-9_-]+)*\.vercel\.app$` | Scoped regex allowing preview deployments on Vercel. |
| `OCR_CONCURRENCY` | Render | Render Dashboard | No | `1` | Restricts concurrent OCR to 1 to stay within Render's 512MB RAM cap. |
| `OCR_MAX_IMAGE_DIM` | Render | Render Dashboard | No | `1200` | Maximum image dimension before downscaling to prevent memory exhaustion. |
| `OCR_TIMEOUT_SECONDS` | Render | Render Dashboard | No | `90` | Hard timeout per invoice processing task in seconds. |
| `NEXT_PUBLIC_API_URL` | Vercel | Render Dashboard | No | `https://<your-service>.onrender.com` | Base URL of backend API (**no trailing slash!**). |

---

## 2. Deployment Runbook

### Phase 1: Provision Neon PostgreSQL

1. **Sign in to Neon**:
   - Navigate to [console.neon.tech](https://console.neon.tech) and log in.
2. **Create New Project**:
   - Click **Create Project**.
   - **Name**: `finance-flow-prod`
   - **Postgres Version**: 15 or 16 (default).
   - **Region**: Select the AWS region closest to your Render service (e.g. `US East (Ohio) - us-east-2`).
   - Click **Create Project**.
3. **Obtain the Runtime Pooled Connection String (`DATABASE_URL`)**:
   - On the Neon project dashboard, locate the **Connection Details** widget.
   - Ensure the **Pooled connection** checkbox/toggle is **ON**.
   - Copy the connection string. The host **must** contain `-pooler.` (e.g. `ep-fancy-mountain-123456-pooler.us-east-2.aws.neon.tech`).
   - *This will be set as `DATABASE_URL` in Render.*
4. **Obtain the Direct Unpooled Connection String (`DATABASE_URL_DIRECT`)**:
   - In the same **Connection Details** widget, toggle **Pooled connection** to **OFF**.
   - Copy the connection string. The host **must not** contain `-pooler.` (e.g. `ep-fancy-mountain-123456.us-east-2.aws.neon.tech`).
   - *This will be set as `DATABASE_URL_DIRECT` in Render.*
   - > [!IMPORTANT]
     > Alembic migrations perform DDL schema updates and acquire PostgreSQL advisory locks. PgBouncer's transaction pooling mode does not permit session locks. Supplying `DATABASE_URL_DIRECT` ensures migrations run cleanly while runtime queries benefit from pooling.
5. **Fresh Database Confirmation**:
   - You do not need to run manual SQL or create tables in Neon. The backend Docker container automatically runs `alembic upgrade head` on container boot, constructing all tables and indexes.

---

### Phase 2: Configure Supabase Storage (S3-Compatible Bucket)

1. **Sign in to Supabase**:
   - Navigate to [supabase.com/dashboard](https://supabase.com/dashboard) and log in.
2. **Create New Project**:
   - Click **New Project**.
   - **Name**: `finance-flow-storage`
   - **Database Password**: Generate and store securely.
   - **Region**: Select your desired region (e.g. `us-east-1`).
   - Click **Create new project** and wait ~90 seconds for initialization.
3. **Create the Private Storage Bucket**:
   - In the left sidebar, click the **Storage** icon.
   - Click **New bucket**.
   - **Bucket name**: `invoices` (lowercase, letters and numbers only).
   - **Public bucket**: Ensure this toggle is **OFF** (Private).
   - Click **Save**.
   - > [!IMPORTANT]
     > Keeping the bucket private ensures original invoice files and financial documents are never exposed to the public internet. Access is strictly granted through short-lived presigned URLs.
4. **Generate S3 Access Keys**:
   - In the left sidebar, click the **Settings (gear icon)** at the bottom left.
   - Under the **Configuration** menu, click **Storage**.
   - Scroll down to the **S3 Access Keys** section.
   - Click **Create access key** (or **Generate new key**).
   - **Description**: `finance-flow-backend`
   - Copy the generated credentials:
     - **Access Key ID** &rarr; copy for `S3_ACCESS_KEY_ID`.
     - **Secret Access Key** &rarr; copy for `S3_SECRET_ACCESS_KEY` (*shown only once!*).
5. **Construct the S3 Endpoint URL**:
   - Navigate to **Project Settings** &rarr; **General**.
   - Note your **Reference ID** (e.g. `abcdefghijklmnopqrst`).
   - Your S3 Endpoint URL is:
     ```text
     https://<YOUR_PROJECT_REFERENCE_ID>.supabase.co/storage/v1/s3
     ```
   - > [!WARNING]
     > The endpoint **must** end with `/storage/v1/s3`. If this path suffix is omitted, boto3 requests will fail with 404/403 errors.

---

### Phase 3: Deploy Backend on Render (Docker Web Service)

#### Why Docker on Render's Free Tier?
The repository uses a dedicated multi-stage **Docker deployment** (`backend/Dockerfile`) rather than native Python:
1. **Isolated System Dependencies**: ONNX Runtime and OpenCV require native C++ runtime libraries (`libgomp1`, `libgl1`, `libglib2.0-0`). The Docker image installs these deterministically.
2. **Zero Cold-Start Model Downloads**: RapidOCR ONNX weights are pre-cached inside the image at build time. Requests never hang waiting for external model downloads.
3. **Hardened Low-Memory Performance**: OpenMP and math thread pools are clamped to 1 thread (`OMP_NUM_THREADS=1`), and image dimensions are capped at 1200px, keeping RAM strictly within Render's 512MB cgroup limit.
4. **Automated Non-Root Migrations**: Boots as non-root `appuser` (uid 1000) via `entrypoint.sh`, automatically executing `alembic upgrade head` before serving requests.

#### Deployment Steps:
1. **Generate `SECRET_KEY` on Windows PowerShell**:
   Run the repository generator script or one-liner:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/generate_secret.ps1
   ```
   *(Or one-liner)*:
   ```powershell
   $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [BitConverter]::ToString($bytes).Replace('-','').ToLower()
   ```
   *Copy the 64-character hex key.*
2. **Log into Render**:
   - Navigate to [dashboard.render.com](https://dashboard.render.com).
3. **Create Web Service**:
   - Click **New +** &rarr; **Web Service**.
   - Select **Build and deploy from a Git repository** &rarr; click **Next**.
   - Connect your GitHub repository: `FinancialManager`.
4. **Configure Web Service Settings**:
   - **Name**: `finance-flow-api`
   - **Region**: Choose region closest to your databases (e.g. `Ohio (US East)` or `Oregon (US West)`).
   - **Branch**: `main`
   - **Root Directory**: leave blank (empty).
   - **Runtime**: Select **Docker**.
   - **Dockerfile Path**: `backend/Dockerfile`
   - **Docker Context**: `backend`
   - **Instance Type / Plan**: Select **Free** (512 MB RAM, 0.1 CPU).
5. **Add Environment Variables**:
   Under the **Environment Variables** section, enter the following key-value pairs:

   | Key | Value |
   | :--- | :--- |
   | `ENVIRONMENT` | `production` |
   | `DATABASE_URL` | *[Neon Pooled URL with `-pooler.` from Phase 1]* |
   | `DATABASE_URL_DIRECT` | *[Neon Direct URL without `-pooler.` from Phase 1]* |
   | `SECRET_KEY` | *[64-character hex key from Step 1]* |
   | `ALGORITHM` | `HS256` |
   | `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` |
   | `STORAGE_BACKEND` | `s3` |
   | `S3_ENDPOINT_URL` | `https://<YOUR_PROJECT_REF>.supabase.co/storage/v1/s3` |
   | `S3_REGION` | `us-east-1` *(or your Supabase region)* |
   | `S3_BUCKET` | `invoices` |
   | `S3_ACCESS_KEY_ID` | *[Supabase Storage S3 Access Key ID from Phase 2]* |
   | `S3_SECRET_ACCESS_KEY` | *[Supabase Storage S3 Secret Access Key from Phase 2]* |
   | `FRONTEND_ORIGINS` | `http://localhost:3000` *(temporary placeholder until Vercel deploy)* |
   | `FRONTEND_PREVIEW_REGEX` | `^https://finance-flow-ai(-[a-zA-Z0-9_-]+)*\.vercel\.app$` |
   | `OCR_CONCURRENCY` | `1` |
   | `OCR_MAX_IMAGE_DIM` | `1200` |
   | `OCR_TIMEOUT_SECONDS` | `90` |

6. **Create and Deploy**:
   - Click **Create Web Service** (or **Deploy Web Service**).
7. **Verify Deployment Logs**:
   - Open the **Logs** tab in Render.
   - Confirm Docker build completes successfully.
   - Confirm container startup runs Alembic migrations:
     ```text
     === Finance Flow AI Backend Container Startup ===
     Executing Alembic database migrations on configured database...
     INFO  [alembic.runtime.migration] Running upgrade  -> 45ba9372002a, initial_schema
     INFO  [alembic.runtime.migration] Running upgrade 45ba9372002a -> b2e4f6a89c01, async_status_and_indexes
     Starting Uvicorn server on 0.0.0.0:10000...
     Application startup complete.
     ```
   - Copy your Render Service URL (e.g. `https://finance-flow-api.onrender.com`).

---

### Phase 4: Deploy Frontend on Vercel (Next.js 15)

1. **Sign in to Vercel**:
   - Navigate to [vercel.com](https://vercel.com) and log in.
2. **Add New Project**:
   - Click **Add New...** &rarr; **Project**.
   - Import the `FinancialManager` repository.
3. **Configure the Project**:
   - **Framework Preset**: Next.js (auto-detected).
   - **Root Directory**: Click **Edit** &rarr; select `frontend` &rarr; click **Continue**.
4. **Configure Environment Variables**:
   - Expand the **Environment Variables** section.
   - Add the following variable:
     - **Name**: `NEXT_PUBLIC_API_URL`
     - **Value**: `https://finance-flow-api.onrender.com` *(your Render backend URL from Phase 3, without a trailing slash)*
     - **Target Environments**: Check all (Production, Preview, Development).
5. **Deploy**:
   - Click **Deploy**.
   - Wait ~60 seconds for Next.js 15 compile, static page generation, and edge distribution to finish.
6. **Capture Production URL**:
   - Once deployment completes, note your assigned production domain (e.g. `https://finance-flow-ai.vercel.app` or `https://finance-flow-ai-seven.vercel.app`).

---

### Phase 5: Update CORS Allowed Origins on Render

Now that the final Vercel frontend URL is known, update the backend's allowed origins to enable cross-origin requests.

1. **Open Render Dashboard**:
   - Go to [dashboard.render.com](https://dashboard.render.com) &rarr; select your `finance-flow-api` service.
2. **Navigate to Environment**:
   - Click the **Environment** tab on the left menu.
3. **Update `FRONTEND_ORIGINS`**:
   - Locate `FRONTEND_ORIGINS`.
   - Update its value with your exact Vercel URL:
     ```text
     https://your-production-app.vercel.app,http://localhost:3000
     ```
   - > [!CAUTION]
     > Ensure there are **NO trailing slashes** (e.g. `https://app.vercel.app`, NOT `https://app.vercel.app/`). Browser `Origin` headers never include trailing slashes, and an extra slash will cause browser CORS rejections.
4. **Save Changes**:
   - Click **Save Changes**. Render will automatically restart the service with the updated CORS policy.

---

### Phase 6: Pre-Flight Validation & Smoke Testing

#### Step 1: Pre-Flight Environment Validator
Run the pre-deployment validator locally to check for common misconfigurations without exposing secrets:
```powershell
python scripts/validate_env.py backend/.env
```
Ensure all checks pass with `[PASS]`.

#### Step 2: Browser Smoke Test
1. Open your production frontend URL in a browser: `https://your-app.vercel.app`.
2. Notice the instant dashboard loading or graceful cold-start notification.
3. Click **Sign in** &rarr; **Create your organization account**.
4. Register a new administrator account (e.g. `admin@yourcompany.com`).
   - *Confirms that production starts with zero demo accounts and requires an explicit tenant registration.*
5. Navigate to **Upload** and upload an invoice PDF or image.
6. View the uploaded document:
   - Click on the invoice in the list to open the detail view.
   - Verify the original invoice renders inline in the PDF/image viewer panel.
7. Perform a human review override:
   - Enter a mandatory audit note: `Approved after verifying vendor purchase order.`
   - Click **Approve**.
   - Verify the decision changes and the audit trail entry appears in the audit log.

#### Step 3: Automated Live Smoke Test (`scripts/test_live_render.py`)
Run the comprehensive automated verification suite against your live Render backend:
```powershell
$env:RENDER_API_URL = "https://finance-flow-api.onrender.com"
python scripts/test_live_render.py
```

What the script executes:
1. **Health Probe**: Measures cold-start latency against `/api/health` and queries `/api/health/ready` for DB and OCR engine status.
2. **Hermetic Tenant Creation**: Registers an isolated test tenant (`render_verifier_<timestamp>@verification.test`) to prevent polluting production data.
3. **Progressive Document Ingestion**: Ingests test samples in increasing file size, polling until completion.
4. **Human Review Override**: Verifies that empty audit notes return HTTP 422, then submits an approved review with an audit note.
5. **Audit Trail Verification**: Queries `/api/invoices/<id>/audit` to confirm immutable audit records.
6. **Summary Table**: Outputs an end-to-end report with latency and decision metrics.

---

## 3. Post-Deployment Monitoring & Health Inspection

### What to Look for in Render Logs:
- **Startup**:
  ```text
  === Finance Flow AI Backend Container Startup ===
  Executing Alembic database migrations on configured database...
  INFO  [alembic.runtime.migration] Running upgrade  -> 45ba9372002a, initial_schema
  INFO  [alembic.runtime.migration] Running upgrade 45ba9372002a -> b2e4f6a89c01, async_status_and_indexes
  Starting Uvicorn server on 0.0.0.0:10000...
  INFO: Application startup complete.
  ```
- **Job Recovery**:
  ```text
  INFO: Initializing application schema and directories...
  INFO: Warm up RapidOCR model at startup
  ```
- **Live Ingestion**:
  ```text
  INFO: Accepted invoice upload id=1 filename=sample_invoice.pdf (size=125430 bytes)
  INFO: Invoice id=1 file loaded from storage in 0.12s
  INFO: Invoice id=1 OCR finished in 1.45s (lines=32)
  INFO: Invoice id=1 extraction & validation finished in 0.02s
  INFO: Completed invoice id=1 decision=APPROVE
  ```

### What to Look for in the Render "Metrics" Tab:
1. **Memory Usage**:
   - **Idle Working Set**: 160 MB – 220 MB.
   - **Peak Working Set during Heavy OCR**: 340 MB – 420 MB.
   - **Safety Boundary**: The free tier limit is **512 MB**. The application is tuned to stay below 450 MB. If memory ever reaches 512 MB, Render will terminate the process with exit code 137 (OOMKilled).
2. **CPU Usage**:
   - Bursts up to 100% during ONNX model inference (1-4 seconds per page).
   - Drops back down to 0% – 5% immediately following inference completion.
3. **HTTP Status Codes**:
   - `200 OK` for reads and authentication.
   - `202 Accepted` for async document uploads.
   - `422 Unprocessable Entity` for intentional validation errors (e.g. blank review note).
   - **No 502 Bad Gateway or 504 Gateway Timeout**: If 502 appears, check the logs for container memory crashes.
