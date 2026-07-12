/**
 * Pure selectors over AppState. Pulled out of components so the
 * derivation logic is testable in isolation and the components stay
 * small.
 *
 * Most recent entry per provider = the first matching entry in the
 * entries array (entries are kept newest-first by the reducer).
 */

import type { AppState, BalanceEntry, Provider } from "./types";

export function latestFor(
  state: AppState,
  provider: Provider,
): BalanceEntry | undefined {
  return state.entries.find((e) => e.provider === provider);
}

/** Map of provider → current balance (the latest entry's balance for
 *  that provider, or 0 if no entries yet). */
export function currentBalances(state: AppState): Record<Provider, number> {
  const out = { bkash: 0, nagad: 0, rocket: 0 } as Record<Provider, number>;
  // Walk newest → oldest; first time we see a provider, record its balance
  // and skip further entries for it. This is O(n) and tolerates any
  // ordering of state.entries.
  for (const e of state.entries) {
    // Latest-for-provider will be the first match in the newest-first list.
    if (e === latestFor(state, e.provider)) {
      out[e.provider] = e.balance;
    }
  }
  return out;
}

/** Sum of all current balances across providers. */
export function grandTotal(state: AppState): number {
  const cb = currentBalances(state);
  return cb.bkash + cb.nagad + cb.rocket;
}

/** Most recent timestamp across all entries — used for the
 *  "Last updated" caption on the Total Balance header. */
export function lastUpdatedAt(state: AppState): string | undefined {
  return state.entries[0]?.timestamp;
}