"use client";
/**
 * NavTabs — Tab navigation between Dashboard and Analytics.
 *
 * Uses window.location.pathname to determine the active tab.
 * Each tab is a simple <a> tag (no client-side routing library
 * needed for two pages).
 *
 * Design matches existing shell conventions: small, muted,
 * active tab gets a bottom-border indicator.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Dashboard" },
  { href: "/analytics", label: "Analytics" },
] as const;

export function NavTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="border-t border-border">
      <div className="mx-auto flex max-w-screen-md gap-0 px-3 sm:px-5">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative px-4 py-2 text-[11px] font-semibold uppercase tracking-wider transition ${
                isActive
                  ? "text-signal"
                  : "text-muted hover:text-ink"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              {tab.label}
              {isActive && (
                <span
                  className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-signal"
                  aria-hidden
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
