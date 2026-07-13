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
 *
 * Phase 8: forwards rows to the transfer dialog's reverse flow. The
 * page supplies an `onReverse(transferId, reason)` callback, the set
 * of ids that already have a compensating row, and the set of ids
 * currently mid-POST so the button can show a spinner / disable
 * itself. The row itself never knows how to talk to the server — it
 * just bubbles an intent upward. That keeps this component testable
 * with a click handler only and lets the page own retry / jitter.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
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
  /** Forwarded from the page's reverseTransfer handler. Resolves once
   *  the POST returns (regardless of status) so the row can clear its
   *  pending state. Receives a free-text reason from the inline
   *  textarea (≤ 120 chars, matching the route's MAX_REASON_LEN). */
  onReverse?: (
    transferId: string,
    reason: string,
  ) => Promise<void> | void;
  /** Transfer ids that already have a compensating row attached. The
   *  caller builds this from the same `transfers` array (matching by
   *  `reversesTransferId`) — we don't recompute it here so the page
   *  controls the refresh cadence after a POST. */
  alreadyReversedIds?: ReadonlySet<string>;
  /** Transfer ids currently mid-POST. Used by the row to disable
   *  itself and show a spinner. */
  reversingIds?: ReadonlySet<string>;
  /** Phase 9: when true, render a "Load older" footer that fetches
   *  the next keyset page from the server. When false (or undefined)
   *  we render no footer — the parent has the full list already. */
  hasMore?: boolean;
  /** Phase 9: while a "Load older" request is in flight, the button
   *  shows a spinner and ignores further clicks. */
  loadingOlder?: boolean;
  /** Phase 9: invoked when the user clicks "Load older". The parent
   *  owns the cursor state and the append logic. */
  onLoadOlder?: () => Promise<void> | void;
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
  // Derived: is this row itself a compensating transfer (i.e. it's
  // already a reversal)? When true we render the "Reversed" badge and
  // never expose the Reverse button.
  isCompensation: boolean;
  // Derived: does some OTHER row in this page point back at this one
  // via `reversesTransferId`? When true, the original has already
  // been reversed and we hide the affordance.
  originalIsReversed: boolean;
}

type AnyRow = EntryRow | TransferRow;

/**
 * Phase 11: keep the IntersectionObserver wiring isolated so it can
 * be unit-tested without a DOM. The hook is exported *only* so the
 * sibling test file can exercise it; production code should treat it
 * as an implementation detail of RecentEntries.
 *
 * Behaviour:
 *  - When `hasMore` is false, or `onLoadOlder` is absent, the hook
 *    is a no-op (we never construct an observer, so there's no
 *    memory to clean up).
 *  - When `hasMore` flips off mid-flight, the observer is
 *    disconnected (not just unobserved) so a late-arriving
 *    intersection can't trigger one more stale fetch.
 *  - rootMargin fires 400px *before* the sentinel reaches the
 *    viewport — the next page is already in flight by the time the
 *    user reaches the bottom.
 *  - We deliberately do NOT call `onLoadOlder` while `loadingOlder`
 *    is true. The page already disables the button on that prop, so
 *    keeping the same gate here means a fast scroll-spam can't
 *    double-fetch.
 *  - Falls back to no-op if `IntersectionObserver` isn't on the
 *    global (very old browsers); the explicit button is the
 *    fallback in that case.
 */
export function useAutoLoadOnIntersect(
  ref: RefObject<HTMLElement | null>,
  hasMore: boolean | undefined,
  loadingOlder: boolean | undefined,
  onLoadOlder: (() => Promise<void> | void) | undefined,
): void {
  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || !onLoadOlder) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (shouldAutoLoad(entries, loadingOlder)) {
          void onLoadOlder();
        }
      },
      { rootMargin: "400px 0px 400px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [ref, hasMore, loadingOlder, onLoadOlder]);
}

/**
 * Pure predicate extracted from the IntersectionObserver callback so
 * it can be unit-tested without a DOM. Returns true iff any entry
 * is intersecting AND we're not already mid-fetch. Exported for
 * tests only.
 */
export function shouldAutoLoad(
  entries: ReadonlyArray<{ isIntersecting: boolean }>,
  loadingOlder: boolean | undefined,
): boolean {
  if (loadingOlder) return false;
  for (const entry of entries) {
    if (entry.isIntersecting) return true;
  }
  return false;
}

