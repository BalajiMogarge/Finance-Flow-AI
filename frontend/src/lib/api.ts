/**
 * Typed API client for the Finance Flow AI FastAPI backend.
 *
 * Implements:
 * - Production-safe base URL resolution (fails loudly if NEXT_PUBLIC_API_URL is missing in prod)
 * - Exponential backoff retry on cold starts, network errors, and 502/503 responses
 * - Automatic 401 handling (clears token, redirects to /login)
 * - Async upload (202 Accepted) with sequential polling until completion
 * - Presigned URL and audit trail access
 */

export function getApiBase(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!envUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CRITICAL: NEXT_PUBLIC_API_URL environment variable is missing in production. " +
        "Configure NEXT_PUBLIC_API_URL pointing to your Hugging Face Space backend (e.g. https://your-space.hf.space)."
      );
    }
    return "http://127.0.0.1:7860";
  }
  return envUrl.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvoiceDecision =
  | "APPROVE"
  | "REJECT"
  | "PENDING REVIEW"
  | string;

export type InvoiceStatus = "processing" | "completed" | "failed";

export type InvoiceRow = {
  id: number;
  filename: string | null;
  status?: InvoiceStatus | string;
  error_reason?: string | null;
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

export type ValidationCheck = {
  name: string;
  passed: boolean;
  message?: string;
};

export type ValidationResult = {
  passed: boolean;
  errors: string[];
  warnings: string[];
  checks?: ValidationCheck[];
};

export type DecisionResult = {
  decision: InvoiceDecision;
  confidence: number;
  reason: string;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
};

export type InvoiceDetail = InvoiceRow & {
  file_url?: string | null;
  fields?: ExtractedFields;
  validation?: ValidationResult;
  decision_details?: DecisionResult;
  ocr?: Record<string, unknown>;
  extracted_data?: {
    fields?: ExtractedFields;
    validation?: ValidationResult;
    decision?: DecisionResult;
    ocr?: Record<string, unknown>;
  };
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

export type UploadAcceptedResponse = {
  id: number;
  filename: string;
  status: "processing" | "completed" | "failed";
  is_duplicate?: boolean;
  message: string;
};

export type UploadResponse = {
  id?: number;
  filename: string;
  status: "uploaded" | "processed" | "processing" | "completed" | "failed";
  is_duplicate?: boolean;
  file_hash?: string;
  storage_type?: string;
  is_ephemeral?: boolean;
  ocr?: Record<string, unknown>;
  fields?: ExtractedFields;
  validation?: ValidationResult;
  decision?: DecisionResult;
  file_url?: string | null;
};

export type UserProfile = {
  id: number;
  email: string;
  full_name: string | null;
  role: string;
  organization_id?: number | null;
  organization_name?: string | null;
};

export type PaginatedInvoicesResponse = {
  items: InvoiceRow[];
  total: number;
  page: number;
  page_size: number;
};

// ---------------------------------------------------------------------------
// Token Management
// ---------------------------------------------------------------------------

const TOKEN_KEY = "finance_flow_auth_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Storage might be restricted
    }
  }
}

export function clearStoredToken(): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage might be restricted
    }
  }
}

