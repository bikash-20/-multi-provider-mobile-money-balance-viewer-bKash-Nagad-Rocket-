"use client";
/**
 * NetWorthChart — Single-series SVG line chart of combined balance.
 *
 * Shows the sum of all 3 providers over time. Uses the same axis/scale
 * conventions as BalanceTrendChart so the two charts feel consistent.
 *
 * Features:
 *  - Gradient area fill in signal (amber)
 *  - Hover tooltip with per-provider breakdown
 *  - Current net worth callout at the right edge
 */

import { useMemo, useState } from "react";
import { formatBDT, formatDayShort } from "@/lib/time";
import { PROVIDER_HEX, type Provider } from "@/features/wallet/types";
import type { NetWorthPoint } from "./types";

interface NetWorthChartProps {
  history: NetWorthPoint[];
  height?: number;
}

const PAD = { top: 20, right: 20, bottom: 36, left: 56 };
const AXIS_TICKS = 5;
const NET_WORTH_COLOR = "var(--color-signal)";

export function NetWorthChart({ history, height = 220 }: NetWorthChartProps) {
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);

  const { yMin, yMax, allDays } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of history) {
      if (p.total < min) min = p.total;
      if (p.total > max) max = p.total;
    }
    if (!Number.isFinite(min)) return { yMin: 0, yMax: 1000, allDays: [] };
    const padding = (max - min) * 0.1 || max * 0.1 || 100;
    return {
      yMin: Math.max(0, min - padding),
      yMax: max + padding,
      allDays: history.map((p) => p.day),
    };
  }, [history]);

  if (history.length === 0) {
    return null;
  }

  const w = 700;
  const h = height;
  const innerW = w - PAD.left - PAD.right;
  const innerH = h - PAD.top - PAD.bottom;
  const yRange = yMax - yMin || 1;

  function xPos(day: string): number {
    const i = allDays.indexOf(day);
    return PAD.left + (i / Math.max(allDays.length - 1, 1)) * innerW;
  }

  function yPos(balance: number): number {
    return PAD.top + innerH - ((balance - yMin) / yRange) * innerH;
  }

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= AXIS_TICKS; i++) {
      ticks.push(yMin + (yRange * i) / AXIS_TICKS);
    }
    return ticks;
  }, [yMin, yRange]);

  const xLabels = useMemo(() => {
    if (allDays.length <= 6) return allDays;
    const step = Math.floor((allDays.length - 1) / 5);
    const labels = [allDays[0]];
    for (let i = step; i < allDays.length - 1; i += step) {
      labels.push(allDays[i]);
    }
    if (labels[labels.length - 1] !== allDays[allDays.length - 1]) {
      labels.push(allDays[allDays.length - 1]);
    }
    return labels;
  }, [allDays]);

  // Build path
  const pathD = history
    .map((p, i) => `${i === 0 ? "M" : "L"}${xPos(p.day).toFixed(1)},${yPos(p.total).toFixed(1)}`)
    .join(" ");

  const fillD = `${pathD} L${xPos(history[history.length - 1].day)},${yPos(yMin)} L${xPos(history[0].day)},${yPos(yMin)} Z`;

  const latest = history[history.length - 1];
  const first = history[0];
  const pctChange = first && first.total > 0
    ? (((latest.total - first.total) / first.total) * 100).toFixed(1)
    : null;

  // Tooltip data
  const tooltip = useMemo(() => {
    if (!hoveredDay) return null;
    const pt = history.find((p) => p.day === hoveredDay);
    if (!pt) return null;
    return pt;
  }, [hoveredDay, history]);

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="eyebrow">Net Worth</span>
        {pctChange && (
          <span className={`num text-[11px] font-semibold ${Number(pctChange) >= 0 ? "text-signal" : "text-bkash"}`}>
            {Number(pctChange) >= 0 ? "+" : ""}{pctChange}%
          </span>
        )}
      </div>
      <div className="relative p-3 sm:p-4">
        <svg
          role="img"
          aria-label="Net worth chart"
          viewBox={`0 0 ${w} ${h}`}
          className="w-full motion-respects"
          style={{ height }}
        >
          <defs>
            <linearGradient id="nw-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={NET_WORTH_COLOR} stopOpacity={0.2} />
              <stop offset="100%" stopColor={NET_WORTH_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>

          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={w - PAD.right} y1={yPos(tick)} y2={yPos(tick)} stroke="var(--color-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={yPos(tick) + 3} textAnchor="end" className="num" fill="var(--color-muted)" fontSize="9">
                {formatBDT(tick)}
              </text>
            </g>
          ))}

          {xLabels.map((day) => (
            <text key={day} x={xPos(day)} y={h - 6} textAnchor="middle" fill="var(--color-muted)" fontSize="9" className="num">
              {formatDayShort(day)}
            </text>
          ))}

          <path d={fillD} fill="url(#nw-grad)" />
          <path d={pathD} fill="none" stroke={NET_WORTH_COLOR} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

          {/* End dot */}
          <circle cx={xPos(latest.day)} cy={yPos(latest.total)} r={3.5} fill={NET_WORTH_COLOR} />

          {/* Hover crosshair */}
          {hoveredDay && (
            <line x1={xPos(hoveredDay)} x2={xPos(hoveredDay)} y1={PAD.top} y2={h - PAD.bottom} stroke="var(--color-muted)" strokeWidth={1} strokeDasharray="3 2" opacity={0.5} />
          )}

          {/* Hit area */}
          {allDays.map((day) => (
            <rect
              key={day}
              x={xPos(day) - (allDays.length > 1 ? innerW / allDays.length / 2 : 20)}
              y={PAD.top}
              width={allDays.length > 1 ? innerW / allDays.length : 40}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoveredDay(day)}
              onMouseLeave={() => setHoveredDay(null)}
            />
          ))}
        </svg>

        {tooltip && (
          <div className="pointer-events-none absolute z-10 rounded-lg border border-border bg-surface px-3 py-2 shadow-card" style={{ left: `${(xPos(tooltip.day) / w) * 100}%`, top: "10%", transform: "translate(-50%, 0)" }}>
            <p className="num text-[10px] font-semibold text-muted">{tooltip.day}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
              <span className="num text-signal">{formatBDT(tooltip.total)}</span>
            </p>
            <div className="mt-1 space-y-0.5">
              {(Object.keys(tooltip.breakdown) as Provider[]).map((prov) => (
                <p key={prov} className="flex items-center gap-1 text-[10px]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: PROVIDER_HEX[prov] }} />
                  <span className="text-muted">{prov.charAt(0).toUpperCase() + prov.slice(1)}</span>
                  <span className="num text-ink">{formatBDT(tooltip.breakdown[prov] as number)}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}


