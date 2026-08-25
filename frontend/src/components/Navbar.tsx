import Link from "next/link";
import { Bell, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

type NavItem = { label: string; href: string; active?: boolean };

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", active: true },
  { label: "Invoices", href: "/invoices" },
  { label: "Vendors", href: "/vendors" },
  { label: "Reports", href: "/reports" },
  { label: "Settings", href: "/settings" },
];

export function Navbar() {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full",
        "border-b border-zinc-200/70 bg-white/80 backdrop-blur",
        "dark:border-zinc-800/70 dark:bg-zinc-950/80"
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link
          href="/"
          className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50"
        >
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              "bg-blue-600 text-white shadow-sm"
            )}
            aria-hidden
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">
            Finance Flow <span className="text-blue-600">AI</span>
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                item.active
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Spacer */}
        <div className="ml-auto flex items-center gap-2">
          {/* Search */}
          <label
            className={cn(
              "hidden items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5",
              "text-sm text-zinc-500 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20",
              "dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 sm:flex"
            )}
          >
            <Search className="h-4 w-4" />
            <input
              type="search"
              placeholder="Search invoices, vendors…"
              className="w-48 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-50"
            />
            <kbd className="hidden rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 lg:inline dark:border-zinc-800 dark:bg-zinc-950">
              ⌘K
            </kbd>
          </label>

          {/* Notifications */}
          <button
            type="button"
            aria-label="Notifications"
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-colors",
              "hover:bg-zinc-50 hover:text-zinc-900",
              "dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            )}
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-blue-600" />
          </button>

          {/* Avatar */}
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full",
              "bg-gradient-to-br from-zinc-200 to-zinc-300 text-sm font-semibold text-zinc-700",
              "dark:from-zinc-700 dark:to-zinc-800 dark:text-zinc-100"
            )}
            aria-label="User"
          >
            JD
          </div>
        </div>
      </div>
    </header>
  );
}
