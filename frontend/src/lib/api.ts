/**
 * Typed client for the Finance Flow AI FastAPI backend.
 *
 * The dashboard lives on a different port (3000/3001) and the API
 * runs on 8000, so every call targets an absolute URL. A single
 * ``API_BASE`` constant makes it trivial to point the dashboard at a
 * staging environment without combing through the components.
 */

const API_BASE = "http://127.0.0.1:8000";

// ---------------------------------------------------------------------------
// Types — kept close to the FastAPI schemas in ``app/main.py`` and
// ``app/models.py``. Optional fields are modelled with ``| null`` so the
// rendering code can degrade gracefully when OCR doesn't recover a value.
// ---------------------------------------------------------------------------

export type InvoiceDecision =
  | "APPROVE"
  | "REJECT"
  | "PENDING REVIEW"
  | string;

export type InvoiceRow = {
  id: number;
  filename: string | null;
  vendor: string | null;
  invoice_number: string | null;
  gstin: string | null;
  total: number | null;
  decision: InvoiceDecision | null;
  confidence: number | null;
  risk_level: "LOW" | "MEDIUM" | "HIGH" | null;
  created_at: string | null;
};

export type StatsResponse = {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
};

export type ExtractedFields = {
  invoice_number?: string | null;
  vendor?: string | null;
  date?: string | null;
  gstin?: string | null;
  subtotal?: number | null;
  cgst?: number | null;
  sgst?: number | null;
  total?: number | null;
};

export type ValidationResult = {
  passed: boolean;
  errors: string[];
  warnings: string[];
};

export type DecisionResult = {
  decision: InvoiceDecision;
  confidence: number;
  reason: string;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
};

export type UploadResponse = {
  filename: string;
  saved_to?: string;
  status: "uploaded" | "processed";
  ocr?: Record<string, unknown>;
  fields?: ExtractedFields;
  validation?: ValidationResult;
  decision?: DecisionResult;
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (cause) {
    // Network failures (backend down, CORS, DNS) land here. Surface a
    // clear message rather than a raw ``TypeError``.
    throw new ApiError(
      0,
      "Could not reach the Finance Flow AI backend. Is it running on :8000?",
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const body = await response.json();
      if (body && typeof body === "object" && "detail" in body) {
        detail = String((body as { detail: unknown }).detail);
      }
    } catch {
      // ignore — the response wasn't JSON; we'll just use the status text
    }
    throw new ApiError(
      response.status,
      `Request failed (${response.status})`,
      detail,
    );
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Endpoint wrappers
// ---------------------------------------------------------------------------

export function fetchStats(): Promise<StatsResponse> {
  return jsonFetch<StatsResponse>("/stats");
}

export function fetchInvoices(): Promise<InvoiceRow[]> {
  return jsonFetch<InvoiceRow[]>("/invoices");
}

export function uploadInvoice(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return jsonFetch<UploadResponse>("/upload", {
    method: "POST",
    body: formData,
  });
}
