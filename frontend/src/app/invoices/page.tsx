"use client";

import { useEffect, useState, useCallback } from "react";
import { Navbar } from "@/components/Navbar";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  History,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ApiError,
  fetchInvoices,
  reviewInvoice,
  fetchAuditTrail,
  type InvoiceRow,
  type AuditLogEntry,
} from "@/lib/api";

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DECISION_BADGE: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  APPROVE: {
    label: "Approved",
    className: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    icon: CheckCircle2,
  },
  REJECT: {
    label: "Rejected",
    className: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
    icon: AlertTriangle,
  },
  "PENDING REVIEW": {
    label: "Pending review",
    className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    icon: Clock,
  },
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination
  const [activeTab, setActiveTab] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Review Modal State
  const [reviewingInvoice, setReviewingInvoice] = useState<InvoiceRow | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  // Audit Modal State
  const [auditInvoice, setAuditInvoice] = useState<InvoiceRow | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Read initial search param from URL on client mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const q = urlParams.get("search");
      if (q) setSearch(q);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const decision = activeTab === "ALL" || activeTab === "DUPLICATES" ? undefined : activeTab;
      const isDuplicate = activeTab === "DUPLICATES" ? true : undefined;
      const data = await fetchInvoices({
        decision,
        is_duplicate: isDuplicate,
        search: search.trim() || undefined,
        page,
        page_size: pageSize,
      });
      setInvoices(data);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : "Failed to load invoices.");
    } finally {
      setLoading(false);
    }
  }, [activeTab, search, page]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  async function handleReviewSubmit(decision: "APPROVE" | "REJECT") {
    if (!reviewingInvoice) return;
    setSubmittingReview(true);
    try {
      await reviewInvoice(reviewingInvoice.id, decision, reviewNotes);
      setReviewingInvoice(null);
      setReviewNotes("");
      loadInvoices();
      window.dispatchEvent(new Event("finance-flow:refresh"));
    } catch (err) {
      alert(err instanceof ApiError ? (err.detail ?? err.message) : "Failed to submit review.");
    } finally {
      setSubmittingReview(false);
    }
  }

  async function openAuditModal(inv: InvoiceRow) {
    setAuditInvoice(inv);
    setLoadingAudit(true);
    try {
      const logs = await fetchAuditTrail(inv.id);
      setAuditLogs(logs);
    } catch {
      setAuditLogs([]);
    } finally {
      setLoadingAudit(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
              Invoices & Review Queue
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Search, inspect verification audits, and resolve human-review decisions.
            </p>
          </div>
          <button
            type="button"
            onClick={loadInvoices}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
          >
            Refresh
          </button>
        </div>

        {/* Tab Filters & Search */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50/50 p-1 dark:border-zinc-800 dark:bg-zinc-900/50">
            {[
              { id: "ALL", label: "All Invoices" },
              { id: "PENDING REVIEW", label: "Review Queue" },
              { id: "APPROVE", label: "Approved" },
              { id: "REJECT", label: "Rejected" },
              { id: "DUPLICATES", label: "Duplicates" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setPage(1);
                }}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="search"
              placeholder="Search vendor, invoice #, file..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>
        </div>

        {/* Table Content */}
        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          {error ? (
            <div className="p-8 text-center text-sm">
              <p className="font-medium text-zinc-900 dark:text-zinc-50">Could not load invoices</p>
              <p className="mt-1 text-xs text-zinc-500">{error}</p>
              <button
                type="button"
                onClick={loadInvoices}
                className="mt-4 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <div className="p-12 text-center text-sm text-zinc-500">
              <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
              Loading invoices...
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-12 text-center text-sm">
              <p className="font-medium text-zinc-900 dark:text-zinc-50">No invoices found</p>
              <p className="mt-1 text-xs text-zinc-500">
                {search ? "Try tweaking your search term." : "Upload invoices on the dashboard to populate this queue."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-900 dark:text-zinc-400">
                    <th className="px-6 py-3.5">Invoice #</th>
                    <th className="px-6 py-3.5">Vendor</th>
                    <th className="px-6 py-3.5 text-right">Total</th>
                    <th className="px-6 py-3.5">Decision</th>
                    <th className="px-6 py-3.5">Storage</th>
                    <th className="px-6 py-3.5">Created</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {invoices.map((inv) => {
                    const badge = DECISION_BADGE[inv.decision ?? ""] ?? DECISION_BADGE["PENDING REVIEW"];
                    const BadgeIcon = badge.icon;
                    return (
                      <tr
                        key={inv.id}
                        className="text-zinc-700 transition-colors hover:bg-zinc-50/60 dark:text-zinc-200 dark:hover:bg-zinc-900/50"
                      >
                        <td className="whitespace-nowrap px-6 py-3 font-mono text-xs font-medium text-zinc-900 dark:text-zinc-50">
                          {inv.invoice_number || inv.filename || `#${inv.id}`}
                          {inv.is_duplicate && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              Duplicate
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 font-medium">
                          {inv.vendor || "—"}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                          {formatCurrency(inv.total)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                              badge.className
                            )}
                          >
                            <BadgeIcon className="h-3 w-3" />
                            {badge.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                          {inv.storage_type === "s3" ? (
                            <span className="inline-flex items-center gap-1 text-blue-600">
                              Cloud S3
                            </span>
                          ) : inv.is_ephemeral ? (
                            <span className="text-amber-600" title="Local container disk; wipes on restart">
                              Ephemeral Local
                            </span>
                          ) : (
                            <span>Local Disk</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                          {formatDate(inv.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-right text-xs">
                          <div className="flex items-center justify-end gap-2">
                            {inv.decision === "PENDING REVIEW" && (
                              <button
                                type="button"
                                onClick={() => setReviewingInvoice(inv)}
                                className="rounded-md bg-blue-600 px-2.5 py-1 font-medium text-white shadow-sm hover:bg-blue-700"
                              >
                                Review
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openAuditModal(inv)}
                              className="rounded-md border border-zinc-200 p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:hover:bg-zinc-900"
                              title="Audit Trail"
                            >
                              <History className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-3 text-xs text-zinc-500 dark:border-zinc-900">
            <span>Page {page}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-zinc-200 px-2 py-1 font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={invoices.length < pageSize}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-zinc-200 px-2 py-1 font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Review Modal */}
      {reviewingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-900">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                Human Review: Invoice #{reviewingInvoice.id}
              </h2>
              <button
                type="button"
                onClick={() => setReviewingInvoice(null)}
                className="rounded p-1 text-zinc-400 hover:text-zinc-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-zinc-500">Vendor:</span>{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {reviewingInvoice.vendor || "Unknown"}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Invoice #:</span>{" "}
                  <span className="font-mono font-medium text-zinc-900 dark:text-zinc-50">
                    {reviewingInvoice.invoice_number || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Total:</span>{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {formatCurrency(reviewingInvoice.total)}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Risk Level:</span>{" "}
                  <span className="font-medium text-amber-600">
                    {reviewingInvoice.risk_level || "MEDIUM"}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Reviewer Notes & Justification
                </label>
                <textarea
                  rows={3}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="e.g. Verified with purchase order #10248; vendor bank details match ERP."
                  className="mt-1 w-full rounded-lg border border-zinc-200 p-2.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-900">
              <button
                type="button"
                onClick={() => setReviewingInvoice(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingReview}
                onClick={() => handleReviewSubmit("REJECT")}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                Reject Invoice
              </button>
              <button
                type="button"
                disabled={submittingReview}
                onClick={() => handleReviewSubmit("APPROVE")}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                Approve Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Modal */}
      {auditInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-900">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                Audit Trail: Invoice #{auditInvoice.id}
              </h2>
              <button
                type="button"
                onClick={() => setAuditInvoice(null)}
                className="rounded p-1 text-zinc-400 hover:text-zinc-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 max-h-80 overflow-y-auto">
              {loadingAudit ? (
                <p className="py-4 text-center text-xs text-zinc-500">Loading audit events...</p>
              ) : auditLogs.length === 0 ? (
                <p className="py-4 text-center text-xs text-zinc-500">No audit events recorded.</p>
              ) : (
                <ol className="relative border-l border-zinc-200 ml-2 dark:border-zinc-800">
                  {auditLogs.map((log) => (
                    <li key={log.id} className="mb-4 ml-4">
                      <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-blue-600 dark:border-zinc-950" />
                      <time className="mb-1 text-[10px] font-normal leading-none text-zinc-400">
                        {formatDate(log.created_at)}
                      </time>
                      <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                        Action: {log.action}
                      </h3>
                      {log.previous_state && log.new_state && (
                        <p className="text-[11px] text-zinc-500">
                          Status changed: {log.previous_state} → {log.new_state}
                        </p>
                      )}
                      {log.notes && (
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          {log.notes}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="mt-4 flex justify-end border-t border-zinc-100 pt-3 dark:border-zinc-900">
              <button
                type="button"
                onClick={() => setAuditInvoice(null)}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
