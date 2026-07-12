/**
 * lib/sparklineSeries.ts — pure aggregation of entries into per-day series.
 *
 * Lives in lib/ (not features/wallet/) because it's pure data
 * transformation: no React, no Node APIs, no DOM. Safe to import from
 * client components, server components, and tests without dragging in
 * better-sqlite3 or node:* deps.
 *
 * Originally implemented inside lib/seedDemo.ts; extracted here so the
 * client-side Sparkline component can call it without pulling in the
 * seed module's server-only imports.
 */

import { PROVIDERS, type Provider } from "@/features/wallet/types";

export interface DailyPoint {
  /** ISO date (YYYY-MM-DD), UTC day. */
  day: string;
  balance: number;
}

export interface ProviderSeries {
  provider: Provider;
  points: DailyPoint[];
}

/**
 * Group entries by day (UTC), keep the LAST balance per day per
 * provider, and return the last `windowDays` days for each provider.
 *
 * The "last balance of the day" rule matches how a real user thinks
 * about their balance: "what was it at end of day X?" Intra-day
 * updates within the same calendar day collapse to one point.
 *
 * The window is anchored at the latest day that has any data and
 * walks back `windowDays - 1` calendar days from there. Days
 * without an observation are forward-filled from the previous
 * known value (or omitted if before the first observation) so the
 * sparkline doesn't drop to 0 over a long stretch of no data.
 *
 * Pure: no clock dependency. The caller decides whether to pass
 * entries relative to "now" or some past window — the function
 * just emits a contiguous series of length <= windowDays.
 */
export function buildDailySeries(
  entries: ReadonlyArray<{
    provider: Provider;
    balance: number;
    timestamp: string;
  }>,
  windowDays: number,
): ProviderSeries[] {
  // Latest-of-day map: dayKey -> Map<provider, {ts, bal}>. To track
  // the latest regardless of input order, sort entries by timestamp
  // ascending and only update the cell if the new timestamp is
  // strictly greater than the one already stored for that
  // (day, provider).
  type Entry = { provider: Provider; balance: number; timestamp: string };
  const sorted = [...entries].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
  const byDayProvider: Map<string, Map<Provider, { ts: string; bal: number }>> =
    new Map();

  for (const e of sorted as Entry[]) {
    const dayKey = e.timestamp.slice(0, 10);
    if (!byDayProvider.has(dayKey)) byDayProvider.set(dayKey, new Map());
    const dayMap = byDayProvider.get(dayKey);
    if (!dayMap) continue;
    const existing = dayMap.get(e.provider);
    if (!existing || e.timestamp >= existing.ts) {
      dayMap.set(e.provider, { ts: e.timestamp, bal: e.balance });
    }
  }

  // Determine the window. Anchor at the latest day that has any
  // data and walk back `windowDays - 1` calendar days. If there's
  // no data at all, every provider's points array is empty.
  const daysWithData = Array.from(byDayProvider.keys()).sort();
  if (daysWithData.length === 0) {
    return PROVIDERS.map((provider) => ({ provider, points: [] }));
  }

  const endDay = daysWithData[daysWithData.length - 1];
  if (!endDay) return PROVIDERS.map((p) => ({ provider: p, points: [] }));
  const startDay = isoDayBefore(endDay, windowDays - 1);
  const firstDataDay = daysWithData[0];

  const trimmed: string[] = enumerateDays(startDay, endDay);

  return PROVIDERS.map((provider) => {
    const points: DailyPoint[] = [];
    let lastSeen: number | null = null;
    for (const day of trimmed) {
      // Skip days before the first observation for this provider —
      // we'd otherwise emit a meaningless line dropping to 0 over
      // the unknown past.
      if (firstDataDay && day < firstDataDay) continue;
      const cell = byDayProvider.get(day)?.get(provider);
      if (cell) {
        lastSeen = cell.bal;
        points.push({ day, balance: cell.bal });
      } else if (lastSeen !== null) {
        points.push({ day, balance: lastSeen });
      }
    }
    return { provider, points };
  });
}

/**
 * Compute the ISO YYYY-MM-DD for `daysBack` calendar days before `dayKey`.
 * Uses UTC date math so DST can't shift a point to a different day.
 */
function isoDayBefore(dayKey: string, daysBack: number): string {
  const [y, m, d] = dayKey.split("-").map((s) => parseInt(s, 10));
  if (y === undefined || m === undefined || d === undefined) {
    return dayKey;
  }
  const utc = Date.UTC(y, m - 1, d);
  const shifted = new Date(utc - daysBack * 24 * 60 * 60 * 1000);
  const yy = shifted.getUTCFullYear();
  const mm = (shifted.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = shifted.getUTCDate().toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Enumerate every YYYY-MM-DD between `startDay` and `endDay` inclusive,
 *  ascending. */
function enumerateDays(startDay: string, endDay: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = startDay.split("-").map((s) => parseInt(s, 10));
  const [ey, em, ed] = endDay.split("-").map((s) => parseInt(s, 10));
  if (
    sy === undefined ||
    sm === undefined ||
    sd === undefined ||
    ey === undefined ||
    em === undefined ||
    ed === undefined
  ) {
    return [startDay, endDay];
  }
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    const yy = d.getUTCFullYear();
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = d.getUTCDate().toString().padStart(2, "0");
    out.push(`${yy}-${mm}-${dd}`);
  }
  return out;
}