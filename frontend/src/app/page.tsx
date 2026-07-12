"use client";
/**
 * WalletSync dashboard — single page, no routing.
 *
 * State model (spec section 4):
 *  - AppState held at this level via useReducer.
 *  - Entries seeded in the reducer's initialState (no useEffect seeding
 *    — initial state is the seed, full stop).
 *  - Current balance per provider is derived from the most recent
 *    entry for that provider, never stored separately.
 *  - Total Balance is derived from those three current balances, never
 *    stored separately. This eliminates drift between the header and
 *    the cards.
 *
 * Persistence (spec section 0): none in v1. The page reload starts
 * fresh from the seed. localStorage is used only for the theme
 * preference (handled inside features/shell/themeStore.ts).
 */

import { useMemo, useReducer } from "react";
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
import { PROVIDERS } from "@/features/wallet/types";

function makeId() {
  // crypto.randomUUID exists in modern browsers + Node 19+; fallback
  // covers older runtimes without pulling a uuid dep.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function HomePage() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const total = grandTotal(state);
  const updatedAt = lastUpdatedAt(state);

  // previousByProvider: for the most recent entry of each provider,
  // find the entry that came immediately before it. Powers the
  // "old → new" delta on each Recent Entries row.
  const previousByProvider = useMemo(() => {
    const result: Record<string, number | undefined> = {};
    for (const e of state.entries) {
      if (result[e.provider] !== undefined) continue; // already found prev for the latest
      const idx = state.entries.indexOf(e);
      const earlier = state.entries
        .slice(idx + 1)
        .find((x) => x.provider === e.provider);
      result[e.provider] = earlier?.balance;
    }
    return result;
  }, [state.entries]);

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:gap-5">
        <TotalBalanceHeader total={total} lastUpdatedAt={updatedAt} />

        <div className="flex flex-col gap-3 sm:gap-4">
          {PROVIDERS.map((p) => {
            const latest = latestFor(state, p);
            if (!latest) return null; // shouldn't happen with seed, but typed-safe
            return (
              <ProviderBalanceCard
                key={p}
                provider={p}
                balance={latest.balance}
                lastUpdated={latest.timestamp}
                onUpdate={(newBalance) =>
                  dispatch({
                    type: "update_balance",
                    provider: p,
                    balance: newBalance,
                    timestamp: new Date().toISOString(),
                    id: makeId(),
                  })
                }
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