"use client";
/**
 * RecentEntries — reverse-chronological log of every balance update.
 *
 * Reuses LiquiGuard's "evidence panel" visual pattern: compact rows,
 * provider dot, old → new balance, relative timestamp. Collapsible on
 * mobile so the hero / cards stay above the fold.
 *
 * Empty state uses friendly placeholder copy per spec section 3.3.
 */

import { useState } from "react";
import {
  PROVIDER_LABEL,
  PROVIDER_HEX,
  type BalanceEntry,
} from "./types";
import { formatBDT, formatRelative } from "@/lib/time";

interface RecentEntriesProps {
  entries: BalanceEntry[];
  /** Map of provider → previous balance before the most recent update
   *  for that provider. Used to render the "old → new" delta. */
  previousByProvider: Record<string, number | undefined>;
}

export function RecentEntries({ entries, previousByProvider }: RecentEntriesProps) {
  const [open, setOpen] = useState(true);

  return (
    <section
      aria-label="Recent balance updates"
      className="rounded-2xl border border-border bg-surface shadow-card"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="recent-entries-list"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2 sm:px-5"
      >
        <div className="flex items-center gap-2">
          <span className="eyebrow">Recent Entries</span>
          <span className="num rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">
            {entries.length}
          </span>
        </div>
        <ChevronIcon className={open ? "rotate-180" : ""} />
      </button>

      {open && (
        <div id="recent-entries-list" className="border-t border-border">
          {entries.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted sm:px-5">
              No entries yet. Update a balance above to get started.
            </p>
          ) : (
            <ul role="list" className="divide-y divide-border">
              {entries.map((e) => {
                const prev = previousByProvider[e.provider];
                return (
                  <li
                    key={e.id}
                    className="flex items-center gap-3 px-4 py-3 sm:px-5"
                  >
                    <span
                      className="inline-block h-2 w-2 flex-none rounded-full"
                      style={{ background: PROVIDER_HEX[e.provider] }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-ink">
                        {PROVIDER_LABEL[e.provider]}
                      </span>
                      <span className="num block text-[11px] text-muted">
                        {prev !== undefined ? (
                          <>
                            {formatBDT(prev)} → {formatBDT(e.balance)}
                          </>
                        ) : (
                          <>Set to {formatBDT(e.balance)}</>
                        )}
                      </span>
                    </span>
                    <time
                      dateTime={e.timestamp}
                      className="num flex-none text-[11px] text-muted"
                    >
                      {formatRelative(e.timestamp)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform ${className}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}