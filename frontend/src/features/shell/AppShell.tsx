"use client";
/**
 * Minimal app shell for WalletSync — header + theme toggle, nothing else.
 *
 * Deliberately stripped down compared to LiquiGuard's Shell:
 *  - No role switcher (single role: personal balance viewer)
 *  - No SSE / telemetry indicator (no network calls in v1)
 *  - No InstallAppBanner (PWA shell is deferred per spec section 1)
 *  - No QueryClient (no server-state fetching in v1)
 *
 * The ThemeToggle is the only piece of state outside the page.
 */

import type { ReactNode } from "react";
import { ThemeToggle } from "@/features/shell/ThemeToggle";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-base text-ink">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 shadow-card backdrop-blur-xl">
        <div className="mx-auto flex max-w-screen-md items-center justify-between gap-3 px-3 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-6 w-6 rounded-lg bg-signal" aria-hidden />
            <div>
              <div className="text-base font-bold tracking-tight text-ink">WalletSync</div>
              <div className="text-[11px] font-medium text-muted sm:text-xs">
                Multi-provider balance viewer
              </div>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-screen-md flex-1 px-3 py-4 sm:px-5 sm:py-6">
        {children}
      </main>
    </div>
  );
}
