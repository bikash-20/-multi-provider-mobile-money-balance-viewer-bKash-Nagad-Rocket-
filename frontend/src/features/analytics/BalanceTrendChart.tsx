"use client";
/**
 * BalanceTrendChart — Multi-series SVG line chart.
 *
 * Renders 3 colored lines (bKash, Nagad, Rocket) on a shared day axis.
 * Features:
 *  - Y-axis with BDT labels
 *  - X-axis showing day intervals
 *  - Hover crosshair + tooltip showing exact values
 *  - Legend with interactive toggle (click to show/hide a provider)
 *  - Gradient area fill for each series
 *  - Responsive via viewBox
 *  - 350ms fade-in entrance animation
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { formatBDT, formatDayShort } from "@/lib/time";
import type { ProviderBalanceHistory } from "./types";

interface BalanceTrendChartProps {
  history: ProviderBalanceHistory[];
  height?: number;
}

const CHART_PADDING = { top: 20, right: 20, bottom: 36, left: 56 };
const AXIS_TICKS = 5;

export function BalanceTrendChart({ history, height = 280 }: BalanceTrendChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);

  const toggleProvider = useCallback((provider: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }, []);

  // Merge all visible points into one sorted day array
  const allDays = useMemo(() => {
    const daySet = new Set<string>();
    for (const h of history) {
      if (hidden.has(h.provider)) continue;
      for (const p of h.points) daySet.add(p.day);
    }
    return Array.from(daySet).sort();
  }, [history, hidden]);

  // Compute Y bounds across all visible series
  const { yMin, yMax } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const h of history) {
      if (hidden.has(h.provider)) continue;
      for (const p of h.points) {
        if (p.balance < min) min = p.balance;
        if (p.balance > max) max = p.balance;
      }
    }
    if (!Number.isFinite(min)) return { yMin: 0, yMax: 1000 };
    const padding = (max - min) * 0.1 || max * 0.1 || 100;
    return { yMin: Math.max(0, min - padding), yMax: max + padding };
  }, [history, hidden]);

  if (history.length === 0 || allDays.length === 0) {
    return (
      <EmptyChart
        title="Balance Trends"
        description="No balance history yet. Add entries to see trends."
      />
    );
  }

  const w = 700; // logical width
  const h = height;
  const innerW = w - CHART_PADDING.left - CHART_PADDING.right;
  const innerH = h - CHART_PADDING.top - CHART_PADDING.bottom;
  const yRange = yMax - yMin || 1;

  function x(day: string): number {
    const i = allDays.indexOf(day);
    return CHART_PADDING.left + (i / Math.max(allDays.length - 1, 1)) * innerW;
  }

  function y(balance: number): number {
    return CHART_PADDING.top + innerH - ((balance - yMin) / yRange) * innerH;
  }

  // Y-axis ticks
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= AXIS_TICKS; i++) {
      ticks.push(yMin + (yRange * i) / AXIS_TICKS);
    }
    return ticks;
  }, [yMin, yRange]);

  // X-axis labels: show ~6 evenly spaced days
  const xLabels = useMemo(() => {
    if (allDays.length <= 6) return allDays;
    const step = Math.floor((allDays.length - 1) / 5);
    const labels: string[] = [];
    for (let i = 0; i < allDays.length; i += step) {
      labels.push(allDays[i]);
    }
    if (labels[labels.length - 1] !== allDays[allDays.length - 1]) {
      labels.push(allDays[allDays.length - 1]);
    }
    return labels;
  }, [allDays]);

  // Tooltip data
  const tooltipData = useMemo(() => {
    if (!hoveredDay) return null;
    const items: { label: string; color: string; balance: number }[] = [];
    for (const h of history) {
      if (hidden.has(h.provider)) continue;
      const point = h.points.find((p) => p.day === hoveredDay);
      if (point) items.push({ label: h.provider, color: h.color, balance: point.balance });
    }
    return { day: hoveredDay, items };
  }, [hoveredDay, history, hidden]);

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card">
      {/* Legend */}
      <div className="flex items-center gap-4 border-b border-border px-4 py-2.5">
        <span className="eyebrow">Balance Trends</span>
        <div className="ml-auto flex items-center gap-3">
          {history.map((h) => (
            <button
              key={h.provider}
              type="button"
              onClick={() => toggleProvider(h.provider)}
              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold transition ${
                hidden.has(h.provider) ? "opacity-30" : "opacity-100"
              }`}
              style={{ color: h.color }}
              aria-label={`${hidden.has(h.provider) ? "Show" : "Hide"} ${h.provider}`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: h.color }} />
              {h.provider.charAt(0).toUpperCase() + h.provider.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="relative p-3 sm:p-4">
        <svg
          role="img"
          aria-label="Balance trends chart"
          viewBox={`0 0 ${w} ${h}`}
          className="w-full motion-respects"
          style={{ height }}
        >
          {/* Grid lines */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={CHART_PADDING.left}
                x2={w - CHART_PADDING.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
              <text
                x={CHART_PADDING.left - 8}
                y={y(tick) + 3}
                textAnchor="end"
                className="num"
                fill="var(--color-muted)"
                fontSize="9"
              >
                {formatBDT(tick)}
              </text>
            </g>
          ))}

          {/* X-axis labels */}
          {xLabels.map((day) => (
            <text
              key={day}
              x={x(day)}
              y={h - 6}
              textAnchor="middle"
              fill="var(--color-muted)"
              fontSize="9"
              className="num"
            >
              {formatDayShort(day)}
            </text>
          ))}

          {/* Data lines */}
          {history.map((h) => {
            if (hidden.has(h.provider)) return null;
            if (h.points.length < 2) return null;

            const pathD = h.points
              .map((p, i) => {
                const cx = x(p.day);
                const cy = y(p.balance);
                return `${i === 0 ? "M" : "L"}${cx.toFixed(1)},${cy.toFixed(1)}`;
              })
              .join(" ");

            const fillD = `${pathD} L${x(h.points[h.points.length - 1].day)},${y(yMin)} L${x(h.points[0].day)},${y(yMin)} Z`;

            return (
              <g key={h.provider}>
                <defs>
                  <linearGradient id={`trend-grad-${h.provider}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={h.color} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={h.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={fillD} fill={`url(#trend-grad-${h.provider})`} />
                <path
                  d={pathD}
                  fill="none"
                  stroke={h.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

          {/* Hover crosshair */}
          {hoveredDay && (
            <line
              x1={x(hoveredDay)}
              x2={x(hoveredDay)}
              y1={CHART_PADDING.top}
              y2={h - CHART_PADDING.bottom}
              stroke="var(--color-muted)"
              strokeWidth={1}
              strokeDasharray="3 2"
              opacity={0.5}
            />
          )}

          {/* Invisible hover hit area */}
          {allDays.map((day) => (
            <rect
              key={day}
              x={x(day) - (allDays.length > 1 ? innerW / allDays.length / 2 : 20)}
              y={CHART_PADDING.top}
              width={allDays.length > 1 ? innerW / allDays.length : 40}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoveredDay(day)}
              onMouseLeave={() => setHoveredDay(null)}
            />
          ))}
        </svg>

        {/* Tooltip */}
        {tooltipData && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-border bg-surface px-3 py-2 shadow-card"
            style={{
              left: `${(x(tooltipData.day) / w) * 100}%`,
              top: "20%",
              transform: "translate(-50%, 0)",
            }}
          >
            <p className="num text-[10px] font-semibold text-muted">{tooltipData.day}</p>
            {tooltipData.items.map((item) => (
              <p key={item.label} className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
                <span style={{ color: item.color }}>{item.label.charAt(0).toUpperCase() + item.label.slice(1)}</span>
                <span className="num text-ink">{formatBDT(item.balance)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Shared EmptyChart ────────────────────────────────────────────── */

export function EmptyChart({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border px-4 py-2.5">
        <span className="eyebrow">{title}</span>
      </div>
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="mb-3 opacity-50"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <p className="text-sm font-medium text-muted">{description}</p>
        {children}
      </div>
    </section>
  );
}


