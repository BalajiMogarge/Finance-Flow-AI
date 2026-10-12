"""OCR helpers built on top of EasyOCR.

Loads the EasyOCR reader once during application lifespan startup and warms it up
with a dummy image so subsequent inference runs with zero cold-start delay.
Input images are downscaled if they exceed OCR_MAX_IMAGE_DIM, and inference
runs under torch.no_grad() with concurrency controlled by OCR_CONCURRENCY.
"""

from __future__ import annotations

import asyncio
import gc
import logging
from collections.abc import Iterable
from pathlib import Path

import numpy as np
from PIL import Image

from .config import settings

logger = logging.getLogger(__name__)

# Languages to recognise. English is standard for invoices.
_OCR_LANGS: tuple[str, ...] = ("en",)

_reader: object | None = None
_ocr_semaphore = asyncio.Semaphore(settings.OCR_CONCURRENCY)


def init_ocr() -> None:
    """Initialize EasyOCR reader once at startup and warm up weights."""
    global _reader
    if _reader is not None:
        return

    import easyocr

    logger.info("Initializing EasyOCR reader (gpu=False)...")
    _reader = easyocr.Reader(
        list(_OCR_LANGS),
        gpu=False,
        model_storage_directory=settings.EASYOCR_MODULE_PATH,
        verbose=False,
    )

    # Warm-up inference with a 32x32 dummy image
    try:
        import torch

        dummy_img = np.ones((32, 32, 3), dtype=np.uint8) * 255
        with torch.no_grad():
            _reader.readtext(dummy_img, detail=0)
        logger.info("EasyOCR warm-up completed successfully.")
    except Exception as exc:
        logger.warning("EasyOCR warm-up encountered non-critical error: %s", exc)


def is_ocr_ready() -> bool:
    """Return True if the OCR reader model has been successfully loaded into memory."""
    return _reader is not None


def get_reader():
    """Return the initialized EasyOCR Reader instance, initializing if needed."""
    global _reader
    if _reader is None:
        init_ocr()
    return _reader


def _load_image(path: Path, max_dim: int = 1600) -> np.ndarray:
    """Load an image file into a numpy array, downscaling if oversized.

    Prevents ultra-high-resolution images (e.g. 4K/8K scans) from causing excessive
    memory allocation during PyTorch feature extraction.
    """
    with Image.open(path) as img:
        img.load()
        if max(img.width, img.height) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        return np.array(img.convert("RGB"), copy=True)


def image_to_text(path: Path) -> dict:
    """Run OCR on a single image file synchronously.

    Returns a dict with raw lines, concatenated text, average confidence,
    and line count.
    """
    reader = get_reader()
    image = _load_image(Path(path), max_dim=settings.OCR_MAX_IMAGE_DIM)

    try:
        import torch

        with torch.no_grad():
            results: Iterable = reader.readtext(
                image, detail=1, paragraph=False, batch_size=1
            )
    except (ImportError, AttributeError):
        results = reader.readtext(image, detail=1, paragraph=False)

    lines = []
    confidences = []
    for _bbox, text, conf in results:
        text = (text or "").strip()
        if not text:
            continue
        lines.append({"text": text, "confidence": float(conf)})
        confidences.append(float(conf))

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
