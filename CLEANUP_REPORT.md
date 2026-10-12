# Cleanup Report - Finance Flow AI Restructuring

This report lists all files and directories identified for removal during Phase 1 of the production hardening and deployment restructuring (Render -> Hugging Face Spaces + Vercel + Neon + Supabase Storage).

All deletions will be executed in a single commit on branch `production-hardening` to ensure straightforward revertability.

## 1. Tracked Files to be Deleted

| File Path | Verification Status | One-line Reason |
| :--- | :--- | :--- |
| `render.yaml` | Zero code imports; Render blueprint only | Render deployment configuration is obsolete under the Hugging Face Spaces Docker target. |
| `.python-version` | Zero code imports; Render runtime pin | Root Python version pin used solely for Render build environment detection. |
| `backend/.python-version` | Zero code imports; Render runtime pin | Backend Python version pin used solely for Render build environment detection. |
| `neon.ts` | Zero code imports; references nonexistent Neon storage buckets | Dead configuration file; Neon provides Lakebase Postgres but no native object storage buckets. |
| `package.json` (root) | Contains only `@neon/config` and `@neon/env` | Root package definition created exclusively for `neon.ts`; frontend has its own `frontend/package.json`. |
| `package-lock.json` (root) | Lockfile for `@neon/config` and `@neon/env` | Unused lockfile corresponding to the removed root package.json. |
| `alembic.ini` (root) | Zero code imports; duplicates `backend/alembic.ini` | Redundant root Alembic configuration; canonical configuration is located at `backend/alembic.ini`. |
| `docs/API.md` | Outdated API doc referencing Render endpoints | Replaced in Phase 4 with OpenAPI-aligned documentation reflecting async 202 processing. |
| `docs/ARCHITECTURE.md` | Outdated architecture referencing Render & SQLite | Replaced in Phase 4 with target architecture (HF Spaces + Vercel + Neon + Supabase Storage). |
| `docs/DEMO_GUIDE.md` | Outdated demo guide referencing Render 512MB RAM | Replaced in Phase 4 with up-to-date end-to-end demo guide. |
| `docs/DEPLOYMENT.md` | Outdated deployment guide with Render steps | Replaced in Phase 4 with step-by-step target deployment guide. |
| `docs/DEVELOPER_GUIDE.md` | Outdated developer guide referencing SQLite | Replaced in Phase 4 with updated local development guide using Docker Compose. |

## 2. Local & Ephemeral Artifacts to be Purged

| Path | Category | Reason |
| :--- | :--- | :--- |
| `backend/finance_flow.db` | Local Database | Ephemeral SQLite database file used during early local testing. |
| `backend/uploads/` | Uploads Folder | Ephemeral directory containing 30 orphaned test image files from development. |
| `node_modules/` (root) | Node Modules | Local node modules installed exclusively for root `@neon/config`. |
| `.pytest_cache/`, `backend/.pytest_cache/` | Cache | Python test cache directories. |
| `**/__pycache__/` | Cache | Python compiled bytecode directories across `backend/`. |

## 3. Retained & Created Assets

- **Retained**: All application source code (`backend/app/*`, `frontend/src/*`), database models, Alembic migrations (`backend/alembic/*`), test suites (`backend/tests/*`), configuration templates (`.env.example`), `LICENSE`, and `.gitignore`.
- **Created**: `samples/` directory populated with 5 sanitized sample invoices for automated tests, demonstrations, and validation.
