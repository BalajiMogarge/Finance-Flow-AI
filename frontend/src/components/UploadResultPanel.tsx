"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  DecisionResult,
  ExtractedFields,
  UploadResponse,
  ValidationResult,
} from "@/lib/api";

type Props = {
  result: UploadResponse;
  onDismiss: () => void;
};

const DECISION_BADGE: Record<string, { label: string; className: string }> = {
  APPROVE: {
    label: "Approved",
    className:
      "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  },
  REJECT: {
    label: "Rejected",
    className:
      "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
  },
  "PENDING REVIEW": {
    label: "Pending review",
    className:
      "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
  },
};

const RISK_BADGE: Record<string, { label: string; className: string; icon: typeof ShieldCheck }> = {
  LOW: {
    label: "Low risk",
    className:
      "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    icon: ShieldCheck,
  },
  MEDIUM: {
    label: "Medium risk",
    className:
      "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
    icon: Clock,
  },
  HIGH: {
    label: "High risk",
    className:
      "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
    icon: ShieldAlert,
  },
};

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const str = String(value).trim();
  return str.length === 0 ? "—" : str;
}

export function UploadResultPanel({ result, onDismiss }: Props) {
  const decision: DecisionResult | undefined = result.decision;
  const fields: ExtractedFields = result.fields ?? {};
  const validation: ValidationResult | undefined = result.validation;

  const decisionKey = decision?.decision ?? "PENDING REVIEW";
  const decisionBadge = DECISION_BADGE[decisionKey] ?? DECISION_BADGE["PENDING REVIEW"];

  const riskKey = decision?.risk_level ?? "MEDIUM";
  const riskBadge = RISK_BADGE[riskKey] ?? RISK_BADGE.MEDIUM;
  const RiskIcon = riskBadge.icon;

  return (
    <section
      aria-label="Latest upload result"
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white shadow-sm",
        "dark:border-zinc-800 dark:bg-zinc-950"
      )}
    >
      <header className="flex items-center justify-between gap-4 border-b border-zinc-100 px-6 py-4 dark:border-zinc-900">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
            aria-hidden
          >
            <FileText className="h-4 w-4" />
          </span>
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Latest upload result
            </h2>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {result.filename}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss result"
          className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        {/* Decision */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Decision
          </p>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                decisionBadge.className
              )}
            >
              {decisionBadge.label}
            </span>
          </div>
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  riskBadge.className
                )}
              >
                <RiskIcon className="h-3 w-3" />
                {riskBadge.label}
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Confidence:{" "}
              <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                {formatPercent(decision?.confidence)}
              </span>
            </p>
            {decision?.reason && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {decision.reason}
              </p>
            )}
          </div>
        </div>

        {/* Extracted fields */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Extracted fields
          </p>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-zinc-500 dark:text-zinc-400">Vendor</dt>
              <dd className="truncate text-right font-medium text-zinc-900 dark:text-zinc-50">
                {dash(fields.vendor)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-zinc-500 dark:text-zinc-400">Invoice #</dt>
              <dd className="truncate text-right font-mono text-xs font-medium text-zinc-900 dark:text-zinc-50">
                {dash(fields.invoice_number)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-zinc-500 dark:text-zinc-400">GSTIN</dt>
              <dd className="truncate text-right font-mono text-xs font-medium text-zinc-900 dark:text-zinc-50">
                {dash(fields.gstin)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-zinc-500 dark:text-zinc-400">Date</dt>
              <dd className="truncate text-right font-medium text-zinc-900 dark:text-zinc-50">
                {dash(fields.date)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-zinc-500 dark:text-zinc-400">Total</dt>
              <dd className="truncate text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {formatCurrency(fields.total)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Validation */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Validation
          </p>
          <div className="flex items-center gap-2">
            {validation?.passed ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                  "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                )}
              >
                <CheckCircle2 className="h-3 w-3" />
                Passed
              </span>
            ) : (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                  "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                )}
              >
                <AlertTriangle className="h-3 w-3" />
                Failed
              </span>
            )}
          </div>
          <div className="space-y-3 pt-1">
            <div>
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Errors ({validation?.errors.length ?? 0})
              </p>
              {validation?.errors.length ? (
                <ul className="mt-1 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {validation.errors.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  None
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Warnings ({validation?.warnings.length ?? 0})
              </p>
              {validation?.warnings.length ? (
                <ul className="mt-1 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {validation.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  None
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
