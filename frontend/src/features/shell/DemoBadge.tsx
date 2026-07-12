"use client";
/**
 * DemoBadge — persistent disclosure in the header subtitle.
 *
 * Renders a small amber pill saying "Demo · simulated data" plus
 * (optionally) the active persona label. Shown whenever
 * meta.isDemo === true; otherwise the header subtitle falls back to
 * the default "Multi-provider balance viewer" copy.
 *
 * Disclosure, not decoration: the goal is to never let an investor
 * (or anyone watching the demo) confuse simulated numbers with real
 * balances.
 */

import type { MetaSnapshot } from "@/lib/metaTypes";

interface DemoBadgeProps {
  meta: MetaSnapshot | null;
}

export function DemoBadge({ meta }: DemoBadgeProps) {
  if (!meta?.isDemo) return null;
  return (
    <span
      className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-semibold text-signal sm:text-[11px]"
      title="The numbers on this screen are simulated. They are not real financial records."
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-signal"
      />
      Demo · simulated data
      {meta.label && (
        <>
          <span aria-hidden className="text-muted">·</span>
          <span className="text-muted">{meta.label}</span>
        </>
      )}
    </span>
  );
}