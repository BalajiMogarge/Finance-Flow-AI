"use client";

import { useEffect, useState, useCallback } from "react";
import { BarChart3, CheckCircle2, Clock, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetchInsights, fetchStats, type InsightsResponse, type StatsResponse } from "@/lib/api";

export function DashboardAnalytics() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([
        fetchStats().catch(() => null),
        fetchInsights(30).catch(() => null),
      ]);
      setStats(s);
      setInsights(i);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    function onRefresh() {
      loadData();
    }
    window.addEventListener("finance-flow:refresh", onRefresh);
    return () => {
      window.removeEventListener("finance-flow:refresh", onRefresh);
    };
  }, [loadData]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
      window.dispatchEvent(new Event("finance-flow:refresh"));
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  const total = stats?.total ?? 0;
  const approved = stats?.approved ?? 0;
  const pending = stats?.pending ?? 0;
  const rejected = stats?.rejected ?? 0;

  const approvedPct = total > 0 ? (approved / total) * 100 : 0;
  const pendingPct = total > 0 ? (pending / total) * 100 : 0;
  const rejectedPct = total > 0 ? (rejected / total) * 100 : 0;

  return (
    <section className="flex flex-col justify-between rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-xs dark:border-zinc-800/90 dark:bg-zinc-950">
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
              <BarChart3 className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Audit Decision Distribution
            </h2>
          </div>
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={refreshing}
            title="Refresh metrics from backend"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin text-blue-600")} />
            <span>Refresh</span>
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Deterministic rule evaluations across all ingested invoices in this tenant.
        </p>

        {loading ? (
          <div className="my-6 space-y-3">
            <div className="h-4 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-16 w-full animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ) : total === 0 ? (
          <div className="my-6 rounded-xl border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
            No invoices ingested yet. Upload an invoice or try a demo sample to see real-time rule distribution.
          </div>
        ) : (
          <div className="my-6 space-y-4">
            {/* Visual Segmented Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                {approvedPct > 0 && (
                  <div
                    style={{ width: `${approvedPct}%` }}
                    className="bg-emerald-500 transition-all duration-500"
                    title={`Approved: ${approved} (${approvedPct.toFixed(1)}%)`}
                  />
                )}
                {pendingPct > 0 && (
                  <div
                    style={{ width: `${pendingPct}%` }}
                    className="bg-amber-500 transition-all duration-500"
                    title={`Needs Review: ${pending} (${pendingPct.toFixed(1)}%)`}
                  />
                )}
                {rejectedPct > 0 && (
                  <div
                    style={{ width: `${rejectedPct}%` }}
                    className="bg-red-500 transition-all duration-500"
                    title={`Rejected: ${rejected} (${rejectedPct.toFixed(1)}%)`}
                  />
                )}
              </div>
            </div>

            {/* Legend & Exact Counts */}
            <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
              <div className="flex flex-col gap-0.5 rounded-lg border border-zinc-100 bg-zinc-50/60 p-2.5 dark:border-zinc-900 dark:bg-zinc-900/40">
                <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Approved</span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">
                    {approved}
                  </span>
                  <span className="text-[11px] text-zinc-500 font-mono">
                    {approvedPct.toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-0.5 rounded-lg border border-zinc-100 bg-zinc-50/60 p-2.5 dark:border-zinc-900 dark:bg-zinc-900/40">
                <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-medium">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Review</span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">
                    {pending}
                  </span>
                  <span className="text-[11px] text-zinc-500 font-mono">
                    {pendingPct.toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-0.5 rounded-lg border border-zinc-100 bg-zinc-50/60 p-2.5 dark:border-zinc-900 dark:bg-zinc-900/40">
                <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Rejected</span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">
                    {rejected}
                  </span>
                  <span className="text-[11px] text-zinc-500 font-mono">
                    {rejectedPct.toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Honest Operational Insights */}
      <div className="border-t border-zinc-100 pt-4 dark:border-zinc-900">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2.5">
          Tenant Activity Summary
        </h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-zinc-50/70 p-2.5 dark:bg-zinc-900/40">
            <span className="text-zinc-500 dark:text-zinc-400 text-[11px]">Primary Vendor</span>
            <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate mt-0.5">
              {insights?.top_vendor && insights.top_vendor !== "No data"
                ? insights.top_vendor
                : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-zinc-50/70 p-2.5 dark:bg-zinc-900/40">
            <span className="text-zinc-500 dark:text-zinc-400 text-[11px]">High-Value Policy Flags</span>
            <p className="font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums mt-0.5">
              {insights?.high_value_count ?? 0} invoices (≥ ₹2,00,000)
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
