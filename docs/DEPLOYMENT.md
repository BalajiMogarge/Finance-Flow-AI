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

The frontend does not currently read any environment variables
(there are no `process.env.*` references in the source). If you
intend to point the upload widget at a deployed backend, add a
variable and reference it from `UploadCard.tsx`:

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
| 404 on `/upload` from the browser | Frontend still hard-codes `http://127.0.0.1:8000` | Set `NEXT_PUBLIC_API_URL` and update `UploadCard.tsx` to read it. |
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

The repository does not currently ship a `requirements.txt`. Create
one at `backend/requirements.txt` with at least:

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

Then `pip install -r requirements.txt` is your build command.

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

## 3. SQLite considerations

The codebase does not yet use a database. When one is added,
SQLite is the simplest choice for low-traffic deployments:

* **Location:** commit a `.gitignore`d `backend/data.db` and mount a
  Render Persistent Disk at that path.
* **Connection string:** `sqlite:///./data.db` (relative to
  `UPLOAD_DIR`).
* **Concurrency:** SQLite serialises writes. For a multi-worker
  deployment, set `WEB_CONCURRENCY=1` or move to Postgres.
* **Backups:** snapshot the persistent disk on a schedule.

For production with multiple workers or replicas, prefer Postgres
(available as a Render Key-Value store) and set
`DATABASE_URL=postgresql://...` in the Render dashboard.

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
