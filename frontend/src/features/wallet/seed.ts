/**
 * Seed data — three plausible BDT balances, one per provider.
 *
 * Timestamps are seeded relative to "now" so the Recent Entries panel
 * never shows "ages ago" on first render. We don't seed with Date.now()
 * itself because if the user opens the page and immediately edits a
 * balance, the seed entries should still read "2 min ago" / "20 min ago"
 * / "3 hours ago" — not "0 sec ago" / "0 sec ago" / "0 sec ago".
 *
 * The IDs are stable so React keys don't churn if the seed is ever
 * referenced again (e.g. in tests).
 */

import type { BalanceEntry } from "./types";

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

export const SEED_ENTRIES: BalanceEntry[] = [
  { id: "seed-bkash-1",  provider: "bkash",  balance: 8450.00, timestamp: isoMinutesAgo(180) },  // 3 hours ago
  { id: "seed-nagad-1",  provider: "nagad",  balance: 2620.50, timestamp: isoMinutesAgo(45) },   // 45 min ago
  { id: "seed-rocket-1", provider: "rocket", balance: 1380.25, timestamp: isoMinutesAgo(8) },    // 8 min ago
];