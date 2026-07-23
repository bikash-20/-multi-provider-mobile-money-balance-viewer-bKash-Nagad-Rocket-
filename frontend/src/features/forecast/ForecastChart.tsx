"use client";
/**
 * ForecastChart — SVG chart showing historical balances + EWMA forecast.
 *
 * Renders:
 *  - Historical daily balance line (solid, provider color)
 *  - EWMA smoothed line (thin dashed)
 *  - Forecast line (dotted, extends 7 days forward)
 *  - 95% confidence band (semi-transparent fill)
 *  - 68% confidence band (inner fill)
 *  - Legend explaining the lines
 *  - Hover tooltip at the forecast boundary
 *
 * Design follows BalanceTrendChart and NetWorthChart conventions.
 * Zero external dependencies — hand-rolled SVG.
 */

import { useMemo, useState } from "react";
import { formatBDT, formatDayShort } from "@/lib/time";
import type { DailyPoint } from "@/lib/sparklineSeries";
import type { ForecastPoint, ProviderForecast } from "@/lib/domain/forecast";

interface ForecastChartProps {
  forecasts: ProviderForecast[];
  height?: number;
}

const PAD = { top: 24, right: 24, bottom: 36, left: 56 };
const AXIS_TICKS = 5;

export function ForecastChart({ forecasts, height = 300 }: ForecastChartProps) {
  // Filter out null forecasts (insufficient data).
  const valid = useMemo(() => forecasts.filter((f): f is ProviderForecast => f !== null), [forecasts]);

  if (valid.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-surface shadow-card">
        <div className="border-b border-border px-4 py-2.5">
          <span className="eyebrow">Balance Forecast</span>
        </div>
        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mb-3 opacity-50">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <p className="text-sm font-medium text-muted">
            Not enough data for a forecast yet.
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Need at least 3 days of balance entries to generate a prediction.
          </p>
        </div>
      </section>
    );
  }

  // Merge all days (history + forecast) for the X axis.
  const allDays = useMemo(() => {
    const daySet = new Set<string>();
    for (const f of valid) {
      for (const p of f.history) daySet.add(p.day);
      for (const p of f.forecast) daySet.add(p.day);
    }
    return Array.from(daySet).sort();
  }, [valid]);

  // Compute Y bounds across all series + confidence bands.
  const { yMin, yMax } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const f of valid) {
      for (const p of f.history) { if (p.balance < min) min = p.balance; if (p.balance > max) max = p.balance; }
      for (const p of f.smoothed) { if (p.balance < min) min = p.balance; if (p.balance > max) max = p.balance; }
      for (const p of f.forecast) {
        if (p.lower95 < min) min = p.lower95;
        if (p.upper95 > max) max = p.upper95;
      }
    }
    if (!Number.isFinite(min)) return { yMin: 0, yMax: 1000 };
    const padding = (max - min) * 0.15 || max * 0.15 || 100;
    return { yMin: Math.max(0, min - padding), yMax: max + padding };
  }, [valid]);

  const w = 700;
  const h = height;
  const innerW = w - PAD.left - PAD.right;
  const innerH = h - PAD.top - PAD.bottom;
  const yRange = yMax - yMin || 1;

  function xPos(day: string): number {
    const idx = allDays.indexOf(day);
    return PAD.left + (idx / Math.max(allDays.length - 1, 1)) * innerW;
  }
  function yPos(val: number): number {
    return PAD.top + innerH - ((val - yMin) / yRange) * innerH;
  }

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= AXIS_TICKS; i++) ticks.push(yMin + (yRange * i) / AXIS_TICKS);
    return ticks;
  }, [yMin, yRange]);

  // X labels: show ~6 evenly spaced
  const xLabels = useMemo(() => {
    if (allDays.length <= 6) return allDays;
    const step = Math.floor((allDays.length - 1) / 5);
    const labels = [allDays[0]];
    for (let i = step; i < allDays.length - 1; i += step) labels.push(allDays[i]);
    if (labels[labels.length - 1] !== allDays[allDays.length - 1]) labels.push(allDays[allDays.length - 1]);
    return labels;
  }, [allDays]);

  // Find the boundary between history and forecast.
  const historyEndIdx = valid[0] ? allDays.indexOf(valid[0].forecast[0]?.day) - 1 : allDays.length - 1;

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex items-center gap-4 border-b border-border px-4 py-2.5">
        <span className="eyebrow">Balance Forecast</span>
        <div className="ml-auto flex items-center gap-3 text-[10px] text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded bg-ink" /> Historical
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 border-b border-dashed border-muted" /> Forecast
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-sm bg-signal/20" /> 95% CI
          </span>
        </div>
      </div>
      <div className="relative p-3 sm:p-4">
        <svg role="img" aria-label="Balance forecast chart" viewBox={`0 0 ${w} ${h}`} className="w-full motion-respects" style={{ height }}>
          {/* Grid */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={w - PAD.right} y1={yPos(tick)} y2={yPos(tick)} stroke="var(--color-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={yPos(tick) + 3} textAnchor="end" className="num" fill="var(--color-muted)" fontSize="9">{formatBDT(tick)}</text>
            </g>
          ))}

          {/* X-axis labels */}
          {xLabels.map((day) => (
            <text key={day} x={xPos(day)} y={h - 6} textAnchor="middle" fill="var(--color-muted)" fontSize="9" className="num">{formatDayShort(day)}</text>
          ))}

          {/* Vertical separator between history and forecast */}
          {historyEndIdx >= 0 && historyEndIdx < allDays.length - 1 && (
            <line x1={xPos(allDays[historyEndIdx])} x2={xPos(allDays[historyEndIdx])} y1={PAD.top} y2={h - PAD.bottom} stroke="var(--color-border)" strokeWidth={1} strokeDasharray="2 3" />
          )}

          {/* For each provider: confidence band → smoothed → forecast → historical */}
          {valid.map((f) => {
            const color = f.color;
            return (
              <g key={f.provider}>
                <defs>
                  <linearGradient id={`forecast-band95-${f.provider}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.10} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id={`forecast-band68-${f.provider}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.04} />
                  </linearGradient>
                </defs>

                {/* 95% confidence band */}
                {f.forecast.length > 0 && (() => {
                  const u95 = f.forecast.map((p, i) => `${i === 0 ? "M" : "L"}${xPos(p.day).toFixed(1)},${yPos(p.upper95).toFixed(1)}`).join(" ");
                  const l95 = [...f.forecast].reverse().map((p) => `L${xPos(p.day).toFixed(1)},${yPos(p.lower95).toFixed(1)}`).join(" ");
                  return <path d={`${u95} ${l95} Z`} fill={`url(#forecast-band95-${f.provider})`} />;
                })()}

                {/* 68% confidence band */}
                {f.forecast.length > 0 && (() => {
                  const u68 = f.forecast.map((p, i) => `${i === 0 ? "M" : "L"}${xPos(p.day).toFixed(1)},${yPos(p.upper68).toFixed(1)}`).join(" ");
                  const l68 = [...f.forecast].reverse().map((p) => `L${xPos(p.day).toFixed(1)},${yPos(p.lower68).toFixed(1)}`).join(" ");
                  return <path d={`${u68} ${l68} Z`} fill={`url(#forecast-band68-${f.provider})`} />;
                })()}

                {/* Historical line */}
                {f.history.length >= 2 && (() => {
                  const d = f.history.map((p, i) => `${i === 0 ? "M" : "L"}${xPos(p.day).toFixed(1)},${yPos(p.balance).toFixed(1)}`).join(" ");
                  return <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
                })()}

                {/* Smoothed line (thin dashed) */}
                {f.smoothed.length >= 2 && (() => {
                  const d = f.smoothed.map((p, i) => `${i === 0 ? "M" : "L"}${xPos(p.day).toFixed(1)},${yPos(p.balance).toFixed(1)}`).join(" ");
                  return <path d={d} fill="none" stroke={color} strokeWidth={1} strokeDasharray="3 2" opacity={0.5} />;
                })()}

                {/* Forecast line (dotted) — connects from last history point */}
                {f.forecast.length >= 1 && (() => {
                  const lastHist = f.history[f.history.length - 1];
                  const forecastPoints = [
                    { day: lastHist?.day ?? f.forecast[0].day, value: f.forecast[0].value },
                    ...f.forecast,
                  ];
                  const d = forecastPoints.map((p, i) => `${i === 0 ? "M" : "L"}${xPos(p.day).toFixed(1)},${yPos(p.value).toFixed(1)}`).join(" ");
                  return <path d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 3" strokeLinecap="round" />;
                })()}

                {/* End dot on forecast */}
                {f.forecast.length > 0 && (
                  <circle cx={xPos(f.forecast[f.forecast.length - 1].day)} cy={yPos(f.forecast[f.forecast.length - 1].value)} r={3} fill={color} />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
