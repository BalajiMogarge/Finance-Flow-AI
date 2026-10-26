#!/usr/bin/env bash
# Render Native Build Script for Finance Flow AI Backend
set -o errexit

echo "=== Installing Python Dependencies ==="
python -m pip install --upgrade pip
pip install -r requirements.txt

# Strictly enforce headless OpenCV so libGL.so.1 / X11 shared libraries are never required on Render
pip uninstall -y opencv-python opencv-contrib-python 2>/dev/null || true
pip install --no-cache-dir "opencv-python-headless>=4.8.0"

# Pre-cache RapidOCR ONNX model weights during the build phase so runtime requests start immediately
echo "=== Pre-warming RapidOCR ONNX Models ==="
python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR()"

# Run Alembic migrations if connection string is configured
if [ -n "$DATABASE_URL" ]; then
    echo "=== Executing Database Migrations ==="
    MIGRATION_URL="${DATABASE_URL_DIRECT:-$DATABASE_URL}"
    DATABASE_URL_DIRECT="$MIGRATION_URL" DATABASE_URL="$MIGRATION_URL" alembic upgrade head || {
        echo "Notice: Alembic migration reported an error (or DB unreachable during build); proceeding..."
    }
fi

echo "=== Build Complete ==="
