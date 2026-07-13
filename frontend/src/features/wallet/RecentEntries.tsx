"use client";
/**
 * RecentEntries — reverse-chronological log of every balance update
 * + every transfer.
 *
 * Reuses LiquiGuard's "evidence panel" visual pattern: compact rows,
 * provider dot, old → new balance, relative timestamp. Collapsible on
 * mobile so the hero / cards stay above the fold.
 *
 * Transfer rows render differently — they show BOTH endpoints (e.g.
 * "bKash → Nagad ৳100") because the move itself is the unit of
 * meaning, not a single provider's new balance. Manual balance
 * entries keep their single-provider "X → Y" rendering.
 *
 * Empty state uses friendly placeholder copy per spec section 3.3.
 *
 * Phase 7: accepts a `transfers` prop and interleaves them with the
 * balance log by timestamp. The page passes an empty array when no
 * transfers exist yet (or no persona is active).
 */

import { useMemo, useState } from "react";
import {
  PROVIDER_LABEL,
  PROVIDER_HEX,
  type BalanceEntry,
} from "./types";
import type { Transfer } from "@/lib/domain/entities/transfer";
import { formatBDT, formatRelative } from "@/lib/time";

interface RecentEntriesProps {
  entries: BalanceEntry[];
  transfers?: ReadonlyArray<Transfer>;
  /** Map of provider → previous balance before the most recent update
   *  for that provider. Used to render the "old → new" delta. */
  previousByProvider: Record<string, number | undefined>;
  /** IDs of rows that should slide in on first paint. Caller adds to
   *  this set when an entry is optimistically dispatched; we play the
   *  animation only on initial appearance (not on every re-render of
   *  an existing row). */
  freshIds?: ReadonlySet<string>;
}

interface EntryRow {
  kind: "balance";
  ts: number;
  key: string;
  entry: BalanceEntry;
  previous?: number;
  fresh: boolean;
}

interface TransferRow {
  kind: "transfer";
  ts: number;
  key: string;
  transfer: Transfer;
}

type AnyRow = EntryRow | TransferRow;

export function RecentEntries({
  entries,
  transfers,
  previousByProvider,
  freshIds,
}: RecentEntriesProps) {
  const [open, setOpen] = useState(true);

  // Merge + sort newest-first. Transfers come from the server with their
  // own epoch-ms `ts`; balance entries carry an ISO timestamp that we
  // parse to ms so the comparison is apples-to-apples.
  const rows = useMemo<AnyRow[]>(() => {
    const balanceRows: EntryRow[] = entries.map((e) => ({
      kind: "balance" as const,
      ts: Date.parse(e.timestamp) || 0,
      key: `bal:${e.id}`,
      entry: e,
      previous: previousByProvider[e.provider],
      fresh: Boolean(freshIds?.has(e.id)),
    }));
    const transferRows: TransferRow[] = (transfers ?? []).map((t) => ({
      kind: "transfer" as const,
      ts: t.ts,
      key: `tx:${t.transferId}`,
      transfer: t,
    }));
    return [...balanceRows, ...transferRows].sort((a, b) => b.ts - a.ts);
  }, [entries, transfers, previousByProvider, freshIds]);

  const totalCount = entries.length + (transfers?.length ?? 0);

  return (
    <section
      aria-label="Recent activity"
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
          <span className="eyebrow">Recent Activity</span>
          <span className="num rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">
            {totalCount}
          </span>
        </div>
        <ChevronIcon className={open ? "rotate-180" : ""} />
      </button>

      {open && (
        <div id="recent-entries-list" className="border-t border-border">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted sm:px-5">
              No activity yet. Update a balance above to get started.
            </p>
          ) : (
            <ul role="list" className="divide-y divide-border">
              {rows.map((row) =>
                row.kind === "balance" ? (
                  <BalanceRowView
                    key={row.key}
                    entry={row.entry}
                    previous={row.previous}
                    fresh={row.fresh}
                  />
                ) : (
                  <TransferRowView
                    key={row.key}
                    transfer={row.transfer}
                  />
                ),
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function BalanceRowView({
  entry,
  previous,
  fresh,
}: {
  entry: BalanceEntry;
  previous?: number;
  fresh: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-3 px-4 py-3 sm:px-5${fresh ? " log-row-enter" : ""}`}
    >
      <span
        className="inline-block h-2 w-2 flex-none rounded-full"
        style={{ background: PROVIDER_HEX[entry.provider] }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-ink">
          {PROVIDER_LABEL[entry.provider]}
        </span>
        <span className="num block text-[11px] text-muted">
          {previous !== undefined ? (
            <>
              {formatBDT(previous)} → {formatBDT(entry.balance)}
            </>
          ) : (
            <>Set to {formatBDT(entry.balance)}</>
          )}
        </span>
      </span>
      <time
        dateTime={entry.timestamp}
        className="num flex-none text-[11px] text-muted"
      >
        {formatRelative(entry.timestamp)}
      </time>
    </li>
  );
}

function TransferRowView({ transfer }: { transfer: Transfer }) {
  // Render: "bKash → Nagad ৳100.00" with a two-dot indicator that
  // mirrors the source/target colour. The note (if any) renders
  // underneath as a faint second line.
  const amountBdt = (transfer.amountBdt as number) / 100;
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="flex flex-none items-center gap-1" aria-hidden>
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: PROVIDER_HEX[transfer.fromProvider] }}
        />
        <ArrowIcon />
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: PROVIDER_HEX[transfer.toProvider] }}
        />
      </div>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-ink">
          {PROVIDER_LABEL[transfer.fromProvider]}
          <span className="mx-1 text-muted" aria-hidden>→</span>
          {PROVIDER_LABEL[transfer.toProvider]}
          <span className="num ml-2 text-ink">{formatBDT(amountBdt)}</span>
        </span>
        {transfer.note ? (
          <span className="block truncate text-[11px] text-muted">
            {transfer.note}
          </span>
        ) : (
          <span className="num block text-[11px] text-muted">
            {formatBDT(transfer.fromAfter as number)} →{" "}
            {formatBDT(transfer.toAfter as number)}
          </span>
        )}
      </span>
      <time
        dateTime={new Date(transfer.ts).toISOString()}
        className="num flex-none text-[11px] text-muted"
      >
        {formatRelative(new Date(transfer.ts).toISOString())}
      </time>
    </li>
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

function ArrowIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-muted"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}