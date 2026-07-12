/**
 * sparklineSeries.test.ts — verifies the pure aggregation logic that
 * powers the per-card sparklines. No SQLite, no DOM, just inputs
 * in / daily points out.
 *
 * buildDailySeries returns an array of { provider, points } in
 * PROVIDERS order. Tests use a small helper to look up the points
 * for a given provider, which mirrors how page.tsx reduces the
 * result into a Record<Provider, DailyPoint[]>.
 *
 * Stable date math: the tests build their entries relative to an
 * anchor day synthesized from a stable base year (2024-06-15) so
 * the suite doesn't drift with system time.
 */
import { describe, expect, it } from "vitest";

import { buildDailySeries } from "@/lib/sparklineSeries";
import type { BalanceEntry, Provider } from "@/features/wallet/types";

function mkEntry(
  provider: Provider,
  balance: number,
  iso: string,
): BalanceEntry {
  return {
    id: `${provider}-${balance}-${iso}`,
    provider,
    balance,
    timestamp: iso,
  };
}

function pointsFor(
  result: ReturnType<typeof buildDailySeries>,
  provider: Provider,
) {
  const found = result.find((s) => s.provider === provider);
  return found?.points ?? [];
}

/** Anchor for stable date arithmetic. Picks June 15, 2024 as a
 *  fixed "today" so tests don't depend on system clock. */
const ANCHOR_UTC = Date.UTC(2024, 5, 15);

function isoAt(daysBack: number, hour = 10): string {
  const d = new Date(ANCHOR_UTC - daysBack * 24 * 60 * 60 * 1000);
  const yy = d.getUTCFullYear();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const hh = hour.toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}T${hh}:00:00.000Z`;
}

function dayKey(daysBack: number): string {
  return isoAt(daysBack).slice(0, 10);
}

describe("buildDailySeries", () => {
  it("returns one entry per provider with empty points for empty input", () => {
    const series = buildDailySeries([], 30);
    expect(series.map((s) => s.provider)).toEqual(["bkash", "nagad", "rocket"]);
    expect(pointsFor(series, "bkash")).toEqual([]);
    expect(pointsFor(series, "nagad")).toEqual([]);
    expect(pointsFor(series, "rocket")).toEqual([]);
  });

  it("keeps the last balance per (day, provider) for entries in time order", () => {
    const entries: BalanceEntry[] = [
      mkEntry("bkash", 100, isoAt(2)),
      mkEntry("bkash", 150, isoAt(2)), // same day, later timestamp
      mkEntry("bkash", 200, isoAt(1)),
    ];
    const series = buildDailySeries(entries, 30);
    expect(pointsFor(series, "bkash")).toEqual([
      { day: dayKey(2), balance: 150 },
      { day: dayKey(1), balance: 200 },
    ]);
  });

  it("keeps the last balance per (day, provider) regardless of input order", () => {
    const entries: BalanceEntry[] = [
      mkEntry("bkash", 200, isoAt(1)),
      mkEntry("bkash", 150, isoAt(2, 12)), // later hour
      mkEntry("bkash", 100, isoAt(2, 8)), // earlier hour
    ];
    const series = buildDailySeries(entries, 30);
    expect(pointsFor(series, "bkash")).toEqual([
      { day: dayKey(2), balance: 150 },
      { day: dayKey(1), balance: 200 },
    ]);
  });

  it("trims to the last windowDays entries", () => {
    // 50 contiguous days ending on the anchor day (so window=7 anchored
    // at dayKey(0) walks back 6 days to dayKey(6)).
    const entries: BalanceEntry[] = [];
    for (let i = 0; i < 50; i++) {
      entries.push(mkEntry("bkash", (i + 1) * 10, isoAt(49 - i)));
    }
    const series = buildDailySeries(entries, 7);
    const points = pointsFor(series, "bkash");
    expect(points.length).toBe(7);
    // Last 7 entries are balance 440..500.
    expect(points[0]?.balance).toBe(440);
    expect(points[6]?.balance).toBe(500);
    expect(points[0]?.day).toBe(dayKey(6));
    expect(points[6]?.day).toBe(dayKey(0));
  });

  it("forward-fills gaps so each provider spans the full window", () => {
    // Data on day-3 (100) and day-1 (300). Window=5 is anchored at
    // the latest day that has data (day-1) and walks back 4 days
    // to day-5. First observation is day-3, so we emit 3 contiguous
    // points: day-3=100, day-2 forward-fill=100, day-1=300.
    const entries: BalanceEntry[] = [
      mkEntry("bkash", 100, isoAt(3)),
      mkEntry("bkash", 300, isoAt(1)),
    ];
    const series = buildDailySeries(entries, 5);
    const points = pointsFor(series, "bkash");
    expect(points.length).toBe(3);
    expect(points.map((p) => p.day)).toEqual([
      dayKey(3),
      dayKey(2),
      dayKey(1),
    ]);
    expect(points.map((p) => p.balance)).toEqual([100, 100, 300]);
  });

  it("segments entries by provider", () => {
    const entries: BalanceEntry[] = [
      mkEntry("bkash", 100, isoAt(0)),
      mkEntry("nagad", 200, isoAt(0)),
      mkEntry("rocket", 300, isoAt(0)),
    ];
    const series = buildDailySeries(entries, 5);
    expect(pointsFor(series, "bkash")[0]?.balance).toBe(100);
    expect(pointsFor(series, "nagad")[0]?.balance).toBe(200);
    expect(pointsFor(series, "rocket")[0]?.balance).toBe(300);
  });

  it("ignores entries older than the window", () => {
    const entries: BalanceEntry[] = [
      mkEntry("bkash", 99, "2023-01-01T10:00:00.000Z"), // ancient
      mkEntry("bkash", 100, isoAt(4)),
      mkEntry("bkash", 200, isoAt(0)),
    ];
    const series = buildDailySeries(entries, 5);
    // 5-day window from day-4 to day-0. Ancient Jan 2023 entry dropped.
    // day-4=100, day-3..day-1 forward-fill 100, day-0=200.
    expect(pointsFor(series, "bkash").map((p) => p.balance)).toEqual([
      100, 100, 100, 100, 200,
    ]);
  });

  it("omits providers that have no entries from the series entirely", () => {
    // Only bkash has data. nagad and rocket have no observations
    // at all, so their points arrays are empty — the UI should
    // hide the sparkline for a provider with no history rather
    // than rendering a meaningless line dropping to 0.
    const entries: BalanceEntry[] = [mkEntry("bkash", 100, isoAt(0))];
    const series = buildDailySeries(entries, 5);
    expect(pointsFor(series, "nagad")).toEqual([]);
    expect(pointsFor(series, "rocket")).toEqual([]);
    expect(pointsFor(series, "bkash").length).toBeGreaterThan(0);
  });
});