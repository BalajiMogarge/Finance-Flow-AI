"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError, fetchStats, type StatsResponse } from "@/lib/api";

type StatCardConfig = {
  key: keyof StatsResponse;
  label: string;
  caption: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  valueColor?: string;
};

const STATS: StatCardConfig[] = [
  {
    key: "total",
    label: "Total Invoices",
    caption: "All documents ingested in tenant",
    icon: FileText,
    iconBg: "bg-zinc-100 dark:bg-zinc-800",
    iconColor: "text-zinc-700 dark:text-zinc-200",
  },
  {
    key: "approved",
    label: "Auto-Approved",
    caption: "Passed checksums & balance checks",
    icon: CheckCircle2,
    iconBg: "bg-emerald-50 dark:bg-emerald-950/50",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    valueColor: "text-emerald-700 dark:text-emerald-300",
  },
  {
    key: "pending",
    label: "Needs Review",
    caption: "High-value or metadata exceptions",
    icon: Clock,
    iconBg: "bg-amber-50 dark:bg-amber-950/50",
    iconColor: "text-amber-600 dark:text-amber-400",
    valueColor: "text-amber-700 dark:text-amber-300",
  },
  {
    key: "rejected",
    label: "Auto-Rejected",
    caption: "Invalid checksum or math mismatch",
    icon: AlertTriangle,
    iconBg: "bg-red-50 dark:bg-red-950/50",
    iconColor: "text-red-600 dark:text-red-400",
    valueColor: "text-red-700 dark:text-red-300",
  },
];

type Status = "loading" | "ready" | "error";

export function StatsCards() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setError(null);
      try {
        const data = await fetchStats();
        if (!cancelled) {
          setStats(data);
          setStatus("ready");
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.detail ?? err.message);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load stats");
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

  if (status === "error") {
    return (
      <section
        aria-label="Key metrics"
        className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
      >
        <p className="font-semibold text-zinc-900 dark:text-zinc-50">
          Couldn’t load pipeline metrics
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {error}
        </p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("finance-flow:refresh"))}
          className="mt-3 inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-blue-700"
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label="Key metrics"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {STATS.map((s) => {
        const Icon = s.icon;
        const value = stats ? stats[s.key] : null;

        return (
          <article
            key={s.key}
            className={cn(
              "rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-xs transition-all",
              "hover:border-zinc-300 hover:shadow-sm",
              "dark:border-zinc-800/90 dark:bg-zinc-950 dark:hover:border-zinc-700"
            )}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  {s.label}
                </p>
                {value === null ? (
                  <div
                    className="h-7 w-16 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800"
                    aria-label="Loading"
                  />
                ) : (
                  <p
                    className={cn(
                      "text-2xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50",
                      s.valueColor
                    )}
                  >
                    {value.toLocaleString("en-IN")}
                  </p>
                )}
              </div>
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-xl",
                  s.iconBg,
                  s.iconColor
                )}
                aria-hidden
              >
                <Icon className="h-4.5 w-4.5" />
              </span>
            </div>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              {s.caption}
            </p>
          </article>
        );
      })}
    </section>
  );
}
