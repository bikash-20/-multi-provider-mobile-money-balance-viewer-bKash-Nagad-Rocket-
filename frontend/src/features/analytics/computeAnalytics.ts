/**
 * features/analytics/computeAnalytics.ts — Pure server-side functions
 * that transform raw DB rows into analytics snapshots.
 *
 * Each function is a pure transformation: input -> output. No DB calls,
 * no React side effects. Testable in isolation.
 */

import type { BalanceEntry, Provider } from "@/features/wallet/types";
import type { Transfer } from "@/lib/domain/entities/transfer";
import { PROVIDER_HEX } from "@/features/wallet/types";
import { buildDailySeries } from "@/lib/sparklineSeries";
import type {
  AnalyticsSnapshot,
  DailyBalancePoint,
  MonthlyAggregate,
  NetWorthPoint,
  ProviderBalanceHistory,
  ProviderVelocity,
  TransferFlow,
} from "./types";

const ANALYTICS_WINDOW_DAYS = 90;

/**
 * Compute the full analytics snapshot from raw entries and transfers.
 * O(e + t) where e = #entries, t = #transfers — single pass over each
 * collection for all derived metrics.
 */
export function computeAnalytics(
  entries: BalanceEntry[],
  transfers: Transfer[],
): AnalyticsSnapshot {
  if (entries.length === 0) {
    return emptySnapshot();
  }

  // Convert all entries to BDT-equivalent for analytics aggregation.
  // USD entries are converted using their stored exchangeRateBdt.
  const bdtEntries = entries.map(normalizeToBdt);

  const dailySeries = buildDailySeries(bdtEntries, ANALYTICS_WINDOW_DAYS);

  const balanceHistory: ProviderBalanceHistory[] = dailySeries.map((s) => ({
    provider: s.provider,
    color: PROVIDER_HEX[s.provider],
    points: s.points,
  }));

  const netWorthHistory = computeNetWorth(dailySeries);
  const transferFlows = computeTransferFlows(transfers);
  const monthlyAggregates = computeMonthlyAggregates(entries); // uses original entries for raw values
  // Monthly aggregates stay in the original currency; the table shows
  // them as-is. The user can see which entries are USD from the card.
  const velocities = computeVelocities(dailySeries);

  // How many distinct days are covered across all providers?

  const allDays = new Set<string>();
  for (const h of balanceHistory) {
    for (const p of h.points) allDays.add(p.day);
  }

  return {
    balanceHistory,
    netWorthHistory,
    transferFlows,
    monthlyAggregates,
    velocities,
    daysCovered: allDays.size,
    generatedAt: new Date().toISOString(),
  };
}

/** Convert a BalanceEntry's balance to BDT-equivalent for aggregation.
 *  USD entries are converted using their stored exchangeRateBdt; if the
 *  rate is missing, we leave the balance as-is (assumes BDT). O(1). */
function normalizeToBdt(e: BalanceEntry): BalanceEntry {
  if (e.currency === "USD" && e.exchangeRateBdt && e.exchangeRateBdt > 0) {
    return { ...e, balance: e.balance * e.exchangeRateBdt, currency: "BDT" };
  }
  return e;
}

function emptySnapshot(): AnalyticsSnapshot {
  return {
    balanceHistory: [],
    netWorthHistory: [],
    transferFlows: [],
    monthlyAggregates: [],
    velocities: [],
    daysCovered: 0,
    generatedAt: new Date().toISOString(),
  };
}

/* ── Net Worth ────────────────────────────────────────────────────── */

function computeNetWorth(
  series: { provider: Provider; points: DailyBalancePoint[] }[],
): NetWorthPoint[] {
  if (series.length === 0) return [];

  const allProviders = series.map((s) => s.provider);
  // Build day -> { provider -> balance } map
  const dayMap = new Map<string, Partial<Record<Provider, number>>>();

  for (const s of series) {
    for (const p of s.points) {
      let cell = dayMap.get(p.day);
      if (!cell) {
        cell = {};
        dayMap.set(p.day, cell);
      }
      cell[s.provider] = p.balance;
    }
  }

  // Sort days ascending and fill missing providers with previous value
  const sortedDays = Array.from(dayMap.keys()).sort();
  const lastSeen: Partial<Record<Provider, number>> = {};

  const result: NetWorthPoint[] = [];
  for (const day of sortedDays) {
    const cell = dayMap.get(day)!;
    // Forward-fill missing providers
    for (const prov of allProviders) {
      if (cell[prov] !== undefined) {
        lastSeen[prov] = cell[prov];
      }
    }
    const breakdown = { ...lastSeen } as Record<Provider, number>;
    for (const prov of allProviders) {
      if (breakdown[prov] === undefined) breakdown[prov] = 0;
    }
    const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
    result.push({ day, total, breakdown });
  }

  return result;
}

