"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { fetchInvoices, type InvoiceRow } from "@/lib/api";
import { formatDateOnlyIndian, formatRupee, getRiskConfig } from "@/lib/formatters";

export function NeedsReviewList() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const loadPending = useCallback(async () => {
    try {
      const data = await fetchInvoices({
        decision: "PENDING REVIEW",
        page: 1,
        page_size: 4,
      });
      setInvoices(data.items);
      setTotalCount(data.total);
    } catch {
      // Quiet fail if offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPending();

    function onRefresh() {
      loadPending();
    }
    window.addEventListener("finance-flow:refresh", onRefresh);
    return () => {
      window.removeEventListener("finance-flow:refresh", onRefresh);
    };
  }, [loadPending]);

  return (
    <section className="rounded-2xl border border-zinc-200/90 bg-white shadow-xs overflow-hidden dark:border-zinc-800/90 dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-900">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
            <Clock className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Needs Review (Exception Queue)
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Invoices flagged by deterministic rules requiring auditor sign-off.
            </p>
          </div>
        </div>

        {totalCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {totalCount} pending
          </span>
        )}
      </header>

      <div className="p-5">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800"
              />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <p className="mt-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Review Queue is Clear
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xs mt-0.5">
              No invoices currently require human exception approval. Try uploading a high-value sample invoice to test the workflow.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {invoices.map((inv) => {
              const riskCfg = getRiskConfig(inv.risk_level);

              return (
                <div
                  key={inv.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3.5 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/30 dark:hover:border-zinc-700"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {inv.invoice_number || `INV-#${inv.id}`}
                      </span>
                      <span className="text-zinc-400">·</span>
                      <span className="text-xs text-zinc-600 dark:text-zinc-300 truncate font-medium">
                        {inv.vendor || "Unknown Vendor"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                        {formatRupee(inv.total)}
                      </span>
                      <span>·</span>
                      <span>{formatDateOnlyIndian(inv.created_at)}</span>
                      <span>·</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-semibold ${riskCfg.badgeClass}`}
                      >
                        <riskCfg.icon className="h-2.5 w-2.5" />
                        {riskCfg.label}
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/invoices/${inv.id}`}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 shadow-2xs self-end sm:self-center"
                  >
                    <span>Review</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              );
            })}

            {totalCount > 4 && (
              <div className="pt-2 text-center">
                <Link
                  href="/invoices?tab=PENDING+REVIEW"
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  View all {totalCount} pending invoices in review queue →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
