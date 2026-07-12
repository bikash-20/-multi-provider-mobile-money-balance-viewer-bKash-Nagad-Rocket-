"use client";
/**
 * Sparkline — hand-rolled SVG trend strip.
 *
 * Renders the last `points` for a single provider as a thin smooth
 * path + a tiny dot at the right edge (current value). No external
 * chart lib — recharts would be overkill for one polyline per card
 * and would add ~50KB to the bundle.
 *
 * Design notes:
 *  - viewBox-based, so it scales fluidly to whatever width the parent
 *    gives it. Caller controls width/height via Tailwind classes on
 *    the wrapping div.
 *  - The path is normalised: min→0% y, max→100% y, then padded by
 *    `padding` so the line doesn't kiss the top/bottom edges.
 *  - Renders nothing when `points.length < 2` (need at least two
 *    points to draw a line; one point is just a dot).
 *  - Honors prefers-reduced-motion via the `motion-respects` class —
 *    we skip the entrance fade-in for users who set that preference
 *    (handled in globals.css).
 */
import type { DailyPoint } from "@/lib/sparklineSeries";

interface SparklineProps {
  points: ReadonlyArray<DailyPoint>;
  /** Stroke colour for the path + end-dot. Hex (matches PROVIDER_HEX). */
  color: string;
  /** Logical width / height in CSS units. Aspect is preserved via
   *  preserveAspectRatio="none" so caller controls. */
  width?: number;
  height?: number;
  /** Optional aria-label override; defaults to a generic description. */
  ariaLabel?: string;
  /** Render the dot at the latest point. Defaults true. */
  showEndDot?: boolean;
}

export function Sparkline({
  points,
  color,
  width = 120,
  height = 32,
  ariaLabel,
  showEndDot = true,
}: SparklineProps) {
  if (points.length < 2) {
    // Not enough data to draw a meaningful line. Render an empty
    // placeholder of the same size so the surrounding layout doesn't
    // jump when the first second point arrives.
    return (
      <svg
        role="img"
        aria-label={ariaLabel ?? "Balance trend"}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="sparkline"
      >
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke={color}
          strokeOpacity={0.15}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const padding = 3;
  const innerH = height - padding * 2;
  const innerW = width;

  const balances = points.map((p) => p.balance);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const range = max - min || 1; // avoid divide-by-zero on flat series

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * innerW;
    const norm = (p.balance - min) / range; // 0..1
    const y = padding + (1 - norm) * innerH;
    return { x, y };
  });

  // Build a smooth path: simple polyline. Could be replaced with a
  // monotone-cubic-bezier for fancier curves, but the linear version
  // reads more honestly for money values (no overshoot at peaks).
  const pathD = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(" ");

  // Faint area fill underneath the line, using the same path closed
  // down to the baseline. 8% opacity — visible but never overpowering.
  const fillD = `${pathD} L${coords[coords.length - 1]!.x.toFixed(2)},${height} L${coords[0]!.x.toFixed(2)},${height} Z`;

  const last = coords[coords.length - 1]!;
  const idSuffix = color.replace(/[^a-z0-9]/gi, "");

  return (
    <svg
      role="img"
      aria-label={ariaLabel ?? "Balance trend over recent days"}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="sparkline motion-respects"
    >
      <defs>
        <linearGradient id={`spark-grad-${idSuffix}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#spark-grad-${idSuffix})`} aria-hidden />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showEndDot && (
        <circle
          cx={last.x}
          cy={last.y}
          r={2.5}
          fill={color}
          aria-hidden
        />
      )}
    </svg>
  );
}