"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { checkHealth } from "@/lib/api";

export function ColdStartBanner() {
  const [status, setStatus] = useState<"checking" | "online" | "waking" | "error">("checking");
  const [retryCount, setRetryCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let timer: NodeJS.Timeout | null = null;

    async function probeServer() {
      try {
        await checkHealth();
        if (isMounted) {
          setStatus("online");
        }
      } catch {
        if (isMounted) {
          setStatus("waking");
          // Schedule next retry with backoff (3s, 6s, 10s...)
          const delay = Math.min(3000 + retryCount * 2000, 10000);
          timer = setTimeout(() => {
            if (isMounted) {
              setRetryCount((prev) => prev + 1);
            }
          }, delay);
        }
      }
    }

    probeServer();

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [retryCount]);

  if (dismissed || status === "online" || status === "checking") {
    return null;
  }

  return (
    <div
      role="alert"
      className="relative z-50 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 shadow-xs dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-4 w-4 animate-spin text-amber-700 dark:text-amber-400" />
          <p className="font-medium">
            <span className="font-semibold">Server is waking up (up to ~60 s)</span> — Render service is starting from idle sleep. Requests will automatically retry and process once online.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRetryCount((prev) => prev + 1)}
            className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-200 dark:bg-amber-900/60 dark:text-amber-200"
          >
            <RefreshCw className="h-3 w-3" />
            Check again
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded px-1.5 py-0.5 text-amber-700 hover:text-amber-900 dark:text-amber-300"
            aria-label="Dismiss banner"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
