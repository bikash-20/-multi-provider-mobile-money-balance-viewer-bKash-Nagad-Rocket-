"use client";
/**
 * MonthlyComparison — Month-over-month per-provider breakdown.
 *
 * Renders a compact table with one row per provider per month.
 * Columns: Month | Provider | Opening | Closing | Net Change | Inflow | Outflow
 *
 * Features:
 *  - Collapsible: starts collapsed on mobile, expandable via toggle
 *  - Color-coded net change (green for positive, red for negative)
 *  - Inline spark-bars for inflow/outflow visualization
 *  - Empty state when no data
 */

import { useMemo, useState } from "react";
import { formatBDT } from "@/lib/time";
import { PROVIDER_HEX, PROVIDER_LABEL, type Provider } from "@/features/wallet/types";
import type { MonthlyAggregate } from "./types";

interface MonthlyComparisonProps {
  aggregates: MonthlyAggregate[];
}

export function MonthlyComparison({ aggregates }: MonthlyComparisonProps) {
  const [expanded, setExpanded] = useState(false);

  // Group by month for the header
  const months = useMemo(() => {
    const m = new Set<string>();
    for (const a of aggregates) m.add(a.month);
    return Array.from(m).sort().reverse(); // newest first
  }, [aggregates]);

  if (aggregates.length === 0) return null;

  // Compute max inflow/outflow for spark-bar scaling
  const maxFlow = useMemo(() => {
    let max = 0;
    for (const a of aggregates) {
      if (a.inflow > max) max = a.inflow;
      if (a.outflow > max) max = a.outflow;
    }
    return max || 1;
  }, [aggregates]);

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-surface-2"
      >
        <span className="eyebrow">Monthly Breakdown</span>
        <ChevronIcon className={expanded ? "rotate-180" : ""} />
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Hidden on very small screens, scrollable table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead>
                <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted">
                  <th className="px-3 py-2 text-left">Month</th>
                  <th className="px-3 py-2 text-left">Provider</th>
                  <th className="px-3 py-2 text-right">Opening</th>
                  <th className="px-3 py-2 text-right">Closing</th>
                  <th className="px-3 py-2 text-right">Net Change</th>
                  <th className="px-3 py-2 text-right">Inflow</th>
                  <th className="px-3 py-2 text-right">Outflow</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {months.map((month) => {
                  const monthRows = aggregates.filter((a) => a.month === month);
                  return monthRows.map((row, ri) => (
                    <tr
                      key={`${month}-${row.provider}`}
                      className={`text-xs transition hover:bg-surface-2 ${
                        ri === 0 ? "" : ""
                      }`}
                    >
                      {ri === 0 && (
                        <td
                          rowSpan={monthRows.length}
                          className="px-3 py-2 align-top font-semibold text-ink"
                        >
                          {formatMonth(month)}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: PROVIDER_HEX[row.provider] }}
                          />
                          {PROVIDER_LABEL[row.provider]}
                        </span>
                      </td>
                      <td className="num px-3 py-2 text-right text-ink">
                        {formatBDT(row.openingBalance)}
                      </td>
                      <td className="num px-3 py-2 text-right text-ink">
                        {formatBDT(row.closingBalance)}
                      </td>
                      <td className="num px-3 py-2 text-right">
                        <span
                          style={{
                            color:
                              row.netChange > 0
                                ? "var(--color-signal)"
                                : row.netChange < 0
                                  ? "#E0447A"
                                  : "var(--color-muted)",
                          }}
                        >
                          {row.netChange > 0 ? "+" : ""}
                          {formatBDT(row.netChange)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="h-2 w-12 overflow-hidden rounded-full bg-surface-2 sm:w-16">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(row.inflow / maxFlow) * 100}%`,
                                background: "var(--color-signal)",
                                opacity: 0.6,
                              }}
                            />
                          </div>
                          <span className="num text-[10px] text-muted">
                            {formatBDT(row.inflow)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="h-2 w-12 overflow-hidden rounded-full bg-surface-2 sm:w-16">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(row.outflow / maxFlow) * 100}%`,
                                background: "#E0447A",
                                opacity: 0.6,
                              }}
                            />
                          </div>
                          <span className="num text-[10px] text-muted">
                            {formatBDT(row.outflow)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform ${className}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${y}`;
}
