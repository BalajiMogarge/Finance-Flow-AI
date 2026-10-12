# Finance Flow AI - Backend Service

High-performance, containerized FastAPI backend for invoice verification, extraction, and automated financial audit workflows. Engineered for low-memory environments (such as Render 512 MB free tier) and offline local backups.

## Architecture & Technology Stack

- **Framework**: FastAPI (Python 3.11) with Uvicorn ASGI server
- **Database**: Neon Serverless PostgreSQL with PgBouncer connection pooling (`psycopg3`) & Alembic migrations
- **File Storage**: S3-compatible private object store (Neon Object Storage or Supabase Storage) with presigned URLs (`boto3`)
- **Text Extraction**: Dual-engine extraction pipeline
  - **Fast-Path**: `pypdf` for digital vector PDFs (<150 ms, negligible RAM)
  - **Fallback OCR**: `rapidocr_onnxruntime` (ONNX Runtime CPU, ~14 MB quantized models, peak RAM < 285 MB)
- **Rules Engine**: 100% deterministic decision logic (tax reconciliation, vendor verification, GSTIN checksum, tolerance bounds)

## Running Locally

### Option A: Direct Python (No Docker, Offline Ready)

1. Create and activate a virtual environment:
   ```bash
   python -m venv .venv
   # Windows:
   .venv\Scripts\activate
   # Linux/macOS:
   source .venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Configure environment variables (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

4. Run database migrations:
   ```bash
   alembic upgrade head
   ```

5. Start the FastAPI server:
   ```bash
   uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
   ```

### Option B: Docker Compose (Backend + PostgreSQL)

```bash
docker compose up --build
```
