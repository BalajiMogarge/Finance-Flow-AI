---
title: Finance Flow AI Backend
emoji: 💸
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Finance Flow AI - Backend Service

High-performance, containerized FastAPI backend for invoice verification, extraction, and automated financial audit workflows.

## Architecture

- **Runtime**: FastAPI in Docker container on Hugging Face Spaces (CPU Basic)
- **Port**: 7860 (Hugging Face default)
- **Database**: Neon Serverless PostgreSQL with connection pooling & Alembic migrations
- **Storage**: S3-compatible private object store (Supabase Storage) with presigned URLs
- **Text Extraction**: High-speed digital PDF parsing via `pypdf`, backed by CPU-only `EasyOCR`
- **Decisions**: 100% deterministic rules engine (zero LLM in the approval path)

## Local Development

Run the entire stack locally with Docker Compose:

```bash
docker compose up --build
```
