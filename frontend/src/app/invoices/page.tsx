"use client";

import { useEffect, useState, useCallback } from "react";
import { Navbar } from "@/components/Navbar";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ApiError,
  fetchInvoices,
  fetchInvoice,
  reviewInvoice,
  fetchAuditTrail,
  type InvoiceRow,
  type InvoiceDetail,
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

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
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

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  processing: {
    label: "Processing",
    className: "bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  },
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination
  const [activeTab, setActiveTab] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [vendorFilter, setVendorFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Selected Invoice for Full Details Drawer/Modal
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null);
  const [detailAuditLogs, setDetailAuditLogs] = useState<AuditLogEntry[]>([]);

  // Review Modal State
  const [reviewingInvoice, setReviewingInvoice] = useState<InvoiceRow | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);

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
      const statusParam = statusFilter === "ALL" ? undefined : statusFilter;

      const data = await fetchInvoices({
        decision,
        status: statusParam,
        vendor: vendorFilter.trim() || undefined,
        start_date: startDate ? `${startDate}T00:00:00Z` : undefined,
        end_date: endDate ? `${endDate}T23:59:59Z` : undefined,
        is_duplicate: isDuplicate,
        search: search.trim() || undefined,
        page,
        page_size: pageSize,
      });

      setInvoices(data.items);
      setTotalCount(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : "Failed to load invoices.");
    } finally {
      setLoading(false);
    }
  }, [activeTab, statusFilter, vendorFilter, startDate, endDate, search, page]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  async function openDetailModal(invId: number) {
    setSelectedInvoice(null);
    setDetailAuditLogs([]);
    try {
      const [detail, audit] = await Promise.all([
        fetchInvoice(invId),
        fetchAuditTrail(invId).catch(() => []),
      ]);
      setSelectedInvoice(detail);
      setDetailAuditLogs(audit);
    } catch (err) {
      alert(err instanceof ApiError ? (err.detail ?? err.message) : "Failed to load invoice details.");
    }
  }

  async function handleReviewSubmit(decision: "APPROVE" | "REJECT") {
    if (!reviewingInvoice) return;
    if (!reviewNotes.trim()) {
      setReviewError("A note explaining the review decision is strictly required.");
      return;
    }

    setSubmittingReview(true);
    setReviewError(null);
    try {
      await reviewInvoice(reviewingInvoice.id, decision, reviewNotes.trim());
      setReviewingInvoice(null);
      setReviewNotes("");
      loadInvoices();
      if (selectedInvoice && selectedInvoice.id === reviewingInvoice.id) {
        openDetailModal(reviewingInvoice.id);
      }
      window.dispatchEvent(new Event("finance-flow:refresh"));
    } catch (err) {
      setReviewError(err instanceof ApiError ? (err.detail ?? err.message) : "Failed to submit review.");
    } finally {
      setSubmittingReview(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
              Invoices & Reconciliation
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Deterministic verification pipeline, rule audit trail, and human exception workflow.
            </p>
          </div>
          <button
            type="button"
            onClick={loadInvoices}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-2xs transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
          >
            Refresh
          </button>
        </div>

        {/* Tab Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50/50 p-1 dark:border-zinc-800 dark:bg-zinc-900/50">
          {[
            { id: "ALL", label: "All Decisions" },
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
                  ? "bg-white text-zinc-900 shadow-2xs dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search & Granular Filters */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="search"
              placeholder="Search vendor, invoice #, file..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            >
              <option value="ALL">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="processing">Processing</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div>
            <input
              type="date"
              title="Start Date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>

          <div>
            <input
              type="date"
              title="End Date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>
        </div>

        {/* Table Content */}
        <section className="rounded-2xl border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-950">
          {error ? (
            <div className="p-8 text-center text-sm">
              <p className="font-medium text-zinc-900 dark:text-zinc-50">Could not load invoices</p>
              <p className="mt-1 text-xs text-zinc-500">{error}</p>
              <button
                type="button"
                onClick={loadInvoices}
                className="mt-4 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-2xs hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
              <div className="px-6 py-3.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
                Loading invoices...
              </div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-4">
                  <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  <div className="ml-auto h-4 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                </div>
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-12 text-center text-sm">
              <p className="font-medium text-zinc-900 dark:text-zinc-50">No invoices match your query</p>
              <p className="mt-1 text-xs text-zinc-500">
                {search || statusFilter !== "ALL" || startDate || endDate || activeTab !== "ALL"
                  ? "Try resetting your search filters."
                  : "Upload invoices on the dashboard to populate this queue."}
              </p>
              {(search || statusFilter !== "ALL" || startDate || endDate || activeTab !== "ALL") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("ALL");
                    setVendorFilter("");
                    setStartDate("");
                    setEndDate("");
                    setActiveTab("ALL");
                    setPage(1);
                  }}
                  className="mt-3 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-900 dark:text-zinc-400">
                    <th className="px-6 py-3.5">Invoice #</th>
                    <th className="px-6 py-3.5">Vendor</th>
                    <th className="px-6 py-3.5 text-right">Total</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Decision</th>
                    <th className="px-6 py-3.5">Created</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {invoices.map((inv) => {
                    const badge = DECISION_BADGE[inv.decision ?? ""] ?? DECISION_BADGE["PENDING REVIEW"];
                    const BadgeIcon = badge.icon;
                    const statusObj = STATUS_BADGE[inv.status ?? "completed"] ?? STATUS_BADGE.completed;

                    return (
                      <tr
                        key={inv.id}
                        className="text-zinc-700 transition-colors hover:bg-zinc-50/60 dark:text-zinc-200 dark:hover:bg-zinc-900/50"
                      >
                        <td className="whitespace-nowrap px-6 py-3 font-mono text-xs font-medium text-zinc-900 dark:text-zinc-50">
                          <button
                            type="button"
                            onClick={() => openDetailModal(inv.id)}
                            className="hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                          >
                            {inv.invoice_number || inv.filename || `#${inv.id}`}
                          </button>
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
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                              statusObj.className
                            )}
                          >
                            {statusObj.label}
                          </span>
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
                          {formatDate(inv.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-right text-xs">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openDetailModal(inv.id)}
                              className="rounded-md border border-zinc-200 p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:hover:bg-zinc-900"
                              title="View Details"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            {inv.decision === "PENDING REVIEW" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReviewingInvoice(inv);
                                  setReviewNotes("");
                                  setReviewError(null);
                                }}
                                className="rounded-md bg-blue-600 px-2.5 py-1 font-medium text-white shadow-2xs hover:bg-blue-700"
                              >
                                Review
                              </button>
                            )}
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
            <span>
              Showing {invoices.length > 0 ? (page - 1) * pageSize + 1 : 0}–
              {Math.min(page * pageSize, totalCount)} of {totalCount} invoices (Page {page} of {totalPages})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-zinc-200 px-2.5 py-1 font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-zinc-200 px-2.5 py-1 font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-900">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  Invoice #{selectedInvoice.id} — {selectedInvoice.invoice_number || selectedInvoice.filename}
                </h2>
                <p className="text-xs text-zinc-500">
                  Created {formatDate(selectedInvoice.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="rounded p-1 text-zinc-400 hover:text-zinc-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-6 text-xs">
              {/* Top Overview Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-2.5 dark:border-zinc-900 dark:bg-zinc-900/50">
                  <span className="text-zinc-500">Decision</span>
                  <p className="mt-0.5 font-semibold text-zinc-900 dark:text-zinc-50">
                    {selectedInvoice.decision || "PENDING"}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-2.5 dark:border-zinc-900 dark:bg-zinc-900/50">
                  <span className="text-zinc-500">Confidence</span>
                  <p className="mt-0.5 font-semibold text-zinc-900 dark:text-zinc-50">
                    {formatPercent(selectedInvoice.confidence)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-2.5 dark:border-zinc-900 dark:bg-zinc-900/50">
                  <span className="text-zinc-500">Risk Level</span>
                  <p className="mt-0.5 font-semibold text-amber-600">
                    {selectedInvoice.risk_level || "MEDIUM"}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-2.5 dark:border-zinc-900 dark:bg-zinc-900/50">
                  <span className="text-zinc-500">Total Amount</span>
                  <p className="mt-0.5 font-semibold text-zinc-900 dark:text-zinc-50">
                    {formatCurrency(selectedInvoice.total)}
                  </p>
                </div>
              </div>

              {/* Original File & Storage */}
              <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="space-y-0.5">
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">Original Document</p>
                  <p className="text-[11px] text-zinc-500">
                    Storage: {selectedInvoice.storage_type === "s3" ? "Private S3 Bucket" : "Local Disk"}
                    {selectedInvoice.is_duplicate && " · Duplicate of existing document"}
                  </p>
                </div>
                {selectedInvoice.file_url ? (
                  <a
                    href={selectedInvoice.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View Original
                  </a>
                ) : (
                  <span className="text-zinc-400">File link unavailable</span>
                )}
              </div>

              {/* Extracted Fields */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Extracted Fields
                </h3>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <div>
                    <span className="text-zinc-500">Vendor:</span>{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {selectedInvoice.vendor || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Invoice Number:</span>{" "}
                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-50">
                      {selectedInvoice.invoice_number || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">GSTIN:</span>{" "}
                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-50">
                      {selectedInvoice.gstin || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Date:</span>{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {selectedInvoice.fields?.date || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Subtotal:</span>{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {formatCurrency(selectedInvoice.fields?.subtotal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">CGST + SGST:</span>{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {formatCurrency((selectedInvoice.fields?.cgst ?? 0) + (selectedInvoice.fields?.sgst ?? 0))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Deterministic Validation Rules */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Validation Checks & Policy Bounds
                </h3>
                <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span>Overall Deterministic Rules:</span>
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 font-medium",
                        selectedInvoice.validation?.passed
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                      )}
                    >
                      {selectedInvoice.validation?.passed ? "Passed" : "Issues Found"}
                    </span>
                  </div>

                  {selectedInvoice.validation?.errors && selectedInvoice.validation.errors.length > 0 && (
                    <div className="pt-1">
                      <p className="font-medium text-red-600 dark:text-red-400">Errors:</p>
                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-zinc-600 dark:text-zinc-400">
                        {selectedInvoice.validation.errors.map((e, idx) => (
                          <li key={idx}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selectedInvoice.validation?.warnings && selectedInvoice.validation.warnings.length > 0 && (
                    <div className="pt-1">
                      <p className="font-medium text-amber-600 dark:text-amber-400">Warnings:</p>
                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-zinc-600 dark:text-zinc-400">
                        {selectedInvoice.validation.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Audit Trail */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Audit Trail
                </h3>
                <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  {detailAuditLogs.length === 0 ? (
                    <p className="text-zinc-500">No audit trail entries recorded yet.</p>
                  ) : (
                    <ol className="relative border-l border-zinc-200 ml-2 space-y-3 dark:border-zinc-800">
                      {detailAuditLogs.map((log) => (
                        <li key={log.id} className="ml-4">
                          <div className="absolute -left-1.5 mt-1 h-2.5 w-2.5 rounded-full border border-white bg-blue-600 dark:border-zinc-950" />
                          <time className="text-[10px] text-zinc-400">
                            {formatDate(log.created_at)}
                          </time>
                          <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                            Action: {log.action}
                          </p>
                          {log.previous_state && log.new_state && (
                            <p className="text-zinc-500">
                              State: {log.previous_state} → {log.new_state}
                            </p>
                          )}
                          {log.notes && (
                            <p className="mt-0.5 text-zinc-600 dark:text-zinc-300">
                              Notes: {log.notes}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-900">
              {selectedInvoice.decision === "PENDING REVIEW" ? (
                <button
                  type="button"
                  onClick={() => {
                    setReviewingInvoice(selectedInvoice);
                    setReviewNotes("");
                    setReviewError(null);
                  }}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Manual Review
                </button>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Human Review Modal */}
      {reviewingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
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
                  Reviewer Notes & Justification <span className="text-red-500">* (Required)</span>
                </label>
                <textarea
                  rows={3}
                  value={reviewNotes}
                  onChange={(e) => {
                    setReviewNotes(e.target.value);
                    if (reviewError) setReviewError(null);
                  }}
                  placeholder="e.g. Verified with purchase order #10248; vendor bank details match ERP."
                  className="mt-1 w-full rounded-lg border border-zinc-200 p-2.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                />
                {reviewError && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{reviewError}</p>
                )}
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
                disabled={submittingReview || !reviewNotes.trim()}
                onClick={() => handleReviewSubmit("REJECT")}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-2xs hover:bg-red-700 disabled:opacity-50"
              >
                Reject Invoice
              </button>
              <button
                type="button"
                disabled={submittingReview || !reviewNotes.trim()}
                onClick={() => handleReviewSubmit("APPROVE")}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-2xs hover:bg-blue-700 disabled:opacity-50"
              >
                Approve Invoice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