export function logout(): void {
  clearStoredToken();
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

// ---------------------------------------------------------------------------
// Fetch Helpers with Retry & Error Handling
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

type FetchOptions = RequestInit & {
  retries?: number;
  timeoutMs?: number;
  skipAuthRedirect?: boolean;
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function jsonFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { retries = 2, timeoutMs = 25000, skipAuthRedirect = false, ...init } = options;
  const baseUrl = getApiBase();
  const url = `${baseUrl}${path}`;

  const token = getStoredToken();
  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders["Authorization"] = `Bearer ${token}`;
  }

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...authHeaders,
          ...(init?.headers ?? {}),
        },
      });

      clearTimeout(timerId);

      // Handle 401 Unauthorized
      if (response.status === 401) {
        clearStoredToken();
        if (!skipAuthRedirect && typeof window !== "undefined" && window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
        throw new ApiError(401, "Session expired. Please log in again.");
      }

      // Retry on server cold start / gateway errors (502, 503)
      if ((response.status === 502 || response.status === 503) && attempt < retries) {
        attempt++;
        const backoff = Math.min(1000 * Math.pow(2, attempt), 6000);
        await sleep(backoff);
        continue;
      }

      if (!response.ok) {
        let detail: string | undefined;
        try {
          const body = await response.json();
          if (body && typeof body === "object" && "detail" in body) {
            detail = String((body as { detail: unknown }).detail);
          }
        } catch {
          // not JSON
        }
        throw new ApiError(
          response.status,
          detail ?? `Request failed with status ${response.status}`,
          detail
        );
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timerId);

      // Do not retry 401 or client errors
      if (err instanceof ApiError && err.status < 500) {
        throw err;
      }

      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < retries) {
        attempt++;
        const backoff = Math.min(1000 * Math.pow(2, attempt), 6000);
        await sleep(backoff);
        continue;
      }
      break;
    }
  }

  const isNetwork = lastError?.name === "AbortError" || lastError?.message?.includes("fetch");
  const friendlyMsg = isNetwork
    ? `Unable to connect to the backend at ${baseUrl}. The server may be waking up or offline.`
    : (lastError?.message || "Request failed");

  throw new ApiError(0, friendlyMsg, lastError?.message);
}

// ---------------------------------------------------------------------------
// Health Probes
// ---------------------------------------------------------------------------

export async function checkHealth(): Promise<{ status: string }> {
  return jsonFetch<{ status: string }>("/health", { retries: 0, timeoutMs: 5000 });
}

export async function checkReady(): Promise<{ status: string; database?: string; ocr_model?: string }> {
  return jsonFetch<{ status: string; database?: string; ocr_model?: string }>("/health/ready", {
    retries: 1,
    timeoutMs: 10000,
  });
}

// ---------------------------------------------------------------------------
// Auth Endpoints
// ---------------------------------------------------------------------------

export async function loginUser(email: string, password: string): Promise<{ access_token: string; token_type: string }> {
  const result = await jsonFetch<{ access_token: string; token_type: string }>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    skipAuthRedirect: true,
  });
  if (result.access_token) {
    setStoredToken(result.access_token);
  }
  return result;
}

export async function registerUser(data: {
  email: string;
  password: string;
  full_name?: string;
  organization_name?: string;
}): Promise<{ access_token: string; token_type: string }> {
  const result = await jsonFetch<{ access_token: string; token_type: string }>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    skipAuthRedirect: true,
  });
  if (result.access_token) {
    setStoredToken(result.access_token);
  }
  return result;
}

export function fetchCurrentUser(): Promise<UserProfile> {
  return jsonFetch<UserProfile>("/auth/me");
}

// ---------------------------------------------------------------------------
// Invoice Query & Detail Endpoints
// ---------------------------------------------------------------------------

export type InvoicesQuery = {
  status?: string;
  decision?: string;
  vendor?: string;
  start_date?: string;
  end_date?: string;
  search?: string;
  is_duplicate?: boolean;
  page?: number;
  page_size?: number;
};

export async function fetchInvoices(params?: InvoicesQuery): Promise<PaginatedInvoicesResponse> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.decision) query.set("decision", params.decision);
  if (params?.vendor) query.set("vendor", params.vendor);
  if (params?.start_date) query.set("start_date", params.start_date);
  if (params?.end_date) query.set("end_date", params.end_date);
  if (params?.search) query.set("search", params.search);
  if (params?.is_duplicate !== undefined) query.set("is_duplicate", String(params.is_duplicate));
  if (params?.page) query.set("page", String(params.page));
  if (params?.page_size) query.set("page_size", String(params.page_size));

  const qs = query.toString();
  const raw = await jsonFetch<PaginatedInvoicesResponse | InvoiceRow[]>(`/api/invoices${qs ? `?${qs}` : ""}`);

  if (Array.isArray(raw)) {
    return {
      items: raw,
      total: raw.length,
      page: params?.page ?? 1,
      page_size: params?.page_size ?? raw.length,
    };
  }

  return raw;
}

export function fetchInvoice(id: number): Promise<InvoiceDetail> {
  return jsonFetch<InvoiceDetail>(`/api/invoices/${id}`);
}