export function RecentEntries({
  entries,
  transfers,
  previousByProvider,
  freshIds,
  onReverse,
  alreadyReversedIds,
  reversingIds,
  hasMore,
  loadingOlder,
  onLoadOlder,
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
      isCompensation: t.reversesTransferId !== null,
      originalIsReversed: Boolean(
        (alreadyReversedIds ?? new Set<string>()).has(t.transferId),
      ),
    }));
    return [...balanceRows, ...transferRows].sort((a, b) => b.ts - a.ts);
  }, [entries, transfers, previousByProvider, freshIds, alreadyReversedIds]);

  const totalCount = entries.length + (transfers?.length ?? 0);

  // Phase 11: auto-load the next page when the user scrolls (or
  // tabs) to the bottom of the list. The explicit "Load older"
  // button stays as the no-IntersectionObserver / keyboard
  // fallback — both paths funnel through the same onLoadOlder
  // callback so the page's dedupe + cursor logic stays simple.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useAutoLoadOnIntersect(sentinelRef, hasMore, loadingOlder, onLoadOlder);

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
                    isCompensation={row.isCompensation}
                    originalIsReversed={row.originalIsReversed}
                    pending={Boolean(
                      (reversingIds ?? new Set<string>()).has(
                        row.transfer.transferId,
                      ),
                    )}
                    onReverse={onReverse}
                  />
                ),
              )}
            </ul>
          )}

          {/* Phase 9: keyset pagination footer. Renders only when the
              parent tells us there's another page; while loading, the
              button disables and the label switches to "Loading…".
              When the cursor is null and at least one row is shown,
              we surface an "End of history" hint so the user knows
              they reached the bottom without an empty footer flash.

              Phase 11: the IntersectionObserver above watches the
              sentinel div below. The visible button stays as the
              no-IntersectionObserver / keyboard fallback so this
              control is still reachable when JS support is partial
              or the list is too short to scroll. The aria-live
              region mirrors the button label so screen readers hear
              "Loading…" once per fetch without us having to manage
              focus manually. */}
          {hasMore && onLoadOlder ? (
            <div className="border-t border-border px-4 py-3 sm:px-5">
              <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
              <p className="sr-only" aria-live="polite">
                {loadingOlder ? "Loading older activity…" : ""}
              </p>
              <button
                type="button"
                onClick={() => void onLoadOlder()}
                disabled={loadingOlder}
                className="mt-3 w-full rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted transition hover:border-ink/30 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                aria-label="Load older activity"
              >
                {loadingOlder ? "Loading older activity…" : "Load older activity"}
              </button>
            </div>
          ) : rows.length > 0 ? (
            <p className="border-t border-border px-4 py-2 text-center text-[10px] uppercase tracking-wide text-muted sm:px-5">
              End of history
            </p>
          ) : null}
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

function TransferRowView({
  transfer,
  isCompensation,
  originalIsReversed,
  pending,
  onReverse,
}: {
  transfer: Transfer;
  isCompensation: boolean;
  originalIsReversed: boolean;
  pending: boolean;
  onReverse?: (
    transferId: string,
    reason: string,
  ) => Promise<void> | void;
}) {
  // Two-stage confirm: first click reveals the textarea + Confirm/Cancel
  // buttons; second click submits. Cancel collapses the panel without
  // POSTing. We hold the reason locally so the page doesn't need to
  // track per-row state.
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  const showReverseButton =
    !isCompensation && !originalIsReversed && onReverse !== undefined;

  const submit = () => {
    if (!onReverse) return;
    const trimmed = reason.trim().slice(0, 120);
    setConfirming(false);
    setReason("");
    void onReverse(transfer.transferId, trimmed);
  };

  const cancel = () => {
    setConfirming(false);
    setReason("");
  };

  const amountBdt = (transfer.amountBdt as number) / 100;

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:px-5">
      <div className="flex items-center gap-3">
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
            {isCompensation ? (
              <span
                className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900"
                title="This row reverses a previous transfer."
              >
                Reversed
              </span>
            ) : null}
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
        {showReverseButton ? (
          confirming ? (
            <div className="flex flex-none items-center gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={pending}
                className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted transition hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded-md bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                Confirm reverse
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={pending}
              className="flex-none rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
              aria-label={`Reverse transfer of ${formatBDT(amountBdt)} from ${PROVIDER_LABEL[transfer.fromProvider]} to ${PROVIDER_LABEL[transfer.toProvider]}`}
            >
              {pending ? "Reversing…" : "Reverse"}
            </button>
          )
        ) : null}
      </div>

      {confirming ? (
        <div className="ml-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label
            className="text-[10px] font-semibold uppercase tracking-wide text-muted"
            htmlFor={`reverse-reason-${transfer.transferId}`}
          >
            Reason (optional)
          </label>
          <input
            id={`reverse-reason-${transfer.transferId}`}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 120))}
            maxLength={120}
            placeholder="e.g. wrong recipient"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-ink outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
            autoFocus
          />
        </div>
      ) : null}
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