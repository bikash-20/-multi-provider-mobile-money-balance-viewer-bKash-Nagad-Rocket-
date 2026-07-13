/**
 * lib/domain/entities/forecast.ts — time-to-exhaustion advisory signal.
 *
 * LiquiGuard port: same alpha (0.35), same 12-minute sliding window,
 * same EWMA drain rate in BDT/min, same 95% CI interpretation. The
 * confidence score rises with both sample count and consistency; below
 * 0.5 the frontend swaps to the degraded layout (SafeFallbackLayout).
 */
import type { ProviderId } from "../providerId";

export type ForecastStatus =
  | "healthy"
  | "stable_or_replenishing"
  | "warning"
  | "critical"
  | "exhausted";

export interface Forecast {
  readonly personaId: string;
  readonly providerId: ProviderId;
  readonly ewmaDrainBdtPerMin: number;
  readonly predictedTteMin: number | null;
  readonly ci95Low: number | null;
  readonly ci95High: number | null;
  readonly confidenceScore: number; // [0, 1]
  readonly sampleCount: number;
  readonly windowSeconds: number;
  readonly status: ForecastStatus;
  readonly asOfTs: number;
}