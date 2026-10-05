/**
 * Typed client for the Finance Flow AI FastAPI backend.
 *
 * Supports authentication, file uploads (images + digital PDFs),
 * human-review queues, audit trails, and paginated queries.
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(
  /\/+$/,
  "",
);

// ---------------------------------------------------------------------------
// Types
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
  is_duplicate?: boolean;
  storage_type?: string;
  is_ephemeral?: boolean;
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  created_at: string | null;
};

export type AuditLogEntry = {
  id: number;
  action: string;
  previous_state: string | null;
  new_state: string | null;
  notes: string | null;
  user_id: number | null;
  created_at: string | null;
};

export type StatsResponse = {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
};

export type InsightsResponse = {
  top_vendor: string;
  approval_rate: number;
  high_value_count: number;
  accuracy: number;
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
  id?: number;
  filename: string;
  status: "uploaded" | "processed";
  is_duplicate?: boolean;
  file_hash?: string;
  storage_type?: string;
  is_ephemeral?: boolean;
  ocr?: Record<string, unknown>;
  fields?: ExtractedFields;
  validation?: ValidationResult;
  decision?: DecisionResult;
};

export type UserProfile = {
  id: number;
  email: string;
  full_name: string | null;
  role: string;
  organization_id?: number | null;
  organization_name?: string | null;
};

// ---------------------------------------------------------------------------
// Token Management
// ---------------------------------------------------------------------------

const TOKEN_KEY = "finance_flow_auth_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

export function clearStoredToken(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
  }
}

// ---------------------------------------------------------------------------
// Fetch Helpers
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
  const token = getStoredToken();
  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...authHeaders,
        ...(init?.headers ?? {}),
      },
    });
  } catch (cause) {
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
      // response wasn't JSON
    }
    throw new ApiError(
      response.status,
      detail ?? `Request failed (${response.status})`,
      detail,
    );
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Endpoint Wrappers
// ---------------------------------------------------------------------------

export function fetchStats(): Promise<StatsResponse> {
  return jsonFetch<StatsResponse>("/stats");
}

export function fetchInsights(days?: number): Promise<InsightsResponse> {
  const qs = days ? `?days=${days}` : "";
  return jsonFetch<InsightsResponse>(`/insights${qs}`);
}

export type InvoicesQuery = {
  decision?: string;
  search?: string;
  is_duplicate?: boolean;
  page?: number;
  page_size?: number;
};

export function fetchInvoices(params?: InvoicesQuery): Promise<InvoiceRow[]> {
  const query = new URLSearchParams();
  if (params?.decision) query.set("decision", params.decision);
  if (params?.search) query.set("search", params.search);
  if (params?.is_duplicate !== undefined) query.set("is_duplicate", String(params.is_duplicate));
  if (params?.page) query.set("page", String(params.page));
  if (params?.page_size) query.set("page_size", String(params.page_size));

  const qs = query.toString();
  return jsonFetch<InvoiceRow[]>(`/invoices${qs ? `?${qs}` : ""}`);
}

export function uploadInvoice(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return jsonFetch<UploadResponse>("/upload", {
    method: "POST",
    body: formData,
  });
}

export function reviewInvoice(
  invoiceId: number,
  decision: "APPROVE" | "REJECT",
  notes?: string,
): Promise<{ id: number; decision: string; risk_level: string; review_notes?: string }> {
  return jsonFetch(`/invoices/${invoiceId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, notes }),
  });
}

export function fetchAuditTrail(invoiceId: number): Promise<AuditLogEntry[]> {
  return jsonFetch<AuditLogEntry[]>(`/invoices/${invoiceId}/audit`);
}

export function fetchCurrentUser(): Promise<UserProfile> {
  return jsonFetch<UserProfile>("/auth/me");
}
