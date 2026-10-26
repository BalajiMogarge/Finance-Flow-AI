import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ColdStartBanner } from "@/components/ColdStartBanner";
import { ToastProvider } from "@/components/Toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Finance Flow AI — Deterministic Invoice Audit & Reconciliation",
  description:
    "Deterministic corporate invoice verification, GSTIN checksum auditing, and human exception workflow.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <ToastProvider>
          <ColdStartBanner />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
