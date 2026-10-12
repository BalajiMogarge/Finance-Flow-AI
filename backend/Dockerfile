# syntax=docker/dockerfile:1
FROM python:3.11-slim

# System configuration and performance
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    EASYOCR_MODULE_PATH=/app/models/easyocr \
    PORT=7860

# Install OpenCV and PyTorch runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (uid 1000 required for Hugging Face Spaces)
RUN useradd -m -u 1000 appuser

WORKDIR /app

# Upgrade pip and install CPU-only PyTorch
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install application dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

# Pre-download EasyOCR model weights into fixed directory at BUILD time
RUN mkdir -p /app/models/easyocr && \
    python -c "import easyocr; easyocr.Reader(['en'], gpu=False, model_storage_directory='/app/models/easyocr', verbose=True)"

# Copy application source
COPY . /app

# Ensure proper file ownership and permissions for non-root user
RUN chmod +x /app/entrypoint.sh && \
    chown -R appuser:appuser /app /home/appuser

USER 1000

EXPOSE 7860

ENTRYPOINT ["/app/entrypoint.sh"]
