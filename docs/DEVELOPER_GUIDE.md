# Developer Guide

A practical onboarding document. After reading this you should be able
to: set up the repo, run both apps, run the tests, find your way
around the code, and understand how each stage of the pipeline
contributes to the final decision.

---

## 1. Prerequisites

| Tool                | Version             | Notes                                                         |
| ------------------- | ------------------- | ------------------------------------------------------------- |
| Python              | 3.10 – 3.12         | EasyOCR's official wheels top out at 3.12.                    |
| Node.js             | 18+ (LTS)           | Next.js 15 requires Node 18.18+; Node 20 LTS recommended.     |
| npm / pnpm / yarn   | npm 9+ is fine      | The repo only ships `package-lock.json`; use npm unless you regenerate. |
| Git                 | any recent          |                                                               |
| (Optional) CUDA     | n/a                 | EasyOCR runs on CPU by default (`gpu=False`).                 |

A `requirements.txt` is not yet checked in; create one when you set
the project up locally. The full list is in
[DEPLOYMENT.md](./DEPLOYMENT.md#23-build-commands).

---

## 2. Installation

### 2.1 Clone & branch

```bash
git clone https://github.com/<your-org>/FinancialManager.git
cd FinancialManager
```

### 2.2 Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install fastapi 'uvicorn[standard]' python-multipart easyocr numpy pillow pytest httpx
```

> **Heads up on first OCR run.** EasyOCR downloads the English CRAFT
> + CRNN weights the first time `get_reader()` is called. The download
> is ~100 MB and goes into `~/.EasyOCR/model/`. Subsequent imports
> use the cache.

### 2.3 Frontend

```bash
cd ../frontend
npm install
```

---

## 3. Running the apps

### 3.1 Backend (FastAPI / Uvicorn)

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

* `GET  http://127.0.0.1:8000/health` → liveness.
* `POST http://127.0.0.1:8000/upload` → invoice pipeline.
* `http://127.0.0.1:8000/docs` → interactive Swagger UI.

### 3.2 Frontend (Next.js)

```bash
cd frontend
npm run dev
```

The dev server defaults to `http://localhost:3000`. The upload card
hard-codes `http://127.0.0.1:8000/upload` — keep the backend on
`127.0.0.1:8000` (or update `UploadCard.tsx`).

The CORS allow-list in `main.py` already covers `localhost:3000`,
`localhost:3001`, `127.0.0.1:3000`, and `127.0.0.1:3001`.

---

## 4. Running the tests

```bash
cd backend
pytest -v
```

The test file `tests/test_decision.py` contains two classes:

* **`DecisionUnitTests`** — nine tests that exercise
  `make_decision` directly with hand-crafted fixtures. They cover
  the APPROVE path, all four REJECT triggers, all three PENDING
  REVIEW triggers, and the response shape contract.
* **`UploadEndpointTests`** — three tests that mount the FastAPI app
  via `fastapi.testclient.TestClient` and stub out `image_to_text`
  to verify the full `/upload` payload for approved, rejected, and
  pending-review scenarios.

The endpoint tests inject lightweight `sys.modules` stubs for
`numpy`, `PIL`, and `easyocr` so the test runner does not need the
real OCR stack installed. If you do install the full stack the
stubs are no-ops.

Expected output:

```
============================== 12 passed in 0.4s ===============================
```

---

## 5. Project structure

```
FinancialManager/
├── backend/
│   ├── app/
│   │   ├── decision.py     # decision engine
│   │   ├── extractor.py    # regex field extraction
│   │   ├── main.py         # FastAPI app + routes
│   │   ├── ocr.py          # EasyOCR wrapper
│   │   └── validator.py    # field validation
│   ├── tests/
│   │   └── test_decision.py
│   ├── uploads/            # runtime: persisted files
│   └── sample_invoice.png
├── frontend/
│   └── src/
│       ├── app/            # Next.js App Router
│       ├── components/     # UI building blocks
│       └── lib/            # cn() + dummy fixtures
└── docs/                   # this documentation
```

---

## 6. How each stage of the pipeline works

### 6.1 OCR — `app/ocr.py`

* The EasyOCR reader is loaded once and cached with
  `functools.lru_cache(maxsize=1)`. The cache means every request
  reuses the same in-process model.
* `image_to_text(path)` opens the file with Pillow, converts to RGB,
  hands the NumPy array to EasyOCR, and assembles three artefacts:
  * `lines` — list of `{text, confidence}`.
  * `text` — newline-joined OCR output.
  * `average_confidence` — arithmetic mean of all per-line
    confidences (the value the decision stage consults).
* Languages are configured via the `_OCR_LANGS` tuple near the top of
  the file. English (`"en"`) is the only language enabled by default.

### 6.2 Extraction — `app/extractor.py`

* `extract_invoice_fields(ocr_output)` reads the `text` key from the
  OCR result and runs an ordered list of regexes per field.
* Amounts are normalised to `float` by `_parse_number`, which
  understands Indian-style grouping (`1,23,456.78`) and tolerates
  the OCR common case of swapped `.` and `,` decimal marks.
* `vendor` falls back to the first short, mostly-letter line near
  the top of the document when no `From:` / `Sold by` label is
  found.
* The extractor never raises on missing fields — it returns
  `None` and the downstream validator/decision decides whether that
  matters.

### 6.3 Validation — `app/validator.py`

* `validate_invoice(fields)` returns a triple of
  `{passed, errors, warnings}`.
* **Errors** (hard failures) — missing `invoice_number`, missing
  `total`, malformed GSTIN, or `subtotal + cgst + sgst` differs
  from `total` by more than `₹1`.
* **Warnings** (soft flags) — missing optional `vendor` or `date`,
  or `total ≥ ₹200,000` (configurable via
  `HIGH_VALUE_THRESHOLD`).

### 6.4 Decision engine — `app/decision.py`

* `make_decision(validation, fields, confidence)` evaluates rules in
  a fixed precedence:
  1. **Reject** if the GSTIN is present but its checksum is invalid
     (real GSTN Luhn-style algorithm), `invoice_number` is missing,
     amounts don't add up, or `confidence < 0.40`.
  2. **Pending Review** if any policy warning is present, the
     confidence sits in `[0.40, 0.85)`, or any optional field
     (`vendor`, `date`, `gstin`) is missing.
  3. **Approve** if `validation.passed` is true *and* there are no
     warnings *and* `confidence ≥ 0.85`.
  4. **Fallback** — if validation did not pass but no hard error was
     raised, the result is also PENDING REVIEW (so a human can
     investigate) rather than silently approved.
* Thresholds live in module-level constants (`APPROVE_CONFIDENCE`,
  `REJECT_CONFIDENCE`) so ops can tune them without touching the
  rule logic.
* The response shape is fixed: `{decision, confidence, reason,
  risk_level}`.

### 6.5 Frontend upload — `src/components/UploadCard.tsx`

* Maintains a queue of `UploadedFile` objects in React state.
* Posts each file to `http://127.0.0.1:8000/upload` as
  `multipart/form-data` inside a `for` loop.
* Logs the response to the console and shows a generic
  `alert("Invoices uploaded successfully.")` on success. Wiring the
  response into the recent-invoices table is a pending follow-up.

---

## 7. Coding conventions

### 7.1 Python (backend)

* **Type hints everywhere.** Public functions have full annotations;
  helpers use `Optional` / `Iterable` from `typing`.
* **Module docstrings.** Each module starts with a short
  docstring describing its responsibility. See `app/ocr.py` or
  `app/extractor.py` for the template.
* **Section banners.** Multi-stage modules use comment banners like:

  ```python
  # ---------------------------------------------------------------------------
  # Number parsing
  # ---------------------------------------------------------------------------
  ```

  Keep them aligned at 75 columns for readability.
* **Constants first, helpers after, public API last.** Pattern is
  visible in `decision.py` and `extractor.py`.
* **Tolerant parsing, loud validation.** Extractors return `None`
  on miss; validators turn missing fields into errors; the decision
  stage maps errors to `REJECT`. This split keeps each stage
  focused.
* **Tests as documentation.** When you add a new decision rule,
  add a test that exercises it. The `DecisionUnitTests` class in
  `tests/test_decision.py` is the canonical place.

### 7.2 TypeScript / React (frontend)

* **App Router only.** There is no `pages/` directory.
* **Client boundary declared explicitly.** Components that use
  hooks or browser APIs start with `"use client";` (see
  `UploadCard.tsx`).
* **`cn()` for class merging.** It wraps `clsx` and is the only
  utility in `src/lib/cn.ts`. Don't use template literals for
  conditional classes.
* **Path alias `@/*` → `src/*`.** Set in `tsconfig.json`; use it
  for all imports inside `src/`.
* **Tailwind for styling.** Tailwind 4 is configured via
  `postcss.config.mjs`. Keep `globals.css` for base styles and
  Tailwind directives only.
* **Naming.** Components are `PascalCase`; helpers are `camelCase`;
  types are `PascalCase`. `cn` is intentionally short because it
  is called dozens of times per render.

---

## 8. Common development workflows

* **Add a new validation rule** — extend `validate_invoice` in
  `app/validator.py`, then add a test under
  `DecisionUnitTests` that exercises the new error or warning
  path.
* **Tune decision thresholds** — change `APPROVE_CONFIDENCE` and
  `REJECT_CONFIDENCE` in `app/decision.py`. The unit tests pin the
  current values; update them intentionally when the rules move.
* **Swap OCR provider** — replace `image_to_text` in `app/ocr.py`.
  Keep the return shape (`{lines, text, average_confidence,
  line_count}`) so the rest of the pipeline does not change.
* **Add a new field to the API response** — extend the return
  value of `/upload` in `main.py` and add the corresponding key to
  the test fixtures in `tests/test_decision.py`.
