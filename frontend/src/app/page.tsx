"use client";

import { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { UploadCard } from "@/components/UploadCard";
import { StatsCards } from "@/components/StatsCards";
import { RecentInvoicesTable } from "@/components/RecentInvoicesTable";
import { UploadResultPanel } from "@/components/UploadResultPanel";
import type { UploadResponse } from "@/lib/api";

export default function DashboardPage() {
  // The most recent successful upload. The panel renders below the
  // UploadCard whenever this is non-null.
  const [latestResult, setLatestResult] = useState<UploadResponse | null>(null);

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        {/* Page header */}
        <div className="mb-8 flex flex-col gap-1 sm:mb-10">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
            Dashboard
          </h1>
          <p className="text-sm text-zinc-500 sm:text-base dark:text-zinc-400">
            Upload invoices, monitor verification, and reconcile in one place.
          </p>
        </div>

        <div className="space-y-8">
          <StatsCards />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="space-y-6 lg:col-span-3">
              <UploadCard onUploadComplete={setLatestResult} />
              {latestResult && (
                <UploadResultPanel
                  result={latestResult}
                  onDismiss={() => setLatestResult(null)}
                />
              )}
            </div>

            <aside className="lg:col-span-2">
              <section className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  AI insights
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Generated from your last 30 days of invoice activity.
                </p>

                <ul className="mt-5 space-y-4 text-sm">
                  <li className="flex gap-3">
                    <span
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600"
                      aria-hidden
                    />
                    <p className="text-zinc-700 dark:text-zinc-300">
                      3 invoices from{" "}
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        Initech Software
                      </span>{" "}
                      exceed the historical average by 18%.
                    </p>
                  </li>
                  <li className="flex gap-3">
                    <span
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400"
                      aria-hidden
                    />
                    <p className="text-zinc-700 dark:text-zinc-300">
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        138
                      </span>{" "}
                      pending invoices older than 7 days.
                    </p>
                  </li>
                  <li className="flex gap-3">
                    <span
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400"
                      aria-hidden
                    />
                    <p className="text-zinc-700 dark:text-zinc-300">
                      Verification accuracy:{" "}
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        98.4%
                      </span>
                      .
                    </p>
                  </li>
                </ul>

                <div className="mt-auto pt-6">
                  <button
                    type="button"
                    className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  >
                    Run verification
                  </button>
                </div>
              </section>
            </aside>
          </div>

          <RecentInvoicesTable />
        </div>

        <footer className="mt-12 border-t border-zinc-200 pt-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          © 2026 Finance Flow AI · Built for production
        </footer>
      </main>
    </div>
  );
}
