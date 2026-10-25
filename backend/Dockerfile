# syntax=docker/dockerfile:1
FROM python:3.11-slim

# System configuration and low-memory performance tuning
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
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
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download and cache RapidOCR model weights at BUILD time so container starts instantly
RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR()"

# Copy application source
COPY . /app

# Ensure proper file ownership and permissions for non-root user
RUN chmod +x /app/entrypoint.sh && \
    chown -R appuser:appuser /app /home/appuser

USER 1000

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
