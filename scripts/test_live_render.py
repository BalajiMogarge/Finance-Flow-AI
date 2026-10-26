#!/usr/bin/env python3
"""Finance Flow AI - Live Render Deployment Verification Script

Validates the deployed backend on Render (or any remote URL):
- Measures cold start latency on first request
- Verifies system health (/api/health)
- Registers a temporary test tenant to avoid polluting production data
- Progressively ramps up file uploads from smallest/simplest to heavy stress samples
- Immediately halts at the first sign of HTTP error (502/503/504) or timeout
- Tests human review override with mandatory audit note
- Inspects audit trail records and invoice listing
- Outputs clear summary table with latencies, decisions, and memory advice

Configuration is read strictly from environment variables:
    RENDER_API_URL: Base URL of the backend (e.g. https://finance-flow-backend.onrender.com)
    RENDER_TEST_PASSWORD: Password for the test user (defaults to auto-generated temporary password)
    RENDER_REQUEST_TIMEOUT: Max timeout per OCR request in seconds (default: 150)
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any

import requests


def format_size(bytes_num: int) -> str:
    if bytes_num < 1024:
        return f"{bytes_num} B"
    elif bytes_num < 1024 * 1024:
        return f"{bytes_num / 1024:.1f} KB"
    return f"{bytes_num / (1024 * 1024):.2f} MB"


def run_live_verification() -> int:
    base_url = os.environ.get("RENDER_API_URL", "").rstrip("/")
    if not base_url:
        print("[!] ERROR: RENDER_API_URL environment variable is required.")
        print("    Example: export RENDER_API_URL=https://finance-flow-backend.onrender.com")
        print("    (Windows PowerShell: $env:RENDER_API_URL='https://finance-flow-backend.onrender.com')")
        return 1

    timeout = int(os.environ.get("RENDER_REQUEST_TIMEOUT", "150"))
    test_password = os.environ.get("RENDER_TEST_PASSWORD", f"TestSecret!{int(time.time())}")
    timestamp = int(time.time())
    test_email = f"render_verifier_{timestamp}@verification.test"
    test_org = f"Render Live Verification {timestamp}"

    project_root = Path(__file__).resolve().parent.parent
    samples_dir = project_root / "samples"
    if not samples_dir.exists():
        print(f"[!] ERROR: samples directory not found at {samples_dir}")
        return 1

    print("=" * 78)
    print("        FINANCE FLOW AI - LIVE RENDER DEPLOYMENT VERIFICATION")
    print("=" * 78)
    print(f"Target URL:        {base_url}")
    print(f"Test Tenant:       {test_org}")
    print(f"Timeout per job:   {timeout}s")
    print(f"Samples Directory: {samples_dir}")
    print("=" * 78)

    session = requests.Session()
    session.headers.update({"User-Agent": "FinanceFlowAI-RenderVerifier/1.0"})

    # -------------------------------------------------------------
    # Step 1: Health Check & Cold Start Measurement
    # -------------------------------------------------------------
    print("\n[1/5] Checking backend health and measuring cold-start latency...")
    t_start = time.time()
    try:
        health_resp = session.get(f"{base_url}/api/health", timeout=timeout)
        health_time = time.time() - t_start
    except requests.exceptions.RequestException as e:
        print(f"[!] FAILED to reach {base_url}/api/health: {e}")
        print("    If Render is spinning up from sleep, this may take up to 60 seconds.")
        return 1

    if health_resp.status_code != 200:
        print(f"[!] Health check returned HTTP {health_resp.status_code}: {health_resp.text}")
        return 1

    health_data = health_resp.json()
    print(f"[+] Server responded in {health_time:.2f}s (Cold-start response time)")
    print(f"    Health details: status={health_data.get('status')} | ocr={health_data.get('ocr')} | db={health_data.get('database')} | storage={health_data.get('storage')}")

    # -------------------------------------------------------------
    # Step 2: Fresh Tenant Registration
    # -------------------------------------------------------------
    print("\n[2/5] Creating dedicated verification tenant and user...")
    reg_payload = {
        "email": test_email,
        "password": test_password,
        "organization_name": test_org,
    }
    try:
        reg_resp = session.post(f"{base_url}/api/auth/register", json=reg_payload, timeout=30)
    except requests.exceptions.RequestException as e:
        print(f"[!] Registration network failure: {e}")
        return 1

    if reg_resp.status_code not in {200, 201}:
        print(f"[!] Registration failed with HTTP {reg_resp.status_code}: {reg_resp.text}")
        return 1

    auth_data = reg_resp.json()
    access_token = auth_data.get("access_token")
    if not access_token:
        print("[!] No access_token returned in registration response!")
        return 1

    auth_headers = {"Authorization": f"Bearer {access_token}"}
    session.headers.update(auth_headers)
    print(f"[+] Tenant initialized: {test_org} (User: {test_email})")

    # -------------------------------------------------------------
    # Step 3: Progressive Upload & Ingestion Ramp-Up
    # -------------------------------------------------------------
    print("\n[3/5] Ingesting sample invoices (ramping up from small to heavy)...")

    # Sort files by size so light digital PDFs process first, followed by heavier images
    all_files = [f for f in samples_dir.glob("*") if f.is_file() and f.suffix.lower() in {".png", ".jpg", ".jpeg", ".pdf"}]
    all_files.sort(key=lambda p: p.stat().st_size)

    results: list[dict[str, Any]] = []
    pending_review_id: int | None = None
    first_invoice_id: int | None = None

    for idx, file_path in enumerate(all_files, 1):
        file_size = file_path.stat().st_size
        size_str = format_size(file_size)
        file_name = file_path.name
        content_type = "application/pdf" if file_path.suffix.lower() == ".pdf" else "image/png"

        print(f"  [{idx:02d}/{len(all_files):02d}] Uploading {file_name[:35]:<35} ({size_str:>8})...", end="", flush=True)

        t_up = time.time()
        try:
            with open(file_path, "rb") as f:
                upload_resp = session.post(
                    f"{base_url}/api/invoices",
                    files={"file": (file_name, f.read(), content_type)},
                    timeout=60,
                )
        except requests.exceptions.RequestException as e:
            print(f" FAIL (Network: {e})")
            print("[!] Halting tests immediately to protect Render instance.")
            return 1

        if upload_resp.status_code != 202:
            print(f" FAIL (HTTP {upload_resp.status_code}: {upload_resp.text[:80]})")
            print("[!] Unexpected upload status. Halting.")
            return 1

        inv_id = upload_resp.json().get("id")
        if first_invoice_id is None:
            first_invoice_id = inv_id

        # Poll until invoice pipeline finishes
        status = "processing"
        decision = None
        risk = None
        vendor = None
        error_msg = None
        poll_start = time.time()

        while time.time() - poll_start < timeout:
            try:
                poll_resp = session.get(f"{base_url}/api/invoices/{inv_id}", timeout=30)
                if poll_resp.status_code == 200:
                    data = poll_resp.json()
                    status = data.get("status", "processing")
                    if status in {"completed", "failed"}:
                        decision = data.get("decision")
                        risk = data.get("risk_level")
                        vendor = data.get("vendor")
                        error_msg = data.get("error_reason")
                        if decision == "PENDING REVIEW" and pending_review_id is None:
                            pending_review_id = inv_id
                        break
                elif poll_resp.status_code >= 500:
                    print(f" FAIL (HTTP {poll_resp.status_code} during polling)")
                    print("[!] Server error during OCR/extraction. Halting.")
                    return 1
            except requests.exceptions.RequestException as e:
                print(f" FAIL (Polling error: {e})")
                return 1
            time.sleep(1.5)

        total_elapsed = time.time() - t_up

        if status == "processing":
            print(f" TIMEOUT ({total_elapsed:.1f}s)")
            print("[!] Pipeline timed out on Render. Halting.")
            return 1
        elif status == "failed":
            print(f" FAILED in {total_elapsed:.1f}s (Reason: {error_msg})")
        else:
            dec_label = f"{decision} ({risk})" if decision else "DONE"
            print(f" OK in {total_elapsed:>5.1f}s | {dec_label:<20} | Vendor: {str(vendor)[:18]}")

        results.append({
            "id": inv_id,
            "filename": file_name,
            "size_str": size_str,
            "elapsed_s": total_elapsed,
            "status": status,
            "decision": decision or "NONE",
            "risk": risk or "-",
        })

    # -------------------------------------------------------------
    # Step 4: Human Review Override with Mandatory Note
    # -------------------------------------------------------------
    print("\n[4/5] Testing human review workflow & audit trail...")
    target_review_id = pending_review_id or first_invoice_id

    if target_review_id:
        # 1. Verify blank note validation rejection (422)
        blank_resp = session.post(
            f"{base_url}/api/invoices/{target_review_id}/review",
            json={"decision": "APPROVE", "notes": ""},
            timeout=30,
        )
        if blank_resp.status_code != 422:
            print(f"[!] Warning: Blank review note expected HTTP 422, got {blank_resp.status_code}")
        else:
            print("[+] Blank note correctly rejected with HTTP 422")

        # 2. Submit valid review override
        review_note = f"Automated live verification test by auditor at {time.strftime('%Y-%m-%d %H:%M:%S')}"
        valid_resp = session.post(
            f"{base_url}/api/invoices/{target_review_id}/review",
            json={"decision": "APPROVE", "notes": review_note},
            timeout=30,
        )
        if valid_resp.status_code == 200:
            print(f"[+] Successfully approved invoice #{target_review_id} with audit note")
        else:
            print(f"[!] Review submission failed: {valid_resp.status_code} {valid_resp.text}")

        # 3. Check audit trail
        audit_resp = session.get(f"{base_url}/api/invoices/{target_review_id}/audit", timeout=30)
        if audit_resp.status_code == 200:
            audit_records = audit_resp.json()
            print(f"[+] Audit trail verified: {len(audit_records)} entry(ies) recorded")
        else:
            print(f"[!] Failed to fetch audit trail: {audit_resp.status_code}")

    # -------------------------------------------------------------
    # Step 5: Final Summary & Render Metrics Advice
    # -------------------------------------------------------------
    print("\n[5/5] Compiling Verification Results...")
    print("\n" + "=" * 78)
    print("                  LIVE RENDER DEPLOYMENT RESULTS")
    print("=" * 78)
    print(f"Backend URL:             {base_url}")
    print(f"Cold-Start Response:     {health_time:.2f}s")
    print(f"Total Invoices Tested:   {len(results)}")
    print(f"Success Count:           {sum(1 for r in results if r['status'] == 'completed')}/{len(results)}")
    print("-" * 78)
    print(f"{'Filename':<36} | {'Size':>9} | {'Latency':>7} | {'Decision':<14} | {'Risk'}")
    print("-" * 78)
    for r in results:
        print(f"{r['filename'][:36]:<36} | {r['size_str']:>9} | {r['elapsed_s']:>6.1f}s | {r['decision']:<14} | {r['risk']}")
    print("=" * 78)
    print("\n[i] RENDER DASHBOARD METRICS ADVICE:")
    print("    1. Open your Render Dashboard -> Your Service -> 'Metrics' tab.")
    print("    2. Observe 'Memory Usage': under 512MB RAM, the usage graph should stay below")
    print("       380-450 MB. If usage exceeds 512MB, Render triggers an out-of-memory kill (exit 137).")
    print("    3. Observe 'CPU Usage': RapidOCR will burst CPU to 100% during ONNX inference")
    print("       and immediately return to baseline once OCR finishes.")
    print("    4. If the service enters sleep, the first request will take ~30-50s to wake up.")
    print("=" * 78)

    return 0


if __name__ == "__main__":
    sys.exit(run_live_verification())
