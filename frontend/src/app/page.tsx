"use client";

import { Navbar } from "@/components/Navbar";
import { StatsCards } from "@/components/StatsCards";
import { UploadCard } from "@/components/UploadCard";
import { DashboardAnalytics } from "@/components/DashboardAnalytics";
import { NeedsReviewList } from "@/components/NeedsReviewList";
import { RecentInvoicesTable } from "@/components/RecentInvoicesTable";

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Navbar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* Page header */}
        <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl dark:text-zinc-50">
              Accounts Payable Audit & Reconciliation
            </h1>
            <p className="text-xs text-zinc-500 sm:text-sm dark:text-zinc-400">
              Deterministic GSTIN checksums, line-item balancing, and human exception workflow.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Key Metric Cards */}
          <StatsCards />

          {/* Primary Split: Compact Ingestion + Analytics */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 space-y-6">
              <UploadCard />
              <NeedsReviewList />
            </div>

            <div className="lg:col-span-5">
              <DashboardAnalytics />
            </div>
          </div>

          {/* Recent Activity Table */}
          <RecentInvoicesTable />
        </div>

        {/* Honest, Clean Footer */}
        <footer className="mt-12 border-t border-zinc-200/80 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800/80 dark:text-zinc-400">
          Finance Flow AI · Automated AP Auditing & Regulatory Checksums
        </footer>
      </main>
    </div>
  );
}
