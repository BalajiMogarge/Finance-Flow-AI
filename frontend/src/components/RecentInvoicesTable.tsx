"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ApiError,
  fetchInvoices,
  type InvoiceDecision,
  type InvoiceRow,
} from "@/lib/api";

type StatusConfig = {
  label: string;
  icon: typeof CheckCircle2;
  className: string;
};

const STATUS: Record<string, StatusConfig> = {
  APPROVE: {
    label: "Approved",
    icon: CheckCircle2,
    className:
      "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  },
  REJECT: {
    label: "Rejected",
    icon: AlertTriangle,
    className:
      "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
  },
  "PENDING REVIEW": {
    label: "Pending review",
    icon: Clock,
    className:
      "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
  },
};

const UNKNOWN_STATUS: StatusConfig = {
  label: "Unknown",
  icon: Clock,
  className:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
};

function statusFor(decision: InvoiceDecision | null | undefined): StatusConfig {
  if (!decision) return UNKNOWN_STATUS;
  return STATUS[decision] ?? UNKNOWN_STATUS;
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCreatedAt(iso: string | null | undefined): string {
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

type Status = "loading" | "ready" | "error";

const SKELETON_ROWS = Array.from({ length: 5 });

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
        const data = await fetchInvoices();
        if (!cancelled) {
          setRows(data);
          setStatus("ready");
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.detail ?? err.message);
        } else {
          setError(err instanceof Error ? err.message : "Unknown error");
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
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white shadow-sm",
        "dark:border-zinc-800 dark:bg-zinc-950"
      )}
    >
      <header className="flex items-center justify-between gap-4 border-b border-zinc-100 px-6 py-4 dark:border-zinc-900">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Recent invoices
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Latest activity across all vendors.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new Event("finance-flow:refresh"))
          }
          className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Refresh
        </button>
      </header>

      {status === "error" && (
        <div className="px-6 py-8 text-center text-sm">
          <p className="font-medium text-zinc-900 dark:text-zinc-50">
            Couldn’t load invoices
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {error}
          </p>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new Event("finance-flow:refresh"))
            }
            className="mt-3 inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      )}

      {status !== "error" && status === "loading" && (
        <>
          {/* Desktop skeleton */}
          <div className="hidden md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  <th className="px-6 py-3 font-medium">Invoice</th>
                  <th className="px-6 py-3 font-medium">Vendor</th>
                  <th className="px-6 py-3 font-medium">Total</th>
                  <th className="px-6 py-3 font-medium">Decision</th>
                  <th className="px-6 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {SKELETON_ROWS.map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-6 py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile skeleton */}
          <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-900">
            {SKELETON_ROWS.map((_, i) => (
              <li key={i} className="flex flex-col gap-2 px-6 py-4">
                <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-3 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              </li>
            ))}
          </ul>
        </>
      )}

      {status === "ready" && rows.length === 0 && (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            No invoices yet
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Upload an invoice above to see it appear here.
          </p>
        </div>
      )}

      {status === "ready" && rows.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  <th className="px-6 py-3 font-medium">Invoice</th>
                  <th className="px-6 py-3 font-medium">Vendor</th>
                  <th className="px-6 py-3 font-medium text-right">Total</th>
                  <th className="px-6 py-3 font-medium">Decision</th>
                  <th className="px-6 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {rows.map((inv) => {
                  const s = statusFor(inv.decision);
                  const Icon = s.icon;
                  return (
                    <tr
                      key={inv.id}
                      className="text-zinc-700 transition-colors hover:bg-zinc-50/60 dark:text-zinc-200 dark:hover:bg-zinc-900/50"
                    >
                      <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-zinc-900 dark:text-zinc-50">
                        {inv.invoice_number ?? inv.filename ?? `#${inv.id}`}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 font-medium">
                        {inv.vendor ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                        {formatCurrency(inv.total)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            s.className
                          )}
                        >
                          <Icon className="h-3 w-3" />
                          {s.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-zinc-500 dark:text-zinc-400">
                        {formatCreatedAt(inv.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-900">
            {rows.map((inv) => {
              const s = statusFor(inv.decision);
              const Icon = s.icon;
              return (
                <li key={inv.id} className="flex flex-col gap-1.5 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {inv.invoice_number ?? inv.filename ?? `#${inv.id}`}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                        s.className
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {s.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {inv.vendor ?? "—"}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                      {formatCurrency(inv.total)}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formatCreatedAt(inv.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
