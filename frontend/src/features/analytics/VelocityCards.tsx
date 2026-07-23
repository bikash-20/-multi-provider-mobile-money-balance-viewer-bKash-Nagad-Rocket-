"use client";
/**
 * VelocityCards — Per-provider balance velocity displays.
 *
 * Shows daily and weekly average change rate for each provider.
 * Compact cards designed to fit in a 3-column grid on desktop,
 * single-column on mobile.
 *
 * Color rules:
 *  - Positive velocity → signal (amber)
 *  - Negative velocity → bkash (pink)
 *  - Flat → muted (grey)
 */

import { PROVIDER_HEX, PROVIDER_LABEL, type Provider } from "@/features/wallet/types";
import type { ProviderVelocity } from "./types";

interface VelocityCardsProps {
  velocities: ProviderVelocity[];
}

export function VelocityCards({ velocities }: VelocityCardsProps) {
  if (velocities.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border px-4 py-2.5">
        <span className="eyebrow">Balance Velocity</span>
      </div>
      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-3 sm:p-4">
        {velocities.map((v) => (
          <VelocityCard key={v.provider} velocity={v} />
        ))}
      </div>
    </section>
  );
}

function VelocityCard({ velocity }: { velocity: ProviderVelocity }) {
  const { provider, dailyAvg, weeklyAvg, direction } = velocity;

  const isUp = direction === "up";
  const isDown = direction === "down";

  const fgColor = isUp ? "var(--color-signal)" : isDown ? "#E0447A" : "var(--color-muted)";
  const bgColor = isUp ? "var(--color-signal-soft)" : isDown ? "rgba(224, 68, 122, 0.10)" : "var(--color-surface-2)";

  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3 transition hover:border-ink/20">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: PROVIDER_HEX[provider] }} aria-hidden />
        <span className="text-xs font-semibold text-ink">{PROVIDER_LABEL[provider]}</span>
      </div>

      <div className="mt-3 flex items-baseline gap-1">
        <span className="num text-xl font-semibold" style={{ color: fgColor }}>
          {isUp ? "+" : ""}{dailyAvg.toFixed(1)}
        </span>
        <span className="text-[10px] text-muted">/day</span>
      </div>

      <div className="mt-1 flex items-center gap-3">
        <span className="num text-[11px]" style={{ color: fgColor }}>
          {isUp ? "↑" : isDown ? "↓" : "·"} {isUp ? "+" : ""}{weeklyAvg.toFixed(1)}
        </span>
        <span className="text-[10px] text-muted">weekly avg</span>
      </div>

      {/* Mini indicator bar */}
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--color-border)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, Math.abs(dailyAvg) * 2 + 5)}%`,
            background: fgColor,
            opacity: 0.7,
          }}
        />
      </div>
    </div>
  );
}
