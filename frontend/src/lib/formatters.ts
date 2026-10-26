import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

/**
 * Format numeric value in Indian Rupees (₹) with Indian digit grouping (lakhs/crores).
 * Example: 123456.78 -> ₹1,23,456.78
 */
export function formatRupee(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(value));
}

/**
 * Format numeric value without currency symbol but with Indian number formatting.
 * Example: 123456.78 -> 1,23,456.78
 */
export function formatIndianNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(Number(value));
}

/**
 * Format ISO date string into Indian standard date format: DD/MM/YYYY, HH:MM
 */
export function formatDateTimeIndian(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  return `${day}/${month}/${year}, ${hours}:${minutes}`;
}

/**
 * Format ISO date string into Indian standard date format: DD/MM/YYYY
 */
export function formatDateOnlyIndian(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

/**
 * Format a 0..1 confidence float as a percentage.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return "—";
  return `${(num * 100).toFixed(1)}%`;
}

export type DecisionConfig = {
  key: string;
  label: string;
  className: string;
  badgeClass: string;
  dotClass: string;
  icon: typeof CheckCircle2;
};

export function getDecisionConfig(rawDecision: string | null | undefined): DecisionConfig {
  const norm = (rawDecision || "").toUpperCase().trim();

  if (norm === "APPROVE" || norm === "APPROVED") {
    return {
      key: "APPROVE",
      label: "Approved",
      className: "text-emerald-700 dark:text-emerald-400",
      badgeClass:
        "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60",
      dotClass: "bg-emerald-500",
      icon: CheckCircle2,
    };
  }

  if (norm === "REJECT" || norm === "REJECTED") {
    return {
      key: "REJECT",
      label: "Rejected",
      className: "text-red-700 dark:text-red-400",
      badgeClass:
        "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60",
      dotClass: "bg-red-500",
      icon: AlertTriangle,
    };
  }

  if (norm === "PENDING REVIEW" || norm === "PENDING" || norm === "REVIEW") {
    return {
      key: "PENDING REVIEW",
      label: "Needs Review",
      className: "text-amber-700 dark:text-amber-400",
      badgeClass:
        "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60",
      dotClass: "bg-amber-500",
      icon: Clock,
    };
  }

  if (norm === "PROCESSING") {
    return {
      key: "PROCESSING",
      label: "Processing",
      className: "text-blue-700 dark:text-blue-400",
      badgeClass:
        "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/60",
      dotClass: "bg-blue-500",
      icon: Loader2,
    };
  }

  return {
    key: norm || "UNKNOWN",
    label: norm || "Unknown",
    className: "text-zinc-600 dark:text-zinc-400",
    badgeClass:
      "bg-zinc-100 text-zinc-700 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
    dotClass: "bg-zinc-400",
    icon: Clock,
  };
}

export type RiskConfig = {
  key: string;
  label: string;
  badgeClass: string;
  icon: typeof ShieldCheck;
};

export function getRiskConfig(rawRisk: string | null | undefined): RiskConfig {
  const norm = (rawRisk || "").toUpperCase().trim();

  if (norm === "LOW") {
    return {
      key: "LOW",
      label: "Low Risk",
      badgeClass:
        "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60",
      icon: ShieldCheck,
    };
  }

  if (norm === "HIGH") {
    return {
      key: "HIGH",
      label: "High Risk",
      badgeClass:
        "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60",
      icon: ShieldAlert,
    };
  }

  return {
    key: "MEDIUM",
    label: "Medium Risk",
    badgeClass:
      "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60",
    icon: Clock,
  };
}
