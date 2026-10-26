"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  UserCheck,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import {
  ApiError,
  fetchAuditTrail,
  fetchInvoice,
  getApiBase,
  reviewInvoice,
  type AuditLogEntry,
  type InvoiceDetail,
} from "@/lib/api";
import {
  formatDateTimeIndian,
  formatDateOnlyIndian,
  formatPercent,
  formatRupee,
  getDecisionConfig,
  getRiskConfig,
} from "@/lib/formatters";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/cn";

export default function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const invoiceId = parseInt(resolvedParams.id, 10);
  const { toast } = useToast();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Review state
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);

  const loadData = useCallback(async () => {
    if (Number.isNaN(invoiceId)) {
      setError("Invalid invoice ID.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [inv, audit] = await Promise.all([
        fetchInvoice(invoiceId),
        fetchAuditTrail(invoiceId).catch(() => []),
      ]);
      setInvoice(inv);
      setAuditLogs(audit);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail || err.message : "Failed to load invoice."
      );
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleReviewSubmit = async (decision: "APPROVE" | "REJECT") => {
    if (!reviewNotes.trim()) {
      setReviewError("A mandatory review note is required to explain your audit decision.");
      return;
    }

    setSubmittingReview(true);
    setReviewError(null);
    try {
      await reviewInvoice(invoiceId, decision, reviewNotes.trim());
      toast({
        type: "success",
        title: `Invoice ${decision === "APPROVE" ? "Approved" : "Rejected"}`,
        description: `Decision recorded with audit note.`,
      });
      setReviewNotes("");
      await loadData();
      window.dispatchEvent(new Event("finance-flow:refresh"));
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail || err.message : "Review submission failed.";
      setReviewError(msg);
      toast({
        type: "error",
        title: "Review Error",
        description: msg,
      });
    } finally {
      setSubmittingReview(false);
    }
  };

  // Resolve file URL for viewing
  const fileUrl = invoice?.file_url
    ? invoice.file_url.startsWith("http")
      ? invoice.file_url
      : `${getApiBase()}${invoice.file_url}`
    : null;

  const isPdf = invoice?.filename?.toLowerCase().endsWith(".pdf");

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <Navbar />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 text-xs text-zinc-400 mb-6">
            <div className="h-4 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <span>/</span>
            <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-6 h-[600px] animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
            <div className="lg:col-span-6 space-y-4">
              <div className="h-28 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
              <div className="h-64 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <Navbar />
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400">
            <AlertCircle className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Invoice Not Found
          </h1>
          <p className="mt-1 text-xs text-zinc-500">{error || "The requested invoice could not be located."}</p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/invoices"
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Invoices
            </Link>
            <button
              type="button"
              onClick={loadData}
              className="rounded-lg border border-zinc-200 px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300"
            >
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  const fields = invoice.fields ?? {};
  const validation = invoice.validation ?? { passed: true, errors: [], warnings: [] };
  const decisionCfg = getDecisionConfig(invoice.decision);
  const DecisionIcon = decisionCfg.icon;
  const riskCfg = getRiskConfig(invoice.risk_level);
  const RiskIcon = riskCfg.icon;

  // Calculate mathematical equation check
  const subtotal = fields.subtotal ?? 0;
  const cgst = fields.cgst ?? 0;
  const sgst = fields.sgst ?? 0;
  const igst = fields.igst ?? 0;
  const total = fields.total ?? 0;

  const calculatedSum = igst > 0 ? subtotal + igst : subtotal + cgst + sgst;
  const mathMatches = total > 0 && Math.abs(calculatedSum - total) <= 1.0;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Navbar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {/* Breadcrumb & Navigation Bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/invoices"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors shadow-2xs"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Invoices</span>
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-zinc-300 dark:text-zinc-700">/</span>
              <h1 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-50 font-mono">
                {fields.invoice_number || invoice.invoice_number || `INV-#${invoice.id}`}
              </h1>
              {invoice.is_duplicate && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  Duplicate Document
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
            <span>Ingested: {formatDateTimeIndian(invoice.created_at)}</span>
          </div>
        </div>

        {/* Two-Column Workspace: Document Viewer Left | Reconciliation Right */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* LEFT COLUMN: Original Document Viewer */}
          <div className="lg:col-span-5 space-y-3">
            <div className="rounded-2xl border border-zinc-200/90 bg-white overflow-hidden shadow-xs dark:border-zinc-800/90 dark:bg-zinc-950">
              <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-900">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-zinc-500 shrink-0" />
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                    {invoice.filename || "Original File"}
                  </span>
                </div>

                {fileUrl && (
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition-colors"
                  >
                    <span>Open External</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </header>

              <div className="relative bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center min-h-[480px] lg:min-h-[640px]">
                {fileUrl ? (
                  isPdf ? (
                    <object
                      data={fileUrl}
                      type="application/pdf"
                      className="w-full h-[640px] rounded-b-2xl border-0"
                    >
                      <div className="p-8 text-center text-xs text-zinc-500">
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                          PDF Preview Not Embedded
                        </p>
                        <p className="mt-1">Your browser cannot render this PDF directly.</p>
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white shadow-2xs hover:bg-blue-700"
                        >
                          Download / View PDF
                        </a>
                      </div>
                    </object>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={fileUrl}
                      alt={invoice.filename || "Invoice Document"}
                      className="max-h-[640px] w-auto object-contain p-2 rounded-b-2xl"
                    />
                  )
                ) : (
                  <div className="p-8 text-center text-xs text-zinc-500">
                    <FileText className="h-8 w-8 mx-auto text-zinc-400 mb-2" />
                    <p className="font-medium text-zinc-700 dark:text-zinc-300">
                      Document Preview Unavailable
                    </p>
                    <p className="mt-0.5 text-zinc-400">
                      Storage provider: {invoice.storage_type || "local"}
                    </p>
                  </div>
                )}
              </div>

              <footer className="border-t border-zinc-100 bg-zinc-50/70 px-4 py-2 text-[11px] text-zinc-500 font-mono flex items-center justify-between dark:border-zinc-900 dark:bg-zinc-900/40">
                <span>Storage: {invoice.storage_type === "s3" ? "Private S3" : "Local Disk"}</span>
                {invoice.sha256 && (
                  <span title={invoice.sha256}>
                    SHA-256: {invoice.sha256.slice(0, 10)}...
                  </span>
                )}
              </footer>
            </div>
          </div>

          {/* RIGHT COLUMN: Extraction, Rules, Exceptions & Audit */}
          <div className="lg:col-span-7 space-y-6">
            {/* 1. Decision & Confidence Card */}
            <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-xs dark:border-zinc-800/90 dark:bg-zinc-950">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                      decisionCfg.badgeClass
                    )}
                  >
                    <DecisionIcon className="h-3.5 w-3.5" />
                    <span>Decision: {decisionCfg.label}</span>
                  </span>

                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                      riskCfg.badgeClass
                    )}
                  >
                    <RiskIcon className="h-3.5 w-3.5" />
                    <span>{riskCfg.label}</span>
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-[11px] text-zinc-400 uppercase tracking-wider block">
                    Extraction Confidence
                  </span>
                  <span className="font-mono font-bold text-sm text-zinc-900 dark:text-zinc-50">
                    {formatPercent(invoice.confidence)}
                  </span>
                </div>
              </div>

              {invoice.error_reason ? (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                  <span className="font-semibold">Rejection Cause:</span> {invoice.error_reason}
                </div>
              ) : (
                <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  {decisionCfg.key === "APPROVE" &&
                    "All regulatory format checks passed. GSTIN checksum verified via Luhn mod-36. Arithmetic line-item balances match within ₹1.00 tolerance."}
                  {decisionCfg.key === "PENDING REVIEW" &&
                    "Flagged for human exception handling. Policy constraints or missing optional metadata require auditor verification."}
                  {decisionCfg.key === "REJECT" &&
                    "Document failed deterministic compliance checks. Mathematical inconsistency or invalid checksum detected."}
                </p>
              )}
            </div>

            {/* 2. Structured Financial Extracted Fields */}
            <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-xs dark:border-zinc-800/90 dark:bg-zinc-950">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4">
                Extracted Fields & GST Line-Items
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs mb-5">
                <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3 dark:border-zinc-900 dark:bg-zinc-900/40">
                  <span className="text-zinc-400 text-[11px]">Vendor Name</span>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-50 text-sm mt-0.5 truncate">
                    {fields.vendor || invoice.vendor || "—"}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3 dark:border-zinc-900 dark:bg-zinc-900/40">
                  <span className="text-zinc-400 text-[11px]">Invoice Number</span>
                  <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-50 text-sm mt-0.5">
                    {fields.invoice_number || invoice.invoice_number || "—"}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3 dark:border-zinc-900 dark:bg-zinc-900/40">
                  <span className="text-zinc-400 text-[11px]">Invoice Date</span>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-50 text-sm mt-0.5">
                    {formatDateOnlyIndian(fields.date)}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3 dark:border-zinc-900 dark:bg-zinc-900/40">
                  <span className="text-zinc-400 text-[11px]">GSTIN Identifier</span>
                  <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-50 text-sm mt-0.5">
                    {fields.gstin || invoice.gstin || "—"}
                  </p>
                </div>
              </div>

              {/* Financial Balance Summary */}
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                  Arithmetic Line-Item Balancing
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800">
                    <span className="text-zinc-600 dark:text-zinc-400">Subtotal (Taxable Value):</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
                      {formatRupee(fields.subtotal)}
                    </span>
                  </div>

                  {/* Taxes (Intra-state vs Inter-state IGST) */}
                  {igst > 0 ? (
                    <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800">
                      <span className="text-zinc-600 dark:text-zinc-400">IGST (Inter-State):</span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
                        {formatRupee(fields.igst)}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800">
                        <span className="text-zinc-600 dark:text-zinc-400">CGST (Central Tax):</span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
                          {formatRupee(fields.cgst)}
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800">
                        <span className="text-zinc-600 dark:text-zinc-400">SGST (State Tax):</span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
                          {formatRupee(fields.sgst)}
                        </span>
                      </div>
                    </>
                  )}

                  <div className="flex justify-between pt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    <span>Grand Total:</span>
                    <span className="tabular-nums font-bold text-base">
                      {formatRupee(fields.total || invoice.total)}
                    </span>
                  </div>
                </div>

                {/* Equation verification pill */}
                {total > 0 && subtotal > 0 && (
                  <div
                    className={cn(
                      "mt-3 flex items-center justify-between rounded-lg p-2.5 text-[11px] font-medium",
                      mathMatches
                        ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : "bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                    )}
                  >
                    <div className="flex items-center gap-1.5 font-mono">
                      {mathMatches ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                      )}
                      <span>
                        {formatRupee(subtotal)} + {formatRupee(igst > 0 ? igst : cgst + sgst)} ={" "}
                        {formatRupee(calculatedSum)}
                      </span>
                    </div>
                    <span>{mathMatches ? "Formula Balanced" : "Balance Mismatch"}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 3. Deterministic Validation Rules & Policy Bounds */}
            <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-xs dark:border-zinc-800/90 dark:bg-zinc-950">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                Deterministic Rule Evaluations
              </h2>

              <div className="space-y-2 text-xs">
                {/* GSTIN Checksum Rule */}
                <div className="flex items-start justify-between rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 dark:border-zinc-900 dark:bg-zinc-900/40">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      GSTIN Luhn Mod-36 Checksum
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      Validates 2-digit state code, 10-digit PAN entity, and mathematical check digit.
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold shrink-0",
                      validation.errors.some((e) => e.toLowerCase().includes("gstin"))
                        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    )}
                  >
                    {validation.errors.some((e) => e.toLowerCase().includes("gstin")) ? (
                      <>
                        <AlertTriangle className="h-3 w-3" />
                        Invalid
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3 w-3" />
                        Valid
                      </>
                    )}
                  </span>
                </div>

                {/* Arithmetic Line-Item Balancing */}
                <div className="flex items-start justify-between rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 dark:border-zinc-900 dark:bg-zinc-900/40">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      Arithmetic Line-Item Balancing
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      Ensures subtotal + taxes matches grand total within ₹1.00 rounding tolerance.
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold shrink-0",
                      mathMatches
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                    )}
                  >
                    {mathMatches ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" />
                        Passed
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-3 w-3" />
                        Failed
                      </>
                    )}
                  </span>
                </div>

                {/* High Value Policy Check */}
                <div className="flex items-start justify-between rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 dark:border-zinc-900 dark:bg-zinc-900/40">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      High-Value Threshold Policy
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      Invoices ≥ ₹2,00,000 (2 Lakhs) trigger mandatory human-in-the-loop sign-off.
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold shrink-0",
                      (total >= 200000)
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    )}
                  >
                    {total >= 200000 ? (
                      <>
                        <Clock className="h-3 w-3" />
                        Review Flag
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3 w-3" />
                        Standard
                      </>
                    )}
                  </span>
                </div>
              </div>

              {/* Specific Errors & Warnings */}
              {validation.errors.length > 0 && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs dark:border-red-900/60 dark:bg-red-950/40">
                  <p className="font-semibold text-red-800 dark:text-red-300">Errors Identified:</p>
                  <ul className="mt-1 list-disc list-inside space-y-0.5 text-red-700 dark:text-red-400">
                    {validation.errors.map((e, idx) => (
                      <li key={idx}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validation.warnings.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/60 dark:bg-amber-950/40">
                  <p className="font-semibold text-amber-800 dark:text-amber-300">Policy Warnings:</p>
                  <ul className="mt-1 list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-400">
                    {validation.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* 4. Human Review & Exception Workflow */}
            <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-xs dark:border-zinc-800/90 dark:bg-zinc-950">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-zinc-500" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Human Exception Workflow
                  </h2>
                </div>
                {invoice.reviewed_at && (
                  <span className="text-[11px] text-zinc-400">
                    Reviewed: {formatDateTimeIndian(invoice.reviewed_at)}
                  </span>
                )}
              </div>

              {invoice.reviewed_by ? (
                <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-3.5 text-xs dark:border-zinc-900 dark:bg-zinc-900/40 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                      Audit Exception Resolved
                    </span>
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-[10px] font-semibold uppercase",
                        decisionCfg.badgeClass
                      )}
                    >
                      {decisionCfg.label}
                    </span>
                  </div>
                  <p className="text-zinc-600 dark:text-zinc-300">
                    <span className="font-medium text-zinc-500">Auditor Note:</span>{" "}
                    {invoice.review_notes || "No notes provided."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    A recorded audit note is strictly mandatory to approve or reject exception items.
                  </p>

                  <div>
                    <label
                      htmlFor="reviewNotes"
                      className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      Audit Reason & Explanation <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      id="reviewNotes"
                      rows={3}
                      value={reviewNotes}
                      onChange={(e) => {
                        setReviewNotes(e.target.value);
                        if (reviewError) setReviewError(null);
                      }}
                      placeholder="e.g. Verified purchase order PO-8891; vendor tax exemption verified manually."
                      className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                    />
                    {reviewError && (
                      <p className="mt-1 text-xs text-red-600">{reviewError}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      disabled={submittingReview}
                      onClick={() => handleReviewSubmit("APPROVE")}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {submittingReview ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      <span>Approve Invoice Exception</span>
                    </button>

                    <button
                      type="button"
                      disabled={submittingReview}
                      onClick={() => handleReviewSubmit("REJECT")}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-red-700 disabled:opacity-50"
                    >
                      {submittingReview ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      )}
                      <span>Reject Invoice</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 5. Immutable Audit Trail */}
            <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-xs dark:border-zinc-800/90 dark:bg-zinc-950">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4">
                Immutable Audit Trail
              </h2>

              {auditLogs.length === 0 ? (
                <p className="text-xs text-zinc-500">No audit events recorded yet.</p>
              ) : (
                <ol className="relative border-l border-zinc-200 ml-2 space-y-4 dark:border-zinc-800">
                  {auditLogs.map((log) => (
                    <li key={log.id} className="ml-4">
                      <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-white bg-blue-600 dark:border-zinc-950" />
                      <time className="text-[10px] font-mono text-zinc-400">
                        {formatDateTimeIndian(log.created_at)}
                      </time>
                      <p className="font-semibold text-xs text-zinc-900 dark:text-zinc-50 capitalize">
                        {log.action.replace("_", " ")}
                      </p>
                      {log.previous_state && log.new_state && (
                        <p className="text-xs text-zinc-500 mt-0.5">
                          State Transition:{" "}
                          <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">
                            {log.previous_state} → {log.new_state}
                          </span>
                        </p>
                      )}
                      {log.notes && (
                        <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 rounded bg-zinc-50 p-2 dark:bg-zinc-900/50">
                          {log.notes}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
