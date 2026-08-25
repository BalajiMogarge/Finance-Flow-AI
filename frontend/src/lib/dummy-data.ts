/**
 * Dummy data for the dashboard. Replace with real API responses
 * once the FastAPI endpoints are wired up.
 */

export type InvoiceStatus = "verified" | "pending" | "flagged";

export type Invoice = {
  id: string;
  vendor: string;
  amount: number;
  date: string; // ISO date
  status: InvoiceStatus;
};

export type Stat = {
  label: string;
  value: string;
  delta: string; // e.g. "+12.4%"
  trend: "up" | "down";
  iconName: "FileText" | "CheckCircle2" | "Clock" | "AlertTriangle";
};

export const stats: Stat[] = [
  {
    label: "Total invoices",
    value: "1,284",
    delta: "+12.4%",
    trend: "up",
    iconName: "FileText",
  },
  {
    label: "Verified",
    value: "1,106",
    delta: "+9.1%",
    trend: "up",
    iconName: "CheckCircle2",
  },
  {
    label: "Pending review",
    value: "138",
    delta: "-3.2%",
    trend: "down",
    iconName: "Clock",
  },
  {
    label: "Flagged",
    value: "40",
    delta: "+2.0%",
    trend: "up",
    iconName: "AlertTriangle",
  },
];

export const recentInvoices: Invoice[] = [
  {
    id: "INV-10248",
    vendor: "Acme Logistics",
    amount: 4820.5,
    date: "2026-08-22",
    status: "verified",
  },
  {
    id: "INV-10247",
    vendor: "Northwind Traders",
    amount: 1240.0,
    date: "2026-08-22",
    status: "pending",
  },
  {
    id: "INV-10246",
    vendor: "Globex Office Supply",
    amount: 319.75,
    date: "2026-08-21",
    status: "verified",
  },
  {
    id: "INV-10245",
    vendor: "Initech Software",
    amount: 9850.0,
    date: "2026-08-21",
    status: "flagged",
  },
  {
    id: "INV-10244",
    vendor: "Hooli Cloud",
    amount: 2150.4,
    date: "2026-08-20",
    status: "verified",
  },
  {
    id: "INV-10243",
    vendor: "Soylent Catering",
    amount: 612.25,
    date: "2026-08-20",
    status: "pending",
  },
  {
    id: "INV-10242",
    vendor: "Wayne Industrial",
    amount: 7430.0,
    date: "2026-08-19",
    status: "verified",
  },
];

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
