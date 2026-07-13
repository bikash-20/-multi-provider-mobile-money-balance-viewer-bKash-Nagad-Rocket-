"use client";
/**
 * WalletSync dashboard — single page, no routing.
 *
 * State model (spec §4, updated §8):
 *  - Server is the source of truth. On mount, GET /api/entries; entries
 *    populate the reducer via `set_entries`.
 *  - On edit, dispatch `update_balance` immediately (optimistic), POST
 *    to /api/entries. On failure, dispatch `remove_entry` to roll the
 *    optimistic row back, and surface an inline error.
 *  - Current balance per provider is derived from the most recent entry
 *    for that provider (selectors), never stored separately.
 *  - Total Balance is derived from those three current balances, never
 *    stored separately. Eliminates drift between header and cards.
 *
 * Phase 5 polish (investor demo):
 *  - Per-card sparkline + 7d delta badge via Sparkline / DeltaPctBadge.
 *  - Count-up animation on totals + balances via useCountUp.
 *  - Skeleton placeholders during initial load.
 *  - Slide-in animation for optimistically-added entries.
 *  - Demo badge + persona switcher in AppShell (loaded via /api/meta).
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { AppShell } from "@/features/shell/AppShell";
import { TotalBalanceHeader } from "@/features/wallet/TotalBalanceHeader";
import { ProviderBalanceCard } from "@/features/wallet/ProviderBalanceCard";
import { RecentEntries } from "@/features/wallet/RecentEntries";
import { TransferDialog } from "@/features/wallet/TransferDialog";
import { Skeleton } from "@/features/wallet/Skeleton";
import { initialState, reducer } from "@/features/wallet/reducer";
import {
  grandTotal,
  lastUpdatedAt,
  latestFor,
} from "@/features/wallet/selectors";
import { PROVIDERS, type BalanceEntry, type Provider } from "@/features/wallet/types";
import {
  buildDailySeries,
  type DailyPoint,
} from "@/lib/sparklineSeries";
import type { MetaSnapshot } from "@/lib/metaTypes";
import type { Transfer } from "@/lib/domain/entities/transfer";

function makeId(): string {
  // crypto.randomUUID exists in modern browsers + Node 19+; fallback
  // covers older runtimes without pulling a uuid dep.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface PendingUpdate {
  id: string;
  provider: Provider;
}

const SPARK_WINDOW_DAYS = 30;

export default function HomePage() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Record<string, PendingUpdate>>({});
  const [error, setError] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<MetaSnapshot | null>(null);
  const [transferFrom, setTransferFrom] = useState<Provider | null>(null);
  const [transfers, setTransfers] = useState<ReadonlyArray<Transfer>>([]);

  // Initial fetch — server is the source of truth. Both /api/entries
  // and /api/meta fire in parallel; whichever resolves first paints
  // its piece.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [entriesRes, metaRes, transfersRes] = await Promise.all([
          fetch("/api/entries", { cache: "no-store" }),
          fetch("/api/meta", { cache: "no-store" }),
          fetch("/api/transfers", { cache: "no-store" }),
        ]);
        if (!entriesRes.ok) {
          throw new Error(`GET /api/entries returned ${entriesRes.status}`);
        }
        const entries = (await entriesRes.json()) as BalanceEntry[];
        const snapshot: MetaSnapshot | null = metaRes.ok
          ? ((await metaRes.json()) as MetaSnapshot)
          : null;
        const transfersList: ReadonlyArray<Transfer> = transfersRes.ok
          ? (((await transfersRes.json()) as { transfers: Transfer[] })
              .transfers ?? [])
          : [];
        if (!cancelled) {
          dispatch({ type: "set_entries", entries });
          setMeta(snapshot);
          setTransfers(transfersList);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `Couldn't load saved balances: ${err.message}`
              : "Couldn't load saved balances.",
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const total = grandTotal(state);
  const updatedAt = lastUpdatedAt(state);

  // previousByProvider: for the most recent entry of each provider,
  // find the entry that came immediately before it. Powers the
  // "old → new" delta on each Recent Entries row.
  const previousByProvider = useMemo(() => {
    const result: Record<string, number | undefined> = {};
    for (const e of state.entries) {
      if (result[e.provider] !== undefined) continue;
      const idx = state.entries.indexOf(e);
      const earlier = state.entries
        .slice(idx + 1)
        .find((x) => x.provider === e.provider);
      result[e.provider] = earlier?.balance;
    }
    return result;
  }, [state.entries]);

  // One daily series per provider, recomputed on entries change.
  const seriesByProvider = useMemo(() => {
    const all = buildDailySeries(state.entries, SPARK_WINDOW_DAYS);
    const map = {} as Record<Provider, ReadonlyArray<DailyPoint>>;
    for (const s of all) map[s.provider] = s.points;
    return map;
  }, [state.entries]);

  const handleUpdate = useCallback(
    async (provider: Provider, newBalance: number) => {
      const id = makeId();
      const timestamp = new Date().toISOString();
      // 1) Optimistic: append locally so the UI feels instant.
      dispatch({
        type: "update_balance",
        provider,
        balance: newBalance,
        timestamp,
        id,
      });
      // Mark this id as freshly-added so the row plays its slide-in
      // animation. Clear after a tick so subsequent re-renders don't
      // replay it.
      setFreshIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setTimeout(() => {
        setFreshIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 320);
      setPending((p) => ({ ...p, [provider]: { id, provider } }));
      setError(null);

      // 2) Persist to the server.
      try {
        const res = await fetch("/api/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, balance: newBalance }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `POST /api/entries returned ${res.status}`);
        }
      } catch (err) {
        // 3) Rollback the optimistic row and surface the error.
        dispatch({ type: "remove_entry", id });
        setError(
          err instanceof Error
            ? `Saved locally but couldn't reach the server: ${err.message}`
            : "Saved locally but couldn't reach the server.",
        );
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[provider];
          return next;
        });
      }
    },
    [],
  );

  // After a persona switch, refetch entries (the server just wiped +
  // reseeded) and update the meta snapshot.
  const refetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/entries", { cache: "no-store" });
      if (!res.ok) throw new Error(`GET /api/entries returned ${res.status}`);
      const entries = (await res.json()) as BalanceEntry[];
      dispatch({ type: "set_entries", entries });
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Couldn't load new entries: ${err.message}`
          : "Couldn't load new entries.",
      );
    }
  }, []);

  const refetchTransfers = useCallback(async () => {
    try {
      const res = await fetch("/api/transfers", { cache: "no-store" });
      if (!res.ok) return; // 422 on cold start is fine — keep prior list.
      const list = ((await res.json()) as { transfers: Transfer[] }).transfers;
      setTransfers(list ?? []);
    } catch {
      // Transfer refetch is best-effort — the balance log is still
      // authoritative for the row totals. We don't surface this as a
      // banner to avoid masking a more important balance error.
    }
  }, []);

  const refetchAll = useCallback(async () => {
    await Promise.all([refetchEntries(), refetchTransfers()]);
  }, [refetchEntries, refetchTransfers]);

  const handlePersonaSwitched = useCallback(
    (snapshot: MetaSnapshot) => {
      setMeta(snapshot);
      setLoading(true);
      void refetchAll().finally(() => setLoading(false));
    },
    [refetchAll],
  );

  const handleTransferCommitted = useCallback(() => {
    setTransferFrom(null);
    void refetchAll();
  }, [refetchAll]);

  return (
    <AppShell meta={meta} onPersonaSwitched={handlePersonaSwitched}>
      <div className="flex flex-col gap-4 sm:gap-5">
        {loading ? (
          <>
            <Skeleton className="h-[120px] sm:h-[140px]" label="Loading total balance" />
            <div className="flex flex-col gap-3 sm:gap-4">
              {PROVIDERS.map((p) => (
                <Skeleton key={p} className="h-[112px]" label={`Loading ${p} balance`} />
              ))}
            </div>
            <Skeleton className="h-[180px]" label="Loading recent entries" />
          </>
        ) : (
          <>
            <TotalBalanceHeader total={total} lastUpdatedAt={updatedAt} />

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-signal/40 bg-signal-soft/60 px-3 py-2 text-sm text-ink"
              >
                {error}
              </div>
            )}

            <div className="flex flex-col gap-3 sm:gap-4">
              {PROVIDERS.map((p) => {
                const latest = latestFor(state, p);
                return (
                  <ProviderBalanceCard
                    key={p}
                    provider={p}
                    balance={latest?.balance}
                    lastUpdated={latest?.timestamp}
                    disabled={false}
                    pending={Boolean(pending[p])}
                    onUpdate={(newBalance) => handleUpdate(p, newBalance)}
                    onTransfer={() => setTransferFrom(p)}
                    series={seriesByProvider[p]}
                  />
                );
              })}
            </div>

            <RecentEntries
              entries={state.entries}
              transfers={transfers}
              previousByProvider={previousByProvider}
              freshIds={freshIds}
            />
          </>
        )}
      </div>

      {transferFrom && (
        <TransferDialog
          defaultFrom={transferFrom}
          balances={{
            bkash: latestFor(state, "bkash")?.balance,
            nagad: latestFor(state, "nagad")?.balance,
            rocket: latestFor(state, "rocket")?.balance,
          }}
          onCommitted={handleTransferCommitted}
          onClose={() => setTransferFrom(null)}
        />
      )}
    </AppShell>
  );
}
