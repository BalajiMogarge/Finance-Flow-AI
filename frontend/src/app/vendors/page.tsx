import { Navbar } from "@/components/Navbar";
import { Building2, Search } from "lucide-react";
import Link from "next/link";

export default function VendorsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <div className="mb-8 flex flex-col gap-1 sm:mb-10">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
            Vendors
          </h1>
          <p className="text-sm text-zinc-500 sm:text-base dark:text-zinc-400">
            Directory of extracted vendor profiles and GSTIN compliance records.
          </p>
        </div>

        <section className="rounded-2xl border border-zinc-200 bg-white p-12 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <Building2 className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Vendor Directory & Reconciliation
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
            Vendor profiles are automatically aggregated during invoice processing. You can view all invoices categorized by vendor on the Invoices page.
          </p>
          <div className="mt-6">
            <Link
              href="/invoices"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <Search className="h-4 w-4" />
              View All Invoices by Vendor
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
