"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToastType = "success" | "error" | "info";

export type ToastMessage = {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
};

type ToastContextValue = {
  toast: (options: { type?: ToastType; title: string; description?: string }) => void;
  removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ type = "info", title, description }: { type?: ToastType; title: string; description?: string }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, type, title, description }]);

      // Auto dismiss after 4 seconds
      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toast, removeToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none p-2 sm:p-0"
      >
        {toasts.map((t) => {
          const Icon =
            t.type === "success"
              ? CheckCircle2
              : t.type === "error"
                ? AlertTriangle
                : Info;

          return (
            <div
              key={t.id}
              role="alert"
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 shadow-lg backdrop-blur-md transition-all animate-in slide-in-from-bottom-2",
                t.type === "success" &&
                  "border-emerald-200 bg-white text-emerald-950 dark:border-emerald-800 dark:bg-zinc-900 dark:text-emerald-100",
                t.type === "error" &&
                  "border-red-200 bg-white text-red-950 dark:border-red-800 dark:bg-zinc-900 dark:text-red-100",
                t.type === "info" &&
                  "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 mt-0.5",
                  t.type === "success" && "text-emerald-600 dark:text-emerald-400",
                  t.type === "error" && "text-red-600 dark:text-red-400",
                  t.type === "info" && "text-blue-600 dark:text-blue-400"
                )}
              />
              <div className="flex-1 space-y-0.5 text-xs">
                <p className="font-semibold">{t.title}</p>
                {t.description && (
                  <p className="text-zinc-500 dark:text-zinc-400 text-[11px] leading-relaxed">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                aria-label="Close notification"
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
