"use client";
/**
 * TotalBalanceHeader — hero number on the dashboard.
 *
 * Receives `total` as a derived prop (parent computes from
 * selectors.grandTotal on every render). Caption language matches
 * spec section 3.1: "Manually tracked · updated {time}" so it never
 * implies live sync.
 *
 * The total animates from previous to new via useCountUp, matching
 * the per-card balance animation. Stays in sync because both use the
 * same hook + duration.
 */

import { formatBDT, formatRelative } from "@/lib/time";
import { useCountUp } from "./useCountUp";

interface TotalBalanceHeaderProps {
  total: number;
  lastUpdatedAt: string | undefined;
  /** Whether any provider has a non-BDT balance entry. */
  includesForeignCurrency?: boolean;
}

export function TotalBalanceHeader({
  total,
  lastUpdatedAt,
  includesForeignCurrency = false,
}: TotalBalanceHeaderProps) {
  const rel = lastUpdatedAt ? formatRelative(lastUpdatedAt) : "—";
  // Longer duration on the hero number — feels deliberate, not twitchy.
  const animated = useCountUp(total, 750);
  return (
    <header
      aria-label="Total balance across all providers"
      className="rounded-2xl border border-border bg-surface px-4 py-5 shadow-card sm:px-6 sm:py-7"
    >
      <p className="eyebrow">Total Balance</p>
      <p className="mt-2 hero-total">{formatBDT(animated)}</p>
      <p className="mt-3 text-xs text-muted sm:text-sm">
        Manually tracked ·{" "}
        <span className="num">
          {lastUpdatedAt ? `updated ${rel}` : "awaiting first entry"}
        </span>
        {includesForeignCurrency && (
          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold text-signal">
            · Includes USD amounts
          </span>
        )}
      </p>
    </header>
  );
}