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
import { ApiError, uploadInvoice, type UploadResponse } from "@/lib/api";

type UploadedFile = {
  id: string;
  name: string;
  size: number;
  file: File;
};

type ResultEntry = {
  id: string;
  fileName: string;
  result: UploadResponse;
};

const ACCEPTED = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];

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
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastResults, setLastResults] = useState<Record<string, ResultEntry>>({});

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    if (list.length === 0) return;
    setFiles((prev) => [
      ...prev,
      ...list.map((f) => ({
        id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`,
        name: f.name,
        size: f.size,
        file: f,
      })),
    ]);
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
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const uploadFiles = useCallback(async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    setErrors({});
    setLastResults({});

    // We surface results in the UploadResultPanel (rendered by the page)
    // by calling ``onUploadComplete`` for each successful response. The
    // page decides whether to replace the previous result or stack
    // multiple — current behavior is "show the most recent one".
    for (const item of files) {
      try {
        const result = await uploadInvoice(item.file);
        setLastResults((prev) => ({
          ...prev,
          [item.id]: { id: item.id, fileName: item.name, result },
        }));
        onUploadComplete?.(result);
        // Ask sibling components (Stats, Invoices) to refresh.
        window.dispatchEvent(new Event("finance-flow:refresh"));
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.detail ?? err.message
            : err instanceof Error
              ? err.message
              : "Upload failed";
        setErrors((prev) => ({ ...prev, [item.id]: message }));
      }
    }

    setIsUploading(false);
  }, [files, onUploadComplete]);

  return (
    <section
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white shadow-sm",
        "dark:border-zinc-800 dark:bg-zinc-950"
      )}
    >
      <header className="flex items-center justify-between gap-4 border-b border-zinc-100 px-6 py-4 dark:border-zinc-900">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Upload invoices
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            PDF, PNG, JPG, or WebP — up to 10 MB each.
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
          )}
        >
          OCR + AI
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
                : "bg-white text-zinc-700 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800"
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
              {ACCEPTED.join(", ")} · max 10 MB
            </p>
          </div>

          <input
            ref={inputRef}
            type="file"
            className="hidden"
            multiple
            accept={ACCEPTED.join(",")}
            onChange={onInputChange}
          />
        </div>

        {/* Selected files list */}
        {files.length > 0 && (
          <ul className="mt-4 space-y-2">
            {files.map((f) => {
              const error = errors[f.id];
              const result = lastResults[f.id];
              return (
                <li
                  key={f.id}
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
                        {f.name}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {formatBytes(f.size)}
                      </p>
                    </div>
                    {isUploading ? (
                      <span
                        className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400"
                        aria-label="Uploading"
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Uploading
                      </span>
                    ) : error ? (
                      <span className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-200">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Failed
                      </span>
                    ) : result ? (
                      <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Done
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Ready
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFile(f.id)}
                      className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      aria-label={`Remove ${f.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {error && (
                    <p className="mt-1 pl-11 text-xs text-zinc-600 dark:text-zinc-300">
                      {error}
                    </p>
                  )}
                </li>
              );
            })}

            <li className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setFiles([]);
                  setErrors({});
                  setLastResults({});
                }}
                disabled={isUploading}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium",
                  "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                  "dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={uploadFiles}
                disabled={isUploading}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm",
                  "transition-colors hover:bg-blue-700",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {isUploading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {isUploading
                  ? "Processing..."
                  : `Process ${files.length} ${files.length === 1 ? "file" : "files"}`}
              </button>
            </li>
          </ul>
        )}
      </div>
    </section>
  );
}
