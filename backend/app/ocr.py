"""OCR helpers built on top of RapidOCR (ONNX Runtime).

High-performance, lightweight optical character recognition designed for low-memory
environments (such as Render 512 MB free tier). Uses ONNX Runtime CPU inference
without PyTorch or heavy model architectures.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import os
from pathlib import Path

# Limit thread allocations to prevent memory fragmentation on low-RAM containers
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import numpy as np
from PIL import Image

from .config import settings

logger = logging.getLogger(__name__)

_engine: object | None = None
_ocr_semaphore = asyncio.Semaphore(settings.OCR_CONCURRENCY)


def init_ocr() -> None:
    """Initialize RapidOCR singleton once at startup and warm up ONNX runtime."""
    global _engine
    if _engine is not None:
        return

    from rapidocr_onnxruntime import RapidOCR

    logger.info("Initializing RapidOCR engine (ONNX Runtime CPU)...")
    _engine = RapidOCR()

    # Warm-up inference with a 32x32 blank canvas
    try:
        dummy_img = np.ones((32, 32, 3), dtype=np.uint8) * 255
        _engine(dummy_img)
        logger.info("RapidOCR warm-up completed successfully.")
    except Exception as exc:
        logger.warning("RapidOCR warm-up encountered non-critical error: %s", exc)


def is_ocr_ready() -> bool:
    """Return True if the OCR engine has been loaded into memory."""
    return _engine is not None


def get_reader():
    """Return the initialized RapidOCR instance, initializing if needed."""
    global _engine
    if _engine is None:
        init_ocr()
    return _engine


def _load_image(path: Path, max_dim: int = 1200) -> np.ndarray:
    """Load an image file into a numpy array, downscaling if oversized."""
    with Image.open(path) as img:
        img.load()
        if max(img.width, img.height) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        return np.array(img.convert("RGB"), copy=True)


def image_to_text(path: Path) -> dict:
    """Run RapidOCR on a single image file synchronously.

    Returns a dict with raw lines, concatenated text, average confidence,
    and line count, compatible with downstream extractors.
    """
    engine = get_reader()
    image = _load_image(Path(path), max_dim=settings.OCR_MAX_IMAGE_DIM)

    try:
        result, _elapse = engine(image)
    except Exception as exc:
        logger.error("RapidOCR extraction failed on %s: %s", path, exc)
        result = None

    lines = []
    confidences = []

    if result:
        for item in result:
            # item structure: [dt_boxes, text, score]
            if len(item) < 3:
                continue
            text = (item[1] or "").strip()
            if not text:
                continue
            try:
                conf = float(item[2])
            except (ValueError, TypeError):
                conf = 0.0

            lines.append({"text": text, "confidence": conf})
            confidences.append(conf)

    full_text = "\n".join(line["text"] for line in lines)
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

    del image
    gc.collect()

    return {
        "lines": lines,
        "text": full_text,
        "average_confidence": avg_confidence,
        "line_count": len(lines),
    }


async def async_image_to_text(path: Path) -> dict:
    """Run OCR in a worker thread under the concurrency semaphore."""
    async with _ocr_semaphore:
        return await asyncio.to_thread(image_to_text, path)
