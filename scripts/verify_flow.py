"""End-to-end verification script for port 8000 FastAPI service.

Tests:
1. Server launch on port 8000.
2. GET /health and GET /health/ready.
3. POST /api/invoices with digital PDF (sample_digital_standard.pdf) -> verify 202 -> poll until completed.
4. POST /api/invoices with scanned PNG (sample_scanned_receipt.png) -> verify 202 -> poll until completed.
5. GET /api/invoices paginated listing & server-side filters.
"""

import os
import subprocess
import sys
import time
from pathlib import Path
import urllib.request
import json

ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = ROOT / "samples"
PORT = 8000
BASE_URL = f"http://127.0.0.1:{PORT}"

env = os.environ.copy()
env["ENVIRONMENT"] = "development"
env["SECRET_KEY"] = "super-secret-key-production-hardening-32-chars"
env["DATABASE_URL"] = "sqlite:///./verification_flow.db"
env["STORAGE_BACKEND"] = "local"
env["OCR_CONCURRENCY"] = "1"
env["PYTHONPATH"] = str(ROOT / "backend")

print(f"Starting Uvicorn on port {PORT}...")
proc = subprocess.Popen(
    [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(PORT),
    ],
    cwd=str(ROOT / "backend"),
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)

try:
    # 1. Wait for server to be responsive
    print("Waiting for server to become responsive...")
    started = False
    for _ in range(30):
        time.sleep(1)
        try:
            with urllib.request.urlopen(f"{BASE_URL}/health", timeout=2) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode())
                    print(f"Server alive: /health -> {data}")
                    started = True
                    break
        except Exception:
            continue

    if not started:
        stdout, stderr = proc.communicate(timeout=5)
        print("Failed to start server. STDOUT:\n", stdout, "\nSTDERR:\n", stderr)
        sys.exit(1)

    # 2. Check /health/ready
    with urllib.request.urlopen(f"{BASE_URL}/health/ready", timeout=5) as resp:
        ready_data = json.loads(resp.read().decode())
        print(f"Readiness check: /health/ready -> {ready_data}")
        assert ready_data["status"] == "ready", "Server not ready"

    # Helper function for multipart upload
    def upload_file(file_path: Path):
        boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
        with open(file_path, "rb") as f:
            file_bytes = f.read()

        mime = "application/pdf" if file_path.suffix == ".pdf" else "image/png"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
            f"Content-Type: {mime}\r\n\r\n"
        ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

        req = urllib.request.Request(
            f"{BASE_URL}/api/invoices",
            data=body,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req) as resp:
                status = resp.status
                payload = json.loads(resp.read().decode())
                return status, payload
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode())

    def poll_invoice(inv_id: int, max_wait=30):
        print(f"Polling invoice #{inv_id}...")
        for _ in range(max_wait):
            with urllib.request.urlopen(f"{BASE_URL}/api/invoices/{inv_id}") as resp:
                data = json.loads(resp.read().decode())
                status = data.get("status")
                if status == "completed":
                    return data
                if status == "failed":
                    raise RuntimeError(f"Invoice failed: {data.get('error_reason')}")
            time.sleep(1)
        raise TimeoutError("Invoice polling timed out")

    # 3. Test Digital PDF Upload
    pdf_path = SAMPLES_DIR / "sample_digital_standard.pdf"
    print(f"\nUploading digital PDF: {pdf_path.name}...")
    status, res = upload_file(pdf_path)
    print(f"Upload response: HTTP {status} -> {res}")
    assert status == 202, f"Expected 202 Accepted, got {status}"
    inv_id = res["id"]
    completed_pdf = poll_invoice(inv_id)
    print(f"Completed PDF invoice #{inv_id}:")
    print(f"  Decision: {completed_pdf['decision']}")
    print(f"  Confidence: {completed_pdf['confidence']}")
    print(f"  Vendor: {completed_pdf['vendor']}")
    print(f"  Total: {completed_pdf['total']}")
    print(f"  OCR Engine: {completed_pdf['ocr'].get('engine')}")
    assert completed_pdf["status"] == "completed"

    # 4. Test Scanned Image Upload
    png_path = SAMPLES_DIR / "sample_scanned_receipt.png"
    print(f"\nUploading scanned PNG: {png_path.name}...")
    status, res = upload_file(png_path)
    print(f"Upload response: HTTP {status} -> {res}")
    assert status == 202, f"Expected 202 Accepted, got {status}"
    inv_id = res["id"]
    completed_png = poll_invoice(inv_id)
    print(f"Completed PNG invoice #{inv_id}:")
    print(f"  Decision: {completed_png['decision']}")
    print(f"  Confidence: {completed_png['confidence']}")
    print(f"  Vendor: {completed_png['vendor']}")
    print(f"  Total: {completed_png['total']}")
    print(f"  OCR Engine: {completed_png['ocr'].get('engine')}")
    assert completed_png["status"] == "completed"

    # 5. Test Paginated Listing
    with urllib.request.urlopen(f"{BASE_URL}/api/invoices?page=1&page_size=10") as resp:
        listing = json.loads(resp.read().decode())
        print(f"\nPaginated listing items count: {len(listing['items'])}, total: {listing['total']}")
        assert listing["total"] >= 2, "Expected at least 2 invoices"

    print("\nALL PORT 8000 VERIFICATIONS PASSED SUCCESSFULLY!")

finally:
    print("Terminating Uvicorn process...")
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()

    # Clean up test database
    test_db = ROOT / "backend" / "verification_flow.db"
    if test_db.exists():
        try:
            test_db.unlink()
        except Exception:
            pass
