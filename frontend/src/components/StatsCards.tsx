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

type StatKey = "total" | "approved" | "rejected" | "pending";

type StatConfig = {
  key: StatKey;
  label: string;
  icon: LucideIcon;
};

const STATS: StatConfig[] = [
  { key: "total", label: "Total invoices", icon: FileText },
  { key: "approved", label: "Approved", icon: CheckCircle2 },
  { key: "pending", label: "Pending review", icon: Clock },
  { key: "rejected", label: "Rejected", icon: AlertTriangle },
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
          setError(err instanceof Error ? err.message : "Unknown error");
        }
        setStatus("error");
      }
    }

    load();

    // Listen for global refresh signals emitted by the upload card.
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
        className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
      >
        <p className="font-medium text-zinc-900 dark:text-zinc-50">
          Couldn’t load statistics
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {error}
        </p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("finance-flow:refresh"))}
          className="mt-3 inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
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
              "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow",
              "hover:shadow-md",
              "dark:border-zinc-800 dark:bg-zinc-950"
            )}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {s.label}
                </p>
                {value === null ? (
                  <div
                    className="h-7 w-16 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800"
                    aria-label="Loading"
                  />
                ) : (
                  <p className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
                    {value.toLocaleString("en-US")}
                  </p>
                )}
              </div>
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg",
                  "bg-zinc-100 text-zinc-700",
                  "dark:bg-zinc-900 dark:text-zinc-200"
                )}
                aria-hidden
              >
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              All-time across uploaded invoices
            </p>
          </article>
        );
      })}
    </section>
  );
}
