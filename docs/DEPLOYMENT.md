# Deployment Guide

This document covers deploying Finance Flow AI:

* **Frontend → Vercel** (Next.js 15 App Router)
* **Backend → Render** (FastAPI + Uvicorn)
* **Storage → SQLite** (development) with a note on production-ready
  alternatives

The two services must be able to reach each other. The backend URL is
read by the frontend at `UploadCard.tsx:89` — change it (or set an
environment variable and read it) when you swap environments.

---

## 1. Frontend on Vercel

### 1.1 Repository setup

* Push the repository to GitHub.
* In Vercel, click **Add New → Project** and import the repository.
* Set **Root Directory** to `frontend/`.
* Framework preset: **Next.js** (auto-detected).

### 1.2 Build & start commands

Vercel auto-detects these for Next.js, but the canonical commands
(from `frontend/package.json`) are:

| Action        | Command       |
| ------------- | ------------- |
| Build         | `next build`  |
| Start (prod)  | `next start`  |
| Dev           | `next dev`    |

### 1.3 Environment variables

The frontend reads `NEXT_PUBLIC_API_URL` as the backend base URL:

| Name            | Example                                  | Purpose                                      |
| --------------- | ---------------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | `https://finance-flow-api.onrender.com` | Base URL prepended to `/upload` (and future endpoints). |

After changing the source to use the variable, redeploy.

### 1.4 CORS

`backend/app/main.py` lists the allowed CORS origins explicitly. Add
your Vercel deployment origin (e.g. `https://finance-flow-ai.vercel.app`)
to the `allow_origins` list and redeploy the backend.

### 1.5 Common Vercel errors and fixes

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| Build fails with `Module not found: Can't resolve '@/lib/cn'` | `tsconfig.json` paths not picked up | Confirm `"baseUrl"` / `"paths": {"@/*": ["./src/*"]}` is present (it already is). |
| Upload requests target localhost | `NEXT_PUBLIC_API_URL` is unset | Set `NEXT_PUBLIC_API_URL` to the deployed backend URL and redeploy. |
| `CORS policy: No 'Access-Control-Allow-Origin'` | Backend not redeployed with the Vercel origin | Add the origin to `allow_origins` in `main.py` and redeploy Render. |

---

## 2. Backend on Render

### 2.1 Service setup

* In Render, click **New → Web Service** and connect the repository.
* **Root Directory:** `backend`.
* **Runtime:** Python 3.
* **Build Command:** `pip install -r requirements.txt`
  (see [§2.3](#23-build-commands)).
* **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### 2.2 Environment variables

| Name              | Example                                | Purpose                                                        |
| ----------------- | -------------------------------------- | -------------------------------------------------------------- |
| `PYTHON_VERSION`  | `3.11.9`                               | Pin the Python version. EasyOCR's wheels work on 3.9–3.12.    |
| `PORT`            | `10000`                                | Render injects this automatically.                             |
| `WEB_CONCURRENCY` | `1`                                    | OCR is memory-heavy; keep at 1 unless you have measured headroom. |

### 2.3 Build commands

The repository ships `backend/requirements.txt`. Install it with:

```
fastapi
uvicorn[standard]
python-multipart
easyocr
numpy
pillow
pytest
httpx
```

> **Cold starts.** EasyOCR downloads model weights (~100 MB) on the
> first request after a cold start, which can take 30–60 seconds.
> Render free-tier instances sleep between requests; budget for this
> latency.

### 2.4 Start command

```
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

### 2.5 Persistent storage

The backend writes uploads to `backend/uploads/`. **On Render free and
standard tiers this filesystem is ephemeral** — uploaded files
disappear on every redeploy or instance recycle. For real persistence,
attach a Render Persistent Disk and point `UPLOAD_DIR` at it:

```python
# in app/main.py
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
```

Then set `UPLOAD_DIR=/var/data/uploads` in the Render dashboard.

### 2.6 Common Render errors and fixes

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| Build fails: `ERROR: Could not build wheels for easyocr` | Python version too new or wheels missing | Pin `PYTHON_VERSION=3.11.x`. EasyOCR's official wheels top out at Python 3.12. |
| `ModuleNotFoundError: No module named 'app.main'` | Start command run from repo root | Set **Root Directory** to `backend`. |
| First request times out at 60 s | EasyOCR downloading weights on cold start | Keep one warm ping (Render "Cron Job" hitting `/health` every 5 min), or upgrade to a plan that never sleeps. |
| `OSError: [Errno 28] No space left on device` | Uploads/ accumulating in ephemeral disk | Switch `UPLOAD_DIR` to a persistent disk and add a retention job. |
| `CORS policy: No 'Access-Control-Allow-Origin'` | Vercel origin not in `allow_origins` | Add it to `main.py` and redeploy. |
| `RuntimeError: Form data requires "python-multipart"` | Missing dependency | Add `python-multipart` to `requirements.txt`. |

---

## 3. SQLite persistence

The application uses a SQLite database (`finance_flow.db`) for storing processed invoices and generating analytics.

* **Location:** The database is stored in the `backend/` root.
* **Persistence on Render:** Since Render's filesystem is ephemeral, you **must** attach a Render Persistent Disk to the root of your backend service (or a specific data folder) to ensure that your invoices and statistics are not lost upon redeployment.
* **Concurrency:** SQLite serialises writes. For this reason, keep `WEB_CONCURRENCY=1` in your Render environment variables.
* **Backups:** Persistent disks on Render can be snapshotted to prevent data loss.

For production environments with higher traffic or multiple worker replicas, it is recommended to migrate to a managed PostgreSQL instance (available via Render) and update the `DATABASE_URL` in `backend/app/database.py`.

---

## 4. End-to-end deployment checklist

- [ ] Repository pushed to GitHub
- [ ] `backend/requirements.txt` created and committed
- [ ] Vercel project created, root = `frontend/`
- [ ] `NEXT_PUBLIC_API_URL` set in Vercel (after `UploadCard.tsx`
      is updated to read it)
- [ ] Render Web Service created, root = `backend/`
- [ ] `PYTHON_VERSION` pinned in Render
- [ ] Vercel origin added to `allow_origins` in `main.py` and pushed
- [ ] Persistent disk attached and `UPLOAD_DIR` pointed at it
- [ ] Smoke test: `curl https://<backend>.onrender.com/health` returns
      `{"status":"healthy"}`
- [ ] Upload an invoice from the deployed frontend and confirm the
      decision comes back

---

## 5. Local "deploy" rehearsal

Before going live, exercise the production wiring locally:

```bash
# Terminal 1 — backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Terminal 2 — frontend
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 npm run dev
```

Open `http://localhost:3000`, upload `backend/sample_invoice.png`,
and confirm the full pipeline returns a decision.
