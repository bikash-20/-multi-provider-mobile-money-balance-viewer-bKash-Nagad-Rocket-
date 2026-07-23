/**
 * Pure selectors over AppState. Pulled out of components so the
 * derivation logic is testable in isolation and the components stay
 * small.
 *
 * Most recent entry per provider = the first matching entry in the
 * entries array (entries are kept newest-first by the reducer).
 */

import type { AppState, BalanceEntry, Provider } from "./types";
import type { Currency } from "@/features/currency/types";

export function latestFor(
  state: AppState,
  provider: Provider,
): BalanceEntry | undefined {
  return state.entries.find((e) => e.provider === provider);
}

/** Map of provider -> current balance (the latest entry's balance for
 *  that provider, or 0 if no entries yet). Returns the balance IN THE
 *  ENTRY'S CURRENCY — the caller must convert for totals. */
export function currentBalances(
  state: AppState,
): Record<Provider, { balance: number; currency: Currency }> {
  const out = {
    bkash: { balance: 0, currency: "BDT" as Currency },
    nagad: { balance: 0, currency: "BDT" as Currency },
    rocket: { balance: 0, currency: "BDT" as Currency },
  };
  for (const e of state.entries) {
    if (Object.prototype.hasOwnProperty.call(out, e.provider)) {
      const cell = out[e.provider];
      if (e === latestFor(state, e.provider)) {
        cell.balance = e.balance;
        cell.currency = e.currency ?? "BDT";
      }
    }
  }
  return out;
}

/**
 * Sum of all current balances across providers, converted to BDT.
 *
 * USD entries are converted using their stored exchangeRateBdt. If
 * the rate is missing (shouldn't happen for well-formed data), we
 * skip the entry (count as 0) so a stale rate doesn't silently hide
 * a USD amount.
 */
export function grandTotal(state: AppState): number {
  const cb = currentBalances(state);
  let total = 0;
  for (const provider of ["bkash", "nagad", "rocket"] as const) {
    const cell = cb[provider];
    if (cell.currency === "USD") {
      // Find the entry to get the exchange rate.
      const entry = latestFor(state, provider);
      const rate = entry?.exchangeRateBdt;
      if (rate && Number.isFinite(rate) && rate > 0) {
        total += cell.balance * rate;
      }
      // If no rate, skip (can't convert).
    } else {
      total += cell.balance;
    }
  }
  return total;
}

/**
 * Check if any provider has a non-BDT balance — used to show the
 * "Includes converted amounts" note on the Total header.
 */
export function hasForeignCurrency(state: AppState): boolean {
  for (const e of state.entries) {
    if (e.currency && e.currency !== "BDT") return true;
  }
  return false;
}

/** Most recent timestamp across all entries — used for the
 *  "Last updated" caption on the Total Balance header. */
export function lastUpdatedAt(state: AppState): string | undefined {
  return state.entries[0]?.timestamp;
}
