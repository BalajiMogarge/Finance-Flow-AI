# syntax=docker/dockerfile:1
# Root Dockerfile for Finance Flow AI Backend (Repo-Root Build Context)
FROM python:3.11-slim

# System configuration and low-memory performance tuning
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    OCR_MAX_IMAGE_DIM=1200 \
    PORT=8000

# Install runtime dependencies for ONNX runtime, OpenCV, and container healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (uid 1000)
RUN useradd -m -u 1000 appuser

WORKDIR /app

# Install application dependencies
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download and cache RapidOCR model weights at BUILD time so container starts instantly
RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR()"

# Copy backend application source
COPY backend/ /app

# Ensure proper file ownership and permissions for non-root user
RUN chmod +x /app/entrypoint.sh && \
    chown -R appuser:appuser /app /home/appuser

USER 1000

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
