"""OCR helpers built on top of EasyOCR with memory safeguards for 512 MB limits.

We load the EasyOCR reader once and cache it. Input images are downscaled if
they exceed reasonable dimensions, and inference is executed with PyTorch gradients
disabled and garbage collection triggered to strictly honor container memory limits.
"""

from __future__ import annotations

import asyncio
import gc
from functools import lru_cache
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image

from .config import settings

# Languages to recognise. English is default for invoices.
_OCR_LANGS: tuple[str, ...] = ("en",)

# Global semaphore to prevent concurrent EasyOCR inferences from exhausting memory
_ocr_semaphore = asyncio.Semaphore(settings.OCR_CONCURRENCY_LIMIT)


@lru_cache(maxsize=1)
def get_reader():
    """Return a cached EasyOCR Reader instance."""
    import easyocr

    return easyocr.Reader(list(_OCR_LANGS), gpu=False, verbose=False)


def _load_image(path: Path, max_dim: int = 1600) -> np.ndarray:
    """Load an image file into a numpy array, downscaling if oversized.

    Prevents massive resolution images (e.g. 4K/8K scans) from causing OOM
    spikes during PyTorch feature extraction.
    """
    with Image.open(path) as img:
        img.load()
        if max(img.width, img.height) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        return np.array(img.convert("RGB"), copy=True)


def image_to_text(path: Path) -> dict:
    """Run OCR on a single image file synchronously with memory safeguards.

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

    # Explicit cleanup to keep resident memory low on 512 MB instances
    del image
    gc.collect()

    return {
        "lines": lines,
        "text": full_text,
        "average_confidence": avg_confidence,
        "line_count": len(lines),
    }


async def async_image_to_text(path: Path) -> dict:
    """Run OCR in a worker thread under the concurrency semaphore.

    Guarantees the asyncio event loop remains non-blocking for all other requests.
    """
    async with _ocr_semaphore:
        return await asyncio.to_thread(image_to_text, path)