export function fetchAuditTrail(invoiceId: number): Promise<AuditLogEntry[]> {
  return jsonFetch<AuditLogEntry[]>(`/api/invoices/${invoiceId}/audit`);
}

export function reviewInvoice(
  invoiceId: number,
  decision: "APPROVE" | "REJECT",
  notes: string,
): Promise<{ id: number; decision: string; risk_level: string; review_notes?: string }> {
  if (!notes || !notes.trim()) {
    throw new ApiError(400, "Review notes are required to explain human review decision.");
  }
  return jsonFetch(`/api/invoices/${invoiceId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, notes: notes.trim() }),
  });
}

// ---------------------------------------------------------------------------
// Async Upload & Polling Pipeline
// ---------------------------------------------------------------------------

export async function postInvoiceAsync(file: File): Promise<UploadAcceptedResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return jsonFetch<UploadAcceptedResponse>("/api/invoices", {
    method: "POST",
    body: formData,
  });
}

export async function pollInvoiceStatus(
  invoiceId: number,
  options: {
    pollIntervalMs?: number;
    maxAttempts?: number;
    onPoll?: (current: InvoiceDetail) => void;
  } = {}
): Promise<InvoiceDetail> {
  const { pollIntervalMs = 2000, maxAttempts = 45, onPoll } = options;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    await sleep(pollIntervalMs);

    try {
      const invoice = await fetchInvoice(invoiceId);
      onPoll?.(invoice);

      if (invoice.status === "completed") {
        return invoice;
      }

      if (invoice.status === "failed") {
        throw new ApiError(
          422,
          invoice.error_reason || `Invoice #${invoiceId} processing failed.`
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        throw err;
      }
      // If network transiently dropped during polling, keep polling
    }
  }

  throw new ApiError(408, `Invoice #${invoiceId} processing timed out after ${maxAttempts * (pollIntervalMs / 1000)}s.`);
}

export async function uploadAndPollInvoice(
  file: File,
  onStageChange?: (stage: "uploading" | "extracting" | "validating" | "completed" | "failed") => void
): Promise<UploadResponse> {
  onStageChange?.("uploading");
  const accepted = await postInvoiceAsync(file);

  // If duplicate was immediately detected and already processed
  if (accepted.status === "completed" || accepted.is_duplicate) {
    const finalDetail = await fetchInvoice(accepted.id);
    onStageChange?.("completed");
    return transformDetailToUploadResponse(finalDetail, accepted.is_duplicate);
  }

  onStageChange?.("extracting");

  let pollCount = 0;
  const finalDetail = await pollInvoiceStatus(accepted.id, {
    pollIntervalMs: 2000,
    maxAttempts: 45,
    onPoll: () => {
      pollCount++;
      if (pollCount > 2) {
        onStageChange?.("validating");
      }
    },
  });

  onStageChange?.("completed");
  return transformDetailToUploadResponse(finalDetail, accepted.is_duplicate);
}

function transformDetailToUploadResponse(detail: InvoiceDetail, isDuplicate?: boolean): UploadResponse {
  const fields = detail.fields || detail.extracted_data?.fields;
  const validation = detail.validation || detail.extracted_data?.validation;
  const decision = detail.decision_details || detail.extracted_data?.decision || {
    decision: detail.decision || "PENDING REVIEW",
    confidence: detail.confidence || 0,
    reason: "",
    risk_level: detail.risk_level || "MEDIUM",
  };

  return {
    id: detail.id,
    filename: detail.filename || "upload",
    status: (detail.status as UploadResponse["status"]) || "completed",
    is_duplicate: isDuplicate ?? detail.is_duplicate,
    storage_type: detail.storage_type,
    is_ephemeral: detail.is_ephemeral,
    file_url: detail.file_url,
    fields,
    validation,
    decision,
    ocr: detail.ocr || detail.extracted_data?.ocr,
  };
}

// ---------------------------------------------------------------------------
// Stats & Insights
// ---------------------------------------------------------------------------

export function fetchStats(): Promise<StatsResponse> {
  return jsonFetch<StatsResponse>("/stats");
}

export function fetchInsights(days?: number): Promise<InsightsResponse> {
  const qs = days ? `?days=${days}` : "";
  return jsonFetch<InsightsResponse>(`/insights${qs}`);
}
