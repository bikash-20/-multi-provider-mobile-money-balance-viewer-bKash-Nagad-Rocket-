/**
 * features/analytics/types.ts — Analytics dashboard type definitions.
 *
 * These types are shared between the API route (server) and the chart
 * components (client). No server-only imports (better-sqlite3, node:*)
 * in this file.
 */

import type { Provider } from "@/features/wallet/types";

/** One point in a daily balance series. */
export interface DailyBalancePoint {
  day: string; // ISO date YYYY-MM-DD
  balance: number;
}

/** Per-provider daily balance history. */
export interface ProviderBalanceHistory {
  provider: Provider;
  color: string;
  points: DailyBalancePoint[];
}

/** Combined net worth over time. */
export interface NetWorthPoint {
  day: string;
  total: number;
  breakdown: Record<Provider, number>;
}

/** Transfer flow between two providers. */
export interface TransferFlow {
  fromProvider: Provider;
  toProvider: Provider;
  totalBdt: number;
  count: number;
}

/** Monthly aggregate per provider. */
export interface MonthlyAggregate {
  month: string; // YYYY-MM
  provider: Provider;
  openingBalance: number;
  closingBalance: number;
  netChange: number;
  inflow: number; // positive changes
  outflow: number; // negative changes
}

/** Velocity metrics per provider. */
export interface ProviderVelocity {
  provider: Provider;
  dailyAvg: number; // average daily change over window
  weeklyAvg: number; // average weekly change over window
  direction: "up" | "down" | "flat";
}

/** Complete analytics snapshot from the server. */
export interface AnalyticsSnapshot {
  balanceHistory: ProviderBalanceHistory[];
  netWorthHistory: NetWorthPoint[];
  transferFlows: TransferFlow[];
  monthlyAggregates: MonthlyAggregate[];
  velocities: ProviderVelocity[];
  daysCovered: number;
  generatedAt: string;
}
