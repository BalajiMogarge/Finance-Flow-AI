"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  FileText,
  FlaskConical,
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
import { formatRupee, getDecisionConfig } from "@/lib/formatters";
import { useToast } from "@/components/Toast";

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

const SAMPLES = [
  {
    label: "Standard Tax Invoice",
    sublabel: "Auto-Approve (Valid GSTIN & Math)",
    filename: "sample_digital_standard.pdf",
    type: "application/pdf",
  },
  {
    label: "High-Value Invoice (> ₹2L)",
    sublabel: "Flags for Manual Policy Review",
    filename: "sample_digital_high_value.pdf",
    type: "application/pdf",
  },
  {
    label: "Invalid GSTIN Checksum",
    sublabel: "Auto-Reject (Luhn Mod-36 Mismatch)",
    filename: "sample_digital_invalid_gstin.pdf",
    type: "application/pdf",
  },
  {
    label: "Scanned Receipt",
    sublabel: "RapidOCR ONNX Ingestion",
    filename: "sample_scanned_receipt.png",
    type: "image/png",
  },
];

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
  const [showSamplesMenu, setShowSamplesMenu] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const { toast } = useToast();

  const validateFile = (file: File): string | null => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return `Unsupported format (${ext}). Allowed: PDF, PNG, JPG`;
    }
    if (file.size > MAX_FILE_BYTES) {
      return `File exceeds 10 MB limit (${formatBytes(file.size)}).`;
    }
    return null;
  };

  const processSingleFile = useCallback(
    async (queuedItem: QueuedFile) => {
      try {
        const result = await uploadAndPollInvoice(queuedItem.file, (stage) => {
          setQueue((prev) =>
            prev.map((q) => (q.id === queuedItem.id ? { ...q, stage } : q))
          );
        });

        setQueue((prev) =>
          prev.map((q) =>
            q.id === queuedItem.id ? { ...q, stage: "completed", result } : q
          )
        );

        const decision = result.decision?.decision || "PROCESSED";
        toast({
          type: "success",
          title: `Invoice Ingested — ${decision}`,
          description: `${queuedItem.name} successfully extracted and reconciled.`,
        });

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
          prev.map((q) =>
            q.id === queuedItem.id
              ? { ...q, stage: "failed", error: errorMsg }
              : q
          )
        );

        toast({
          type: "error",
          title: "Ingestion Failed",
          description: errorMsg,
        });
      }
    },
    [onUploadComplete, toast]
  );

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      if (list.length === 0) return;

      const newEntries: QueuedFile[] = list.map((f) => {
        const valError = validateFile(f);
        return {
          id: `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: f.name,
          size: f.size,
          file: f,
          stage: valError ? "failed" : "idle",
          error: valError ?? undefined,
        };
      });

      setQueue((prev) => [...newEntries, ...prev]);

      // Automatically trigger upload of valid entries
      const validEntries = newEntries.filter((item) => item.stage === "idle");
      if (validEntries.length > 0) {
        setIsProcessing(true);
        Promise.all(validEntries.map((item) => processSingleFile(item))).finally(
          () => {
            setIsProcessing(false);
          }
        );
      }
    },
    [processSingleFile]
  );

  const handleSelectSample = async (sample: (typeof SAMPLES)[0]) => {
    setShowSamplesMenu(false);
    setLoadingSample(true);
    try {
      const res = await fetch(`/samples/${sample.filename}`);
      if (!res.ok) {
        throw new Error(`Sample file ${sample.filename} not found.`);
      }
      const blob = await res.blob();
      const file = new File([blob], sample.filename, { type: sample.type });
      addFiles([file]);
    } catch (err) {
      toast({
        type: "error",
        title: "Could not load sample",
        description: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setLoadingSample(false);
    }
  };

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  return (
    <section
      className={cn(
        "rounded-2xl border border-zinc-200/90 bg-white shadow-xs overflow-hidden",
        "dark:border-zinc-800/90 dark:bg-zinc-950"
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-900">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Invoice Ingestion
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            PDF, PNG, JPG up to 10 MB · Dual-engine Fast-Path + OCR
          </p>
        </div>

        {/* Demo Samples Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSamplesMenu((prev) => !prev)}
            disabled={loadingSample || isProcessing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {loadingSample ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FlaskConical className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            )}
            <span>Try Sample Invoice</span>
          </button>

          {showSamplesMenu && (
            <div className="absolute right-0 mt-2 w-72 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 z-30">
              <div className="px-2.5 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                Select Demo Document
              </div>
              {SAMPLES.map((s) => (
                <button
                  key={s.filename}
                  type="button"
                  onClick={() => handleSelectSample(s)}
                  className="w-full text-left rounded-lg p-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    {s.label}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {s.sublabel}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="p-5 space-y-4">
        {/* Dropzone */}
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
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          aria-label="Upload invoices by clicking or dragging files"
          className={cn(
            "group flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-all cursor-pointer",
            isDragging
              ? "border-blue-500 bg-blue-50/50 dark:bg-blue-500/10"
              : "border-zinc-200 bg-zinc-50/50 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/30 dark:hover:border-zinc-700"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <UploadCloud className="h-5 w-5" />
          </span>

          <div>
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Click to select or drag and drop invoice files
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              Instant magic-bytes verification, SHA-256 duplicate check & rule evaluation
            </p>
          </div>
        </div>

        {/* Live Ingestion Queue / Results */}
        {queue.length > 0 && (
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="font-semibold uppercase tracking-wider text-[10px]">
                Session Documents ({queue.length})
              </span>
              <button
                type="button"
                onClick={() => setQueue([])}
                className="text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                Clear list
              </button>
            </div>

            <div className="space-y-2">
              {queue.map((item) => {
                const decisionCfg = item.result?.decision
                  ? getDecisionConfig(item.result.decision.decision)
                  : null;

                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/40"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-zinc-600 shadow-2xs dark:bg-zinc-800 dark:text-zinc-300">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {item.name}
                        </p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {formatBytes(item.size)}
                          {item.result?.fields?.total && (
                            <> · {formatRupee(item.result.fields.total)}</>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 self-end sm:self-center">
                      {item.stage === "uploading" && (
                        <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                          <span>Uploading...</span>
                        </span>
                      )}

                      {item.stage === "extracting" && (
                        <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                          <span>Extracting OCR...</span>
                        </span>
                      )}

                      {item.stage === "validating" && (
                        <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
                          <span>Auditing rules...</span>
                        </span>
                      )}

                      {item.stage === "failed" && (
                        <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span>{item.error || "Failed"}</span>
                        </span>
                      )}

                      {item.stage === "completed" && decisionCfg && (
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              decisionCfg.badgeClass
                            )}
                          >
                            <decisionCfg.icon className="h-3 w-3" />
                            {decisionCfg.label}
                          </span>

                          {item.result?.id && (
                            <Link
                              href={`/invoices/${item.result.id}`}
                              className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors shadow-2xs"
                            >
                              <span>View Details</span>
                              <ArrowRight className="h-3 w-3" />
                            </Link>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          setQueue((prev) => prev.filter((q) => q.id !== item.id))
                        }
                        className="text-zinc-400 hover:text-zinc-600 p-0.5"
                        aria-label="Remove item"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
