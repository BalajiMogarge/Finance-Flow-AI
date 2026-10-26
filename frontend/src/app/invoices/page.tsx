"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import {
  ArrowRight,
  Download,
  RefreshCw,
  Search,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ApiError,
  fetchInvoices,
  fetchStats,
  type InvoiceRow,
} from "@/lib/api";
import {
  formatDateOnlyIndian,
  formatRupee,
  getDecisionConfig,
  getRiskConfig,
} from "@/lib/formatters";
import { useToast } from "@/components/Toast";

export default function InvoicesPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination
  const [activeTab, setActiveTab] = useState<string>("ALL");
  const [vendorFilter, setVendorFilter] = useState<string>("");
  const [datePreset, setDatePreset] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Extract distinct vendor list from loaded invoices for the dropdown
  const vendorOptions = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach((inv) => {
      if (inv.vendor && inv.vendor.trim()) {
        set.add(inv.vendor.trim());
      }
    });
    return Array.from(set).sort();
  }, [invoices]);

  // Read URL query params on initial load
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const q = urlParams.get("search");
      const tab = urlParams.get("tab");
      if (q) setSearch(q);
      if (tab) setActiveTab(tab);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const decision =
        activeTab === "ALL" || activeTab === "DUPLICATES" ? undefined : activeTab;
      const isDuplicate = activeTab === "DUPLICATES" ? true : undefined;

      // Compute date boundaries based on datePreset
      let startDate: string | undefined = undefined;
      const now = new Date();

      if (datePreset === "TODAY") {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate = start.toISOString();
      } else if (datePreset === "7D") {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        startDate = start.toISOString();
      } else if (datePreset === "30D") {
        const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        startDate = start.toISOString();
      } else if (datePreset === "MONTH") {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        startDate = start.toISOString();
      }

      const [data, stats] = await Promise.all([
        fetchInvoices({
          decision,
          vendor: vendorFilter.trim() || undefined,
          start_date: startDate,
          is_duplicate: isDuplicate,
          search: search.trim() || undefined,
          page,
          page_size: pageSize,
        }),
        fetchStats().catch(() => null),
      ]);

      setInvoices(data.items);
      setTotalCount(data.total);
      if (stats) {
        setPendingCount(stats.pending || 0);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail ?? err.message : "Failed to load invoices."
      );
    } finally {
      setLoading(false);
    }
  }, [activeTab, vendorFilter, datePreset, search, page]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await loadInvoices();
      window.dispatchEvent(new Event("finance-flow:refresh"));
    } finally {
      setTimeout(() => setRefreshing(false), 300);
    }
  };

  const handleExportCsv = () => {
    if (invoices.length === 0) {
      toast({
        type: "info",
        title: "No Invoices to Export",
        description: "Your current filter returns 0 records.",
      });
      return;
    }

    const headers = [
      "Invoice ID",
      "Invoice Number",
      "Vendor",
      "GSTIN",
      "Total Amount (INR)",
      "Decision",
      "Risk Level",
      "Invoice Date",
      "Ingested At",
    ];

    const rows = invoices.map((inv) => [
      inv.id,
      `"${(inv.invoice_number || "").replace(/"/g, '""')}"`,
      `"${(inv.vendor || "").replace(/"/g, '""')}"`,
      `"${(inv.gstin || "").replace(/"/g, '""')}"`,
      inv.total ?? 0,
      `"${inv.decision || "UNKNOWN"}"`,
      `"${inv.risk_level || "MEDIUM"}"`,
      `"${formatDateOnlyIndian(inv.created_at)}"`,
      `"${inv.created_at || ""}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `invoices-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      type: "success",
      title: "CSV Export Complete",
      description: `Exported ${invoices.length} invoices to CSV.`,
    });
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Navbar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {/* Header Bar */}
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl dark:text-zinc-50">
              Invoices & Reconciliation
            </h1>
            <p className="text-xs text-zinc-500 sm:text-sm dark:text-zinc-400">
              Audited invoice repository with checksum verification and exception queues.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-2xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-2xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 transition-colors"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin text-blue-600")} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Decision Tab Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50/70 p-1.5 dark:border-zinc-800 dark:bg-zinc-900/50">
          {[
            { id: "ALL", label: "All Invoices" },
            { id: "PENDING REVIEW", label: "Review Queue", count: pendingCount },
            { id: "APPROVE", label: "Auto-Approved" },
            { id: "REJECT", label: "Auto-Rejected" },
            { id: "DUPLICATES", label: "Duplicates" },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setPage(1);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                )}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.2 text-[10px] font-semibold",
                      isActive
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Single Unified Search & Granular Filters */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
          {/* Main Search Bar */}
          <div className="relative lg:col-span-6">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="search"
              placeholder="Search vendor, invoice #, or filename..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-xl border border-zinc-200 bg-white pl-9 pr-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>

          {/* Vendor Filter */}
          <div className="lg:col-span-3">
            <div className="relative">
              <input
                type="text"
                list="vendor-datalist"
                placeholder="Filter by vendor..."
                value={vendorFilter}
                onChange={(e) => {
                  setVendorFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
              <datalist id="vendor-datalist">
                {vendorOptions.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Indian Date Presets Selector */}
          <div className="lg:col-span-3">
            <div className="relative">
              <select
                value={datePreset}
                onChange={(e) => {
                  setDatePreset(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              >
                <option value="ALL">All Dates (DD/MM/YYYY)</option>
                <option value="TODAY">Today</option>
                <option value="7D">Past 7 Days</option>
                <option value="30D">Past 30 Days</option>
                <option value="MONTH">This Calendar Month</option>
              </select>
            </div>
          </div>
        </div>

        {/* Invoices Table */}
        <section className="rounded-2xl border border-zinc-200/90 bg-white shadow-xs overflow-hidden dark:border-zinc-800/90 dark:bg-zinc-950">
          {error ? (
            <div className="p-8 text-center text-xs">
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">Could not load invoices</p>
              <p className="mt-1 text-zinc-500">{error}</p>
              <button
                type="button"
                onClick={loadInvoices}
                className="mt-3 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white shadow-2xs hover:bg-blue-700"
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
            <div className="p-12 text-center text-xs">
              <p className="font-semibold text-zinc-900 dark:text-zinc-50 text-sm">
                No invoices match your query
              </p>
              <p className="mt-1 text-zinc-500">
                {search || vendorFilter || datePreset !== "ALL" || activeTab !== "ALL"
                  ? "Try resetting your search filters."
                  : "Upload invoices on the dashboard or try a demo sample."}
              </p>
              {(search || vendorFilter || datePreset !== "ALL" || activeTab !== "ALL") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setVendorFilter("");
                    setDatePreset("ALL");
                    setActiveTab("ALL");
                    setPage(1);
                  }}
                  className="mt-4 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-100 bg-zinc-50/70 text-[11px] font-semibold text-zinc-500 dark:border-zinc-900 dark:bg-zinc-900/40 dark:text-zinc-400">
                  <tr>
                    <th scope="col" className="px-6 py-3.5">Invoice # & Document</th>
                    <th scope="col" className="px-6 py-3.5">Vendor</th>
                    <th scope="col" className="px-6 py-3.5">GSTIN</th>
                    <th scope="col" className="px-6 py-3.5 text-right">Total Amount</th>
                    <th scope="col" className="px-6 py-3.5">Date (DD/MM/YYYY)</th>
                    <th scope="col" className="px-6 py-3.5">Decision</th>
                    <th scope="col" className="px-6 py-3.5">Risk Level</th>
                    <th scope="col" className="px-6 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {invoices.map((inv) => {
                    const decisionCfg = getDecisionConfig(inv.decision);
                    const DecisionIcon = decisionCfg.icon;
                    const riskCfg = getRiskConfig(inv.risk_level);
                    const RiskIcon = riskCfg.icon;

                    return (
                      <tr
                        key={inv.id}
                        onClick={() => router.push(`/invoices/${inv.id}`)}
                        className="group cursor-pointer transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40"
                      >
                        {/* Invoice # and Document */}
                        <td className="px-6 py-3.5">
                          <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                            {inv.invoice_number || `INV-#${inv.id}`}
                          </div>
                          <div className="text-[11px] text-zinc-400 truncate max-w-[200px]">
                            {inv.filename || "Uploaded File"}
                          </div>
                        </td>

                        {/* Vendor */}
                        <td className="px-6 py-3.5 font-medium text-zinc-800 dark:text-zinc-200">
                          {inv.vendor || "—"}
                        </td>

                        {/* GSTIN */}
                        <td className="px-6 py-3.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                          {inv.gstin || "—"}
                        </td>

                        {/* Total Amount */}
                        <td className="px-6 py-3.5 text-right font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">
                          {formatRupee(inv.total)}
                        </td>

                        {/* Date */}
                        <td className="px-6 py-3.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                          {formatDateOnlyIndian(inv.created_at)}
                        </td>

                        {/* Decision */}
                        <td className="px-6 py-3.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              decisionCfg.badgeClass
                            )}
                          >
                            <DecisionIcon className="h-3 w-3 shrink-0" />
                            <span>{decisionCfg.label}</span>
                          </span>
                        </td>

                        {/* Risk Level */}
                        <td className="px-6 py-3.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                              riskCfg.badgeClass
                            )}
                          >
                            <RiskIcon className="h-2.5 w-2.5" />
                            <span>{riskCfg.label}</span>
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-3.5 text-right">
                          <Link
                            href={`/invoices/${inv.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:text-blue-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:text-blue-400 dark:hover:bg-zinc-800 transition-colors"
                          >
                            <span>{inv.decision === "PENDING REVIEW" ? "Review" : "View"}</span>
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Bar */}
          <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-3 text-xs text-zinc-500 dark:border-zinc-900">
            <span>
              Showing {invoices.length > 0 ? (page - 1) * pageSize + 1 : 0}–
              {Math.min(page * pageSize, totalCount)} of {totalCount} records (Page {page} of {totalPages})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-zinc-200 px-2.5 py-1 font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-zinc-200 px-2.5 py-1 font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
