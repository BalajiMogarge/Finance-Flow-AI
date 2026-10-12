"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ApiError,
  uploadAndPollInvoice,
  type UploadResponse,
} from "@/lib/api";

type QueueStage = "idle" | "uploading" | "extracting" | "validating" | "completed" | "failed";

type QueuedFile = {
  id: string;
  name: string;
  size: number;
  file: File;
  stage: QueueStage;
  error?: string;
  result?: UploadResponse;
};

const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".pdf"];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

type Props = {
  onUploadComplete?: (result: UploadResponse) => void;
};

export function UploadCard({ onUploadComplete }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const validateFile = (file: File): string | null => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return `Unsupported file format (${ext}). Allowed: ${ACCEPTED_EXTENSIONS.join(", ")}`;
    }
    if (file.size > MAX_FILE_BYTES) {
      return `File exceeds 10 MB limit (${formatBytes(file.size)}).`;
    }
    return null;
  };

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    if (list.length === 0) return;

    const newEntries: QueuedFile[] = list.map((f) => {
      const valError = validateFile(f);
      return {
        id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`,
        name: f.name,
        size: f.size,
        file: f,
        stage: valError ? "failed" : "idle",
        error: valError ?? undefined,
      };
    });

    setQueue((prev) => [...prev, ...newEntries]);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) addFiles(e.target.files);
      e.target.value = "";
    },
    [addFiles]
  );

  const removeFile = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const processQueue = useCallback(async () => {
    setIsProcessing(true);

    // Snapshot items to process sequentially
    const items = queue.filter((item) => item.stage === "idle");

    for (const item of items) {
      // Update stage to uploading
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, stage: "uploading", error: undefined } : q))
      );

      try {
        const result = await uploadAndPollInvoice(item.file, (stage) => {
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, stage } : q))
          );
        });

        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, stage: "completed", result } : q))
        );

        onUploadComplete?.(result);
        window.dispatchEvent(new Event("finance-flow:refresh"));
      } catch (err: unknown) {
        const errorMsg =
          err instanceof ApiError
            ? err.detail || err.message
            : err instanceof Error
              ? err.message
              : "Upload and extraction failed";

        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, stage: "failed", error: errorMsg } : q))
        );
      }
    }

    setIsProcessing(false);
  }, [queue, onUploadComplete]);

  return (
    <section
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white shadow-xs",
        "dark:border-zinc-800 dark:bg-zinc-950"
      )}
    >
      <header className="flex items-center justify-between gap-4 border-b border-zinc-100 px-6 py-4 dark:border-zinc-900">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Upload invoices
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            PNG, JPG, WebP, BMP, TIFF, or PDF — max 10 MB per file.
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
          )}
        >
          Fast-Path + OCR
        </span>
      </header>

      <div className="p-6">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          aria-label="Upload invoices by clicking or dragging files"
          className={cn(
            "group flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
            "cursor-pointer select-none",
            isDragging
              ? "border-blue-500 bg-blue-50/60 dark:bg-blue-500/5"
              : "border-zinc-200 bg-zinc-50/50 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
          )}
        >
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full transition-colors",
              isDragging
                ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                : "bg-white text-zinc-700 shadow-xs ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800"
            )}
            aria-hidden
          >
            <UploadCloud className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              <span className="text-blue-600 dark:text-blue-400">Click to upload</span>{" "}
              or drag and drop
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {ACCEPTED_EXTENSIONS.join(", ")} · max 10 MB
            </p>
          </div>

          <input
            ref={inputRef}
            type="file"
            className="hidden"
            multiple
            accept={ACCEPTED_EXTENSIONS.join(",")}
            onChange={onInputChange}
          />
        </div>

        {/* Queued files list */}
        {queue.length > 0 && (
          <ul className="mt-4 space-y-2">
            {queue.map((item) => {
              return (
                <li
                  key={item.id}
                  className={cn(
                    "rounded-lg border bg-zinc-50/60 px-3 py-2 text-sm",
                    "border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900/50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"
                      aria-hidden
                    >
                      <FileText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                        {item.name}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {formatBytes(item.size)}
                      </p>
                    </div>

                    {/* Progress / Status Badges */}
                    {item.stage === "uploading" && (
                      <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Uploading
                      </span>
                    )}
                    {item.stage === "extracting" && (
                      <span className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Extracting
                      </span>
                    )}
                    {item.stage === "validating" && (
                      <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Validating
                      </span>
                    )}
                    {item.stage === "completed" && (
                      <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Completed
                      </span>
                    )}
                    {item.stage === "failed" && (
                      <span className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Failed
                      </span>
                    )}
                    {item.stage === "idle" && (
                      <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                        Queued
                      </span>
                    )}

                    <button
                      type="button"
                      disabled={isProcessing && item.stage !== "idle" && item.stage !== "completed" && item.stage !== "failed"}
                      onClick={() => removeFile(item.id)}
                      className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      aria-label={`Remove ${item.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {item.error && (
                    <p className="mt-1 pl-11 text-xs text-red-600 dark:text-red-400">
                      {item.error}
                    </p>
                  )}
                </li>
              );
            })}

            <li className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setQueue([])}
                disabled={isProcessing}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium",
                  "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                  "dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={processQueue}
                disabled={isProcessing || !queue.some((q) => q.stage === "idle")}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-xs",
                  "transition-colors hover:bg-blue-700",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {isProcessing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isProcessing
                  ? "Processing Queue..."
                  : `Process ${queue.filter((q) => q.stage === "idle").length} Queued`}
              </button>
            </li>
          </ul>
        )}
      </div>
    </section>
  );
}
