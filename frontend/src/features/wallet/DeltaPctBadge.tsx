"use client";
/**
 * DeltaPctBadge — compact "↑ 2.3%" / "↓ -1.1%" pill next to a balance.
 *
 * Compares the most recent balance to the balance N days ago (window
 * default 7). Returns null when there's not enough history to compute
 * a meaningful delta, so the caller doesn't need to guard.
 *
 * Colour rule:
 *   positive  → signal (amber) — money went up
 *   negative  → bkash pink — money went down (subtle, not alarming)
 *   flat      → muted
 *
 * Visual is intentionally quiet — a 12px pill, not a big chart, so
 * three of them on the dashboard don't compete with the totals.
 */
import { useMemo } from "react";

import type { DailyPoint } from "@/lib/sparklineSeries";

interface DeltaPctBadgeProps {
  points: ReadonlyArray<DailyPoint>;
  /** Compare the latest point to the point N days back. Default 7. */
  windowDays?: number;
}

export function DeltaPctBadge({ points, windowDays = 7 }: DeltaPctBadgeProps) {
  const delta = useMemo(() => computeDelta(points, windowDays), [points, windowDays]);
  if (delta === null) return null;

  const arrow = delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "·";
  const sign = delta.value > 0 ? "+" : "";
  const text = `${sign}${delta.value.toFixed(1)}%`;
  // Soft fills are inline-styled (no `bkash-soft` Tailwind token exists
  // — adding one would touch the theme config for one pill).
  const tone =
    delta.direction === "up"
      ? { bg: "var(--color-signal-soft)", fg: "var(--color-signal)" }
      : delta.direction === "down"
        ? { bg: "rgba(224, 68, 122, 0.14)", fg: "#E0447A" }
        : { bg: "var(--color-surface-2)", fg: "var(--color-muted)" };
  const aria = `${delta.direction === "down" ? "down" : delta.direction === "up" ? "up" : "unchanged"} ${Math.abs(delta.value).toFixed(1)} percent over the last ${windowDays} days`;

  return (
    <span
      aria-label={aria}
      className="num inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
      title={aria}
    >
      <span aria-hidden>{arrow}</span>
      {text}
    </span>
  );
}

interface DeltaResult {
  value: number; // signed pct
  direction: "up" | "down" | "flat";
}

function computeDelta(
  points: ReadonlyArray<DailyPoint>,
  windowDays: number,
): DeltaResult | null {
  if (points.length < 2) return null;
  // Points are sorted ascending by day. latest = last, baseline = the
  // point `windowDays` ago if available, else the oldest we have.
  const latest = points[points.length - 1]!;
  const baselineIdx = Math.max(0, points.length - 1 - windowDays);
  const baseline = points[baselineIdx]!;
  if (baseline.balance === 0) return null; // avoid div-by-zero + noisy infinity
  const change = ((latest.balance - baseline.balance) / baseline.balance) * 100;
  // Treat |change| < 0.05% as flat to avoid jitter for essentially
  // unchanged balances.
  if (Math.abs(change) < 0.05) return { value: 0, direction: "flat" };
  return {
    value: change,
    direction: change > 0 ? "up" : "down",
  };
}