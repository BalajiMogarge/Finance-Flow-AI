"""OCR helpers built on top of EasyOCR.

We load the EasyOCR reader once at module import time so that every request
reuses the same in-memory model instead of paying the initialization cost
each time a file is uploaded.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image


# Languages to recognise. English is the default for invoices; add 'en' only
# to keep the model payload small. More locales can be appended later.
_OCR_LANGS: tuple[str, ...] = ("en",)


@lru_cache(maxsize=1)
def get_reader():
    """Return a cached EasyOCR Reader instance."""
    # gpu=False keeps the dependency surface small (no CUDA runtime required).
    # verbose=False silences EasyOCR's stdout banner on every cold start.
    import easyocr  # local import so the module loads even if easyocr is missing

    return easyocr.Reader(list(_OCR_LANGS), gpu=False, verbose=False)


def _load_image(path: Path) -> np.ndarray:
    """Load an image file into a numpy array suitable for EasyOCR."""
    with Image.open(path) as img:
        img.load()
        # EasyOCR expects a numpy ndarray; .copy() ensures the array owns its
        # data after the PIL image is closed.
        return np.array(img.convert("RGB"), copy=True)


def image_to_text(path: Path) -> dict:
    """Run OCR on a single image file.

    Returns a dict with the raw lines and the concatenated text. EasyOCR
    returns a list of (bbox, text, confidence) tuples per detected line.
    """
    reader = get_reader()
    image = _load_image(Path(path))
    results: Iterable = reader.readtext(image, detail=1, paragraph=False)

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

    return {
        "lines": lines,
        "text": full_text,
        "average_confidence": avg_confidence,
        "line_count": len(lines),
    }
