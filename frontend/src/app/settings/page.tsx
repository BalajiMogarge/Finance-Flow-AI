import { Navbar } from "@/components/Navbar";
import { Shield, Server, HardDrive } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <div className="mb-8 flex flex-col gap-1 sm:mb-10">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
            System Settings
          </h1>
          <p className="text-sm text-zinc-500 sm:text-base dark:text-zinc-400">
            Environment configuration, storage providers, and security controls.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <Server className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Backend API & Engine
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              FastAPI backend running with deterministic rules engine and PyTorch/EasyOCR optimization.
            </p>
            <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-xs font-mono text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              Status: Connected (v2.0.0)
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              <HardDrive className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Storage Backend
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Configured via STORAGE_BACKEND. Supports Local disk storage and durable S3/Cloudflare R2 buckets.
            </p>
            <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-xs font-mono text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              Pluggable: local | s3
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
              <Shield className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Security & Auth
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              PBKDF2-HMAC-SHA256 password hashing, PyJWT bearer authentication, and sliding-window rate limiting.
            </p>
            <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-xs font-mono text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              RBAC: Admin | Reviewer | Viewer
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