/* ── Transfer Flows ───────────────────────────────────────────────── */

function computeTransferFlows(transfers: Transfer[]): TransferFlow[] {
  // bucket: "from|to" -> { amount, count }
  const buckets = new Map<string, { amount: number; count: number }>();

  for (const t of transfers) {
    // Skip compensating (reverse) transfers for the flow diagram to
    // avoid double-counting. The original transfer already captured
    // the flow; the reverse just undoes it.
    if (t.reversesTransferId) continue;

    const key = `${t.fromProvider}|${t.toProvider}`;
    const existing = buckets.get(key);
    const amount = (t.amountBdt as number) / 100; // paise to BDT
    if (existing) {
      existing.amount += amount;
      existing.count++;
    } else {
      buckets.set(key, { amount, count: 1 });
    }
  }

  const result: TransferFlow[] = [];
  for (const [key, val] of buckets) {
    const [fromProvider, toProvider] = key.split("|") as [Provider, Provider];
    result.push({
      fromProvider,
      toProvider,
      totalBdt: Math.round(val.amount * 100) / 100,
      count: val.count,
    });
  }

  // Sort by total descending
  result.sort((a, b) => b.totalBdt - a.totalBdt);
  return result;
}

/* ── Monthly Aggregates ───────────────────────────────────────────── */

function computeMonthlyAggregates(entries: BalanceEntry[]): MonthlyAggregate[] {
  // Group entries by (month, provider). month = YYYY-MM from timestamp
  type EntryMeta = { ts: string; balance: number };
  const grouped = new Map<string, Map<Provider, EntryMeta[]>>();

  // Sort entries by timestamp ascending for chronological processing
  const sorted = [...entries].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp),
  );

  for (const e of sorted) {
    const month = e.timestamp.slice(0, 7);
    let provMap = grouped.get(month);
    if (!provMap) {
      provMap = new Map();
      grouped.set(month, provMap);
    }
    let list = provMap.get(e.provider);
    if (!list) {
      list = [];
      provMap.set(e.provider, list);
    }
    list.push({ ts: e.timestamp, balance: e.balance });
  }

  const sortedMonths = Array.from(grouped.keys()).sort();
  const result: MonthlyAggregate[] = [];

  for (const month of sortedMonths) {
    const provMap = grouped.get(month)!;
    const providers = Array.from(provMap.keys());

    for (const prov of providers) {
      const list = provMap.get(prov)!;
      const openingBalance = list[0]!.balance;
      const closingBalance = list[list.length - 1]!.balance;
      const netChange = closingBalance - openingBalance;

      // Compute inflow/outflow: sum of positive/negative day-over-day
      // changes within this month
      let inflow = 0;
      let outflow = 0;
      for (let i = 1; i < list.length; i++) {
        const diff = list[i]!.balance - list[i - 1]!.balance;
        if (diff > 0) inflow += diff;
        else outflow += Math.abs(diff);
      }

      result.push({
        month,
        provider: prov,
        openingBalance,
        closingBalance,
        netChange: Math.round(netChange * 100) / 100,
        inflow: Math.round(inflow * 100) / 100,
        outflow: Math.round(outflow * 100) / 100,
      });
    }
  }

  return result;
}

/* ── Velocity ─────────────────────────────────────────────────────── */

function computeVelocities(
  series: { provider: Provider; points: DailyBalancePoint[] }[],
): ProviderVelocity[] {
  return series.map((s) => {
    const pts = s.points;
    if (pts.length < 2) {
      return { provider: s.provider, dailyAvg: 0, weeklyAvg: 0, direction: "flat" };
    }

    // Daily average: total change / (days_count - 1)
    const totalChange = pts[pts.length - 1]!.balance - pts[0]!.balance;
    const dayCount = pts.length - 1;
    const dailyAvg = dayCount > 0 ? totalChange / dayCount : 0;

    // Weekly average: use last 7 data points (or all if fewer)
    const window = Math.min(7, pts.length - 1);
    const weeklyChange = pts[pts.length - 1]!.balance - pts[pts.length - 1 - window]!.balance;
    const weeklyAvg = window > 0 ? weeklyChange / Math.min(7, window) : 0;

    // Round to 2 decimal places
    const roundedDaily = Math.round(dailyAvg * 100) / 100;
    const roundedWeekly = Math.round(weeklyAvg * 100) / 100;

    let direction: "up" | "down" | "flat";
    if (Math.abs(roundedDaily) < 1) direction = "flat";
    else if (roundedDaily > 0) direction = "up";
    else direction = "down";

    return { provider: s.provider, dailyAvg: roundedDaily, weeklyAvg: roundedWeekly, direction };
  });
}
