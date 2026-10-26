"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { checkHealth } from "@/lib/api";

export function ColdStartBanner() {
  const [status, setStatus] = useState<"checking" | "online" | "waking">("checking");
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
      role="status"
      className="relative z-50 border-b border-amber-200/80 bg-amber-50/90 px-4 py-1.5 text-xs text-amber-900 backdrop-blur dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-[11px] font-medium">
            Backend is waking from cold start (~30–60s) · Retrying automatically...
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRetryCount((prev) => prev + 1)}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50 transition-colors"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            Check
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss notice"
            className="rounded p-0.5 text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
