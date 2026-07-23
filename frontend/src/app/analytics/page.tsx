"use client";
/**
 * Analytics Dashboard — Full-page financial intelligence.
 *
 * Charts:
 *  - Balance Trends: multi-series line chart (3 providers over 90 days)
 *  - Net Worth: combined total with per-provider breakdown on hover
 *  - Transfer Flow: alluvial diagram of cross-provider transfers
 *  - Balance Velocity: daily/weekly change rates per provider
 *  - Monthly Breakdown: month-over-month comparison table
 *
 * Data is fetched from /api/analytics on mount. The page shows
 * skeleton placeholders while loading and empty-state messages
 * when no data exists yet.
 */

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/features/shell/AppShell";
import { Skeleton } from "@/features/wallet/Skeleton";
import { BalanceTrendChart, EmptyChart } from "@/features/analytics/BalanceTrendChart";
import { BudgetDashboard } from "@/features/budget";
import { NetWorthChart } from "@/features/analytics/NetWorthChart";
import { TransferFlowDiagram } from "@/features/analytics/TransferFlowDiagram";
import { VelocityCards } from "@/features/analytics/VelocityCards";
import { MonthlyComparison } from "@/features/analytics/MonthlyComparison";
import { ForecastChart } from "@/features/forecast";
import type { AnalyticsSnapshot } from "@/features/analytics/types";
import type { MetaSnapshot } from "@/lib/metaTypes";
import type { BalanceEntry } from "@/features/wallet/types";
import type { ProviderForecast } from "@/lib/domain/forecast";

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsSnapshot | null>(null);
  const [meta, setMeta] = useState<MetaSnapshot | null>(null);
  const [entries, setEntries] = useState<BalanceEntry[]>([]);
  const [forecasts, setForecasts] = useState<ProviderForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [analyticsRes, metaRes, entriesRes, forecastRes] = await Promise.all([
        fetch("/api/analytics", { cache: "no-store" }),
        fetch("/api/meta", { cache: "no-store" }),
        fetch("/api/entries", { cache: "no-store" }),
        fetch("/api/forecast", { cache: "no-store" }),
      ]);

      if (!analyticsRes.ok) {
        throw new Error(`Analytics returned ${analyticsRes.status}`);
      }

      const analyticsData = (await analyticsRes.json()) as AnalyticsSnapshot;
      const metaData: MetaSnapshot | null = metaRes.ok
        ? ((await metaRes.json()) as MetaSnapshot)
        : null;
      const entriesPayload = entriesRes.ok
        ? ((await entriesRes.json()) as { entries: BalanceEntry[] })
        : { entries: [] };
      const forecastPayload = forecastRes.ok
        ? ((await forecastRes.json()) as { forecasts: ProviderForecast[] })
        : { forecasts: [] };

      setData(analyticsData);
      setMeta(metaData);
      setEntries(entriesPayload.entries ?? []);
      setForecasts(forecastPayload.forecasts ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load analytics.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handlePersonaSwitched = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <AppShell meta={meta} onPersonaSwitched={handlePersonaSwitched}>
      <div className="flex flex-col gap-4 sm:gap-5">
        {loading ? (
          <>
            <Skeleton className="h-[220px]" label="Loading net worth chart" />
            <Skeleton className="h-[280px]" label="Loading balance trends" />
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-[100px]" label="Loading velocity" />
              <Skeleton className="h-[100px]" label="Loading velocity" />
              <Skeleton className="h-[100px]" label="Loading velocity" />
            </div>
            <Skeleton className="h-[200px]" label="Loading monthly breakdown" />
              <Skeleton className="h-[300px]" label="Loading forecast" />
          </>
        ) : error ? (
          <div
            role="alert"
            className="rounded-lg border border-signal/40 bg-signal-soft/60 px-4 py-3 text-sm text-ink"
          >
            {error}
          </div>
        ) : data && data.daysCovered === 0 ? (
          <EmptyChart
            title="No analytics data yet"
            description="Add some balance entries on the Dashboard first, then come back here to see your financial trends."
          />
        ) : data ? (
          <>
            {/* Summary stats row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Days Tracked"
                value={data.daysCovered.toString()}
              />
              <StatCard
                label="Transfers"
                value={data.transferFlows.reduce((s, f) => s + f.count, 0).toString()}
              />
              <StatCard
                label="Monthly Records"
                value={data.monthlyAggregates.length.toString()}
              />
              <StatCard
                label="Providers"
                value="3"
              />
            </div>

            <NetWorthChart history={data.netWorthHistory} />
            <BalanceTrendChart history={data.balanceHistory} />
            <VelocityCards velocities={data.velocities} />

            {data.transferFlows.length > 0 && (
              <TransferFlowDiagram flows={data.transferFlows} />
            )}

            <ForecastChart forecasts={forecasts} />
            <BudgetDashboard entries={entries} />
            <MonthlyComparison aggregates={data.monthlyAggregates} />
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 px-3 py-3 text-center">
      <p className="num text-2xl font-semibold text-ink">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
    </div>
  );
}
