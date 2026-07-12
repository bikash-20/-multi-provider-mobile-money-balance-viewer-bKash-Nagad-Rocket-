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
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { AppShell } from "@/features/shell/AppShell";
import { TotalBalanceHeader } from "@/features/wallet/TotalBalanceHeader";
import { ProviderBalanceCard } from "@/features/wallet/ProviderBalanceCard";
import { RecentEntries } from "@/features/wallet/RecentEntries";
import { initialState, reducer } from "@/features/wallet/reducer";
import {
  grandTotal,
  lastUpdatedAt,
  latestFor,
} from "@/features/wallet/selectors";
import { PROVIDERS, type BalanceEntry, type Provider } from "@/features/wallet/types";

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

export default function HomePage() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Record<string, PendingUpdate>>({});
  const [error, setError] = useState<string | null>(null);

  // Initial fetch — server is the source of truth.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/entries", { cache: "no-store" });
        if (!res.ok) throw new Error(`GET /api/entries returned ${res.status}`);
        const entries = (await res.json()) as BalanceEntry[];
        if (!cancelled) {
          dispatch({ type: "set_entries", entries });
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

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:gap-5">
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
                disabled={loading}
                pending={Boolean(pending[p])}
                onUpdate={(newBalance) => handleUpdate(p, newBalance)}
              />
            );
          })}
        </div>

        <RecentEntries
          entries={state.entries}
          previousByProvider={previousByProvider}
        />
      </div>
    </AppShell>
  );
}
