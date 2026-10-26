"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError, fetchInvoices, type InvoiceRow } from "@/lib/api";
import { formatDateTimeIndian, formatRupee, getDecisionConfig } from "@/lib/formatters";

type Status = "loading" | "ready" | "error";

export function RecentInvoicesTable() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setError(null);
      try {
        const data = await fetchInvoices({ page_size: 5 });
        if (!cancelled) {
          setRows(data.items);
          setStatus("ready");
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.detail ?? err.message);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load recent invoices");
        }
        setStatus("error");
      }
    }

    load();

    function onRefresh() {
      load();
    }
    window.addEventListener("finance-flow:refresh", onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener("finance-flow:refresh", onRefresh);
    };
  }, []);

  return (
    <section
      aria-label="Recent invoices"
      className={cn(
        "rounded-2xl border border-zinc-200/90 bg-white shadow-xs overflow-hidden",
        "dark:border-zinc-800/90 dark:bg-zinc-950"
      )}
    >
      <header className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-900">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Recent Invoices
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Latest documents processed through the extraction and rule engine.
          </p>
        </div>
        <Link
          href="/invoices"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          <span>View all invoices</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      {status === "error" ? (
        <div className="p-8 text-center text-xs">
          <p className="font-semibold text-zinc-900 dark:text-zinc-50">
            Could not load recent invoices
          </p>
          <p className="mt-1 text-zinc-500">{error}</p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("finance-flow:refresh"))}
            className="mt-3 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white shadow-2xs hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      ) : status === "loading" ? (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-6 py-3.5">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
                <div className="space-y-1.5">
                  <div className="h-3.5 w-28 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                  <div className="h-3 w-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                </div>
              </div>
              <div className="h-4 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-xs">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <FileText className="h-5 w-5" />
          </span>
          <p className="mt-3 font-semibold text-zinc-900 dark:text-zinc-100">
            No invoices yet
          </p>
          <p className="mt-0.5 text-zinc-500">
            Upload your first invoice or try a demo sample above.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-100 bg-zinc-50/70 text-[11px] font-semibold text-zinc-500 dark:border-zinc-900 dark:bg-zinc-900/40 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-6 py-3">Document / Invoice #</th>
                <th scope="col" className="px-6 py-3">Vendor</th>
                <th scope="col" className="px-6 py-3 text-right">Total Amount</th>
                <th scope="col" className="px-6 py-3">Decision</th>
                <th scope="col" className="px-6 py-3">Processed At</th>
                <th scope="col" className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {rows.map((row) => {
                const decisionCfg = getDecisionConfig(row.decision);
                const Icon = decisionCfg.icon;

                return (
                  <tr
                    key={row.id}
                    className="group transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-900/30"
                  >
                    <td className="px-6 py-3.5">
                      <Link
                        href={`/invoices/${row.id}`}
                        className="font-medium text-zinc-900 hover:text-blue-600 dark:text-zinc-50 dark:hover:text-blue-400 transition-colors"
                      >
                        <span className="font-mono">
                          {row.invoice_number || `INV-#${row.id}`}
                        </span>
                        <span className="block text-[11px] text-zinc-400 truncate max-w-[200px]">
                          {row.filename || "Uploaded File"}
                        </span>
                      </Link>
                    </td>

                    <td className="px-6 py-3.5 text-zinc-600 dark:text-zinc-300 font-medium">
                      {row.vendor || "—"}
                    </td>

                    <td className="px-6 py-3.5 text-right font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">
                      {formatRupee(row.total)}
                    </td>

                    <td className="px-6 py-3.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                          decisionCfg.badgeClass
                        )}
                      >
                        <Icon className="h-3 w-3 shrink-0" />
                        <span>{decisionCfg.label}</span>
                      </span>
                    </td>

                    <td className="px-6 py-3.5 text-zinc-500 dark:text-zinc-400 font-mono text-[11px]">
                      {formatDateTimeIndian(row.created_at)}
                    </td>

                    <td className="px-6 py-3.5 text-right">
                      <Link
                        href={`/invoices/${row.id}`}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 transition-colors"
                      >
                        <span>View</span>
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
    </section>
  );
}
