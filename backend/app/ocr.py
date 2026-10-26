"""OCR helpers built on top of RapidOCR (ONNX Runtime).

High-performance, lightweight optical character recognition designed for low-memory
environments (such as Render 512 MB free tier). Uses ONNX Runtime CPU inference
without PyTorch or heavy model architectures.
"""

from __future__ import annotations

import asyncio
import gc
import io
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


def _configure_onnx_threading() -> None:
    """Enforce single-threaded execution in ONNX Runtime for low-vCPU environments.

    On cloud platforms like Render free tier (0.1 vCPU limit), ONNX Runtime defaults
    to querying host hardware concurrency (often 32-64 cores) and spawning dozens of
    threads. When 32-64 threads compete for a 0.1 vCPU quota, thread scheduling
    latency and mutex synchronization overhead cause inference to take > 120s.
    Enforcing intra_op_num_threads=1, inter_op_num_threads=1, and ORT_SEQUENTIAL
    eliminates thread thrashing, drastically accelerating execution on throttled CPUs.
    """
    try:
        import onnxruntime as ort
        from rapidocr_onnxruntime import utils as rocr_utils

        if getattr(rocr_utils.OrtInferSession, "_finance_flow_single_thread_patched", False):
            return

        def _patched_init(self, config):
            sess_opt = ort.SessionOptions()
            sess_opt.log_severity_level = 4
            sess_opt.enable_cpu_mem_arena = False
            sess_opt.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            sess_opt.intra_op_num_threads = 1
            sess_opt.inter_op_num_threads = 1
            sess_opt.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

            cpu_ep = "CPUExecutionProvider"
            cpu_provider_options = {"arena_extend_strategy": "kSameAsRequested"}
            ep_list = [(cpu_ep, cpu_provider_options)]

            self._verify_model(config["model_path"])
            self.session = ort.InferenceSession(
                config["model_path"],
                sess_options=sess_opt,
                providers=ep_list,
            )

        rocr_utils.OrtInferSession.__init__ = _patched_init
        rocr_utils.OrtInferSession._finance_flow_single_thread_patched = True
        logger.debug("Configured RapidOCR ONNX Runtime for single-threaded sequential execution.")
    except Exception as exc:
        logger.warning("Could not apply single-thread configuration to RapidOCR: %s", exc)


# Apply configuration at module import time
_configure_onnx_threading()


def init_ocr() -> None:
    """Initialize RapidOCR singleton once at startup and warm up ONNX runtime."""
    global _engine
    if _engine is not None:
        return

    _configure_onnx_threading()
    from rapidocr_onnxruntime import RapidOCR

    logger.info("Initializing RapidOCR engine (ONNX Runtime CPU, single-threaded)...")
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


def _load_image(source: Path | str | bytes, max_dim: int = 1000) -> np.ndarray:
    """Load an image (from bytes, Path, or str) into a numpy array, downscaling if oversized."""
    if isinstance(source, bytes):
        fp = io.BytesIO(source)
    else:
        fp = Path(source)

    with Image.open(fp) as img:
        img.load()
        if max(img.width, img.height) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        return np.array(img.convert("RGB"), copy=True)


def image_to_text(source: Path | str | bytes) -> dict:
    """Run RapidOCR on an image file path or in-memory bytes synchronously.

    Returns a dict with raw lines, concatenated text, average confidence,
    and line count, compatible with downstream extractors.
    """
    engine = get_reader()
    image = _load_image(source, max_dim=settings.OCR_MAX_IMAGE_DIM)

    try:
        result, _elapse = engine(image)
    except Exception as exc:
        source_desc = f"bytes[{len(source)}]" if isinstance(source, bytes) else str(source)
        logger.error("RapidOCR extraction failed on %s: %s", source_desc, exc)
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


async def async_image_to_text(source: Path | str | bytes) -> dict:
    """Run OCR in a worker thread under the concurrency semaphore."""
    async with _ocr_semaphore:
        return await asyncio.to_thread(image_to_text, source)
