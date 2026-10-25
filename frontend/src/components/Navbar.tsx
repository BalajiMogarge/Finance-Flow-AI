"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, LogOut, Menu, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  checkHealth,
  fetchCurrentUser,
  fetchStats,
  getStoredToken,
  logout,
  type UserProfile,
} from "@/lib/api";

type BackendStatus = "online" | "checking" | "offline";

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");

  const checkStatus = useCallback(async () => {
    try {
      await checkHealth();
      setBackendStatus("online");
    } catch {
      setBackendStatus("offline");
    }
  }, []);

  const loadStatsAndUser = useCallback(async () => {
    const token = getStoredToken();
    if (token) {
      fetchCurrentUser()
        .then((profile) => setUser(profile))
        .catch(() => setUser(null));
    } else {
      setUser(null);
    }

    try {
      const stats = await fetchStats();
      setPendingCount(stats.pending || 0);
    } catch {
      // Ignore if offline
    }
  }, []);

  useEffect(() => {
    checkStatus();
    loadStatsAndUser();

    function onRefresh() {
      checkStatus();
      loadStatsAndUser();
    }

    window.addEventListener("finance-flow:refresh", onRefresh);
    return () => {
      window.removeEventListener("finance-flow:refresh", onRefresh);
    };
  }, [checkStatus, loadStatsAndUser]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    setShowDropdown(false);
  }, [pathname]);

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email
      ? user.email.slice(0, 2).toUpperCase()
      : null;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full",
        "border-b border-zinc-200/80 bg-white/90 backdrop-blur-md",
        "dark:border-zinc-800/80 dark:bg-zinc-950/90"
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand & Desktop Nav */}
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-zinc-900 transition-opacity hover:opacity-90 dark:text-zinc-50"
          >
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                "bg-blue-600 text-white shadow-xs"
              )}
              aria-hidden
            >
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-base font-semibold tracking-tight">
              Finance Flow <span className="text-blue-600 font-bold">AI</span>
            </span>
          </Link>

          {/* Desktop primary nav */}
          <nav className="hidden md:flex items-center gap-1.5" aria-label="Main Navigation">
            <Link
              href="/"
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                pathname === "/"
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800/70 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:text-zinc-50 dark:hover:bg-zinc-900"
              )}
            >
              Dashboard
            </Link>

            <Link
              href="/invoices"
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                pathname?.startsWith("/invoices")
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800/70 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:text-zinc-50 dark:hover:bg-zinc-900"
              )}
            >
              <span>Invoices</span>
              {pendingCount > 0 && (
                <span
                  title={`${pendingCount} invoices awaiting manual review`}
                  className="inline-flex items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.2 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/80 dark:text-amber-300"
                >
                  {pendingCount}
                </span>
              )}
            </Link>
          </nav>
        </div>

        {/* Desktop Right Side: Backend Status + User Profile */}
        <div className="hidden md:flex items-center gap-4">
          {/* Subtle Backend Status Indicator */}
          <button
            type="button"
            onClick={checkStatus}
            title="Click to re-check API status"
            className="flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-zinc-50/70 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400 dark:hover:border-zinc-700"
          >
            {backendStatus === "online" && (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>API Online</span>
              </>
            )}
            {backendStatus === "checking" && (
              <>
                <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-500" />
                <span>Connecting</span>
              </>
            )}
            {backendStatus === "offline" && (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                <span>API Offline</span>
              </>
            )}
          </button>

          {/* User profile dropdown or Sign in */}
          {user ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowDropdown((prev) => !prev)}
                className="flex items-center gap-2 rounded-full p-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors focus:outline-none"
                aria-expanded={showDropdown}
                aria-haspopup="true"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white shadow-xs">
                  {initials || "U"}
                </span>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 max-w-[120px] truncate">
                  {user.full_name || user.email.split("@")[0]}
                </span>
              </button>

              {showDropdown && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 animate-in fade-in-50 zoom-in-95">
                  <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-900">
                    <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                      {user.full_name || "User"}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {user.email}
                    </p>
                    {user.organization_name && (
                      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
                        Org: {user.organization_name}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      logout();
                      setUser(null);
                      setShowDropdown(false);
                      router.push("/login");
                    }}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 shadow-2xs"
            >
              Sign In
            </Link>
          )}
        </div>

        {/* Mobile Hamburger Button */}
        <div className="flex md:hidden items-center gap-2">
          {/* Mobile status indicator */}
          <span
            title={`API: ${backendStatus}`}
            className="flex h-5 w-5 items-center justify-center"
          >
            {backendStatus === "online" ? (
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            ) : backendStatus === "checking" ? (
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-red-500" />
            )}
          </span>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950 animate-in slide-in-from-top-2">
          <nav className="flex flex-col gap-1.5" aria-label="Mobile Navigation">
            <Link
              href="/"
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === "/"
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
              )}
            >
              Dashboard
            </Link>

            <Link
              href="/invoices"
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname?.startsWith("/invoices")
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
              )}
            >
              <span>Invoices & Reconciliation</span>
              {pendingCount > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {pendingCount} review
                </span>
              )}
            </Link>

            <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-900 flex flex-col gap-2">
              <div className="flex items-center justify-between px-3 text-xs text-zinc-500">
                <span>Backend Status</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300 capitalize">
                  {backendStatus}
                </span>
              </div>

              {user ? (
                <div className="px-3 pt-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {user.full_name || user.email}
                      </p>
                      <p className="text-[11px] text-zinc-500 truncate">{user.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        logout();
                        setUser(null);
                        setMobileMenuOpen(false);
                        router.push("/login");
                      }}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Sign out
                    </button>
                  </div>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="mt-1 flex items-center justify-center rounded-lg bg-zinc-900 py-2 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Sign In
                </Link>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
