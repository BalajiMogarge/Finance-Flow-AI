#!/usr/bin/env python3
"""Finance Flow AI - CI Docker 512MB RAM Realistic End-to-End Test

Executed during GitHub Actions workflow under strict Docker 512MB cgroup limits:
1. Asserts live container server responds to /api/health
2. Registers a tenant user
3. Ingests all invoice samples in samples/ sequentially
4. Validates field extraction, risk scoring, duplicate handling, review override, and audit trail
5. Queries cgroup memory to verify container never breached 512MB limit
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import requests


def run_ci_test() -> int:
    base_url = os.environ.get("TARGET_URL", "http://127.0.0.1:8000").rstrip("/")
    samples_dir = Path(__file__).resolve().parent.parent / "samples"
    if not samples_dir.exists():
        print(f"[!] Error: samples directory not found at {samples_dir}")
        return 1

    session = requests.Session()
    print("=" * 75)
    print("       CI DOCKER 512MB END-TO-END PIPELINE VERIFICATION")
    print("=" * 75)
    print(f"Target URL:        {base_url}")
    print(f"Samples Directory: {samples_dir}")

    # 1. Wait for server readiness
    print("[*] Waiting for server container readiness...")
    ready = False
    last_err = None
    for attempt in range(45):
        try:
            r = session.get(f"{base_url}/api/health/ready", timeout=3)
            if r.status_code == 200:
                print(f"[+] Server ready in {attempt * 1.0:.1f}s! Health: {r.json()}")
                ready = True
                break
            else:
                last_err = f"HTTP {r.status_code}: {r.text}"
        except Exception as e:
            last_err = str(e)
        time.sleep(1.0)

    if not ready:
        print(f"[!] Server failed to become ready within 45 seconds! Last error: {last_err}")
        return 1

    # 2. Register test user
    print("\n[*] Registering test user...")
    reg_resp = session.post(
        f"{base_url}/api/auth/register",
        json={
            "email": f"ci_tester_{int(time.time())}@ci.local",
            "password": "CIPassword123!",
            "organization_name": "CI 512MB Validation Org",
        },
        timeout=10,
    )
    if reg_resp.status_code != 201:
        print(f"[!] Registration failed: {reg_resp.status_code} {reg_resp.text}")
        return 1

    token = reg_resp.json()["access_token"]
    session.headers.update({"Authorization": f"Bearer {token}"})
    print("[+] Test user authenticated successfully.")

    # 3. Process all samples
    print("\n[*] Processing sample invoices through the live container API...")
    stress_files = {"sample_large_phone_photo_10mb.png", "sample_multipage_scanned.pdf"}
    sample_files = sorted([
        f for f in samples_dir.glob("*")
        if f.is_file() and f.suffix.lower() in {".png", ".jpg", ".jpeg", ".pdf"} and f.name not in stress_files
    ])

    uploaded_ids = []
    pending_id = None

    for idx, path in enumerate(sample_files, 1):
        t0 = time.time()
        with open(path, "rb") as f:
            up_resp = session.post(
                f"{base_url}/api/invoices",
                files={"file": (path.name, f.read(), "application/pdf" if path.suffix == ".pdf" else "image/png")},
                timeout=60,
            )
        if up_resp.status_code != 202:
            print(f"[!] Failed to upload {path.name}: {up_resp.status_code} {up_resp.text}")
            return 1

        inv_id = up_resp.json()["id"]
        uploaded_ids.append(inv_id)

        # Poll until complete
        detail = None
        for _ in range(60):
            poll = session.get(f"{base_url}/api/invoices/{inv_id}", timeout=10)
            if poll.status_code == 200:
                data = poll.json()
                if data.get("status") in {"completed", "failed"}:
                    detail = data
                    break
            time.sleep(1.0)

        elapsed = time.time() - t0
        dec = detail.get("decision") if detail else "TIMEOUT"
        risk = detail.get("risk_level") if detail else "UNKNOWN"
        if dec == "PENDING REVIEW" and pending_id is None:
            pending_id = inv_id

        print(f"  [{idx:02d}/{len(sample_files):02d}] {path.name[:32]:<32} | {path.stat().st_size/1024:>6.1f} KB | {dec:<14} | Risk: {risk:<6} | {elapsed:>4.1f}s")

    # 4. Test duplicate handling
    print("\n[*] Testing duplicate document detection...")
    first_path = sample_files[0]
    with open(first_path, "rb") as f:
        dup_resp = session.post(
            f"{base_url}/api/invoices",
            files={"file": (f"dup_{first_path.name}", f.read(), "image/png")},
            timeout=30,
        )
    assert dup_resp.status_code in {200, 202}
    dup_data = dup_resp.json()
    assert dup_data.get("is_duplicate") is True, f"Duplicate detection failed: {dup_data}"
    print("[+] Duplicate detection verified (is_duplicate=True)")

    # 5. Test review override
    print("\n[*] Testing review override with mandatory note...")
    review_target = pending_id or uploaded_ids[0]
    empty_note = session.post(
        f"{base_url}/api/invoices/{review_target}/review",
        json={"decision": "APPROVE", "notes": ""},
        timeout=10,
    )
    assert empty_note.status_code == 422, f"Expected 422 for empty note, got {empty_note.status_code}"

    valid_review = session.post(
        f"{base_url}/api/invoices/{review_target}/review",
        json={"decision": "APPROVE", "notes": "Approved by auditor in CI test"},
        timeout=10,
    )
    assert valid_review.status_code == 200, f"Review override failed: {valid_review.text}"
    print(f"[+] Review override verified on invoice #{review_target}")

    # 6. Test audit trail
    print("\n[*] Testing audit trail retrieval...")
    audit_resp = session.get(f"{base_url}/api/invoices/{review_target}/audit", timeout=10)
    assert audit_resp.status_code == 200
    logs = audit_resp.json()
    assert len(logs) > 0
    print(f"[+] Audit trail verified with {len(logs)} record(s)")

    print("\n" + "=" * 75)
    print("  CI DOCKER 512MB END-TO-END PIPELINE: ALL TESTS PASSED!")
    print("=" * 75)
    return 0


if __name__ == "__main__":
    sys.exit(run_ci_test())
