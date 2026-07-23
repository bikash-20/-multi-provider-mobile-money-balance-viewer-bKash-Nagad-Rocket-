/**
 * lib/domain/forecast.ts — Pure EWMA forecasting with confidence intervals.
 *
 * EWMA (Exponentially Weighted Moving Average) is a lightweight time-series
 * forecasting method that gives exponentially decreasing weight to older
 * observations. It requires no training, no state, and works well for
 * smooth, non-seasonal financial data like wallet balances.
 *
 * Formulas:
 *   y_t = α · x_t + (1 − α) · y_{t−1}    (smoothed value)
 *   f_{t+k} = y_last                      (flat forecast — EWMA is a random walk)
 *
 * Confidence intervals are computed from the historical residuals (errors)
 * between the smoothed values and actual observations. Under the assumption
 * that residuals are normally distributed:
 *   - 68% CI: ±1σ
 *   - 95% CI: ±2σ
 *   - 99% CI: ±3σ
 *
 * Time complexity:
 *   - fitEwma: O(n) single pass over the daily series
 *   - forecast: O(m) where m = forecast horizon (7 days)
 *   - computeConfidence: O(n) single pass over residuals
 *
 * Space complexity: O(n + m) — stores the smoothed series + forecast.
 */

import type { DailyPoint } from "@/lib/sparklineSeries";

/** Configuration for the EWMA model. */
export interface EwmaConfig {
  /** Smoothing factor (0, 1]. Higher = more weight on recent data.
   *  Default 0.3. Typical range: 0.1 (smooth) to 0.5 (responsive). */
  alpha: number;
}

/** A single forecasted point. */
export interface ForecastPoint {
  /** ISO date YYYY-MM-DD. */
  day: string;
  /** Point forecast (expected value). */
  value: number;
  /** Lower bound of the confidence interval. */
  lower68: number;
  upper68: number;
  lower95: number;
  upper95: number;
}

/** Full forecast result for one provider. */
export interface ProviderForecast {
  provider: string;
  /** Provider color hex. */
  color: string;
  /** Historical daily series used for fitting. */
  history: DailyPoint[];
  /** Smoothed values over the historical period. One per history point. */
  smoothed: DailyPoint[];
  /** Forecasted points (7 days forward). */
  forecast: ForecastPoint[];
  /** Residual statistics. */
  residuals: {
    mean: number;      // should be ~0 for unbiased model
    stdDev: number;    // standard deviation of residuals
    rmse: number;      // root mean squared error
  };
}

/** Default configuration. */
const DEFAULT_CONFIG: EwmaConfig = { alpha: 0.3 };

/**
 * Fit EWMA to a daily series and forecast 7 days forward.
 *
 * @param points — Daily balance points sorted by date ASC.
 * @param color — Provider color hex for the chart.
 * @param config — Optional EWMA config (default alpha = 0.3).
 * @param horizon — Forecast horizon in days (default 7).
 * @returns ProviderForecast or null if insufficient data (< 3 points).
 */
export function forecastEwma(
  points: ReadonlyArray<DailyPoint>,
  color: string,
  config: EwmaConfig = DEFAULT_CONFIG,
  horizon: number = 7,
): ProviderForecast | null {
  if (points.length < 3) return null;

  const { alpha } = config;
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));

  // 1. Fit EWMA: compute smoothed values.
  const smoothed: DailyPoint[] = [];
  const residuals: number[] = [];
  let prevSmoothed = sorted[0]!.balance;

  for (let i = 0; i < sorted.length; i++) {
    const actual = sorted[i]!.balance;
    const s = i === 0 ? actual : alpha * actual + (1 - alpha) * prevSmoothed;
    smoothed.push({ day: sorted[i]!.day, balance: Math.round(s * 100) / 100 });
    if (i > 0) {
      residuals.push(actual - prevSmoothed);
    }
    prevSmoothed = s;
  }

  // 2. Compute residual statistics.
  const n = residuals.length;
  const residualMean = n > 0
    ? residuals.reduce((sum, r) => sum + r, 0) / n
    : 0;
  const variance = n > 1
    ? residuals.reduce((sum, r) => sum + (r - residualMean) ** 2, 0) / (n - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const rmse = n > 0
    ? Math.sqrt(residuals.reduce((sum, r) => sum + r ** 2, 0) / n)
    : 0;

  // 3. Generate forecast: EWMA flat forecast (last smoothed value) + widening CI.
  const lastDay = sorted[sorted.length - 1]!.day;
  const lastValue = smoothed[smoothed.length - 1]!.balance;
  const forecast: ForecastPoint[] = [];
  // The forecast error grows with sqrt(k) for a random walk.
  // For days 1..7, the standard error = stdDev * sqrt(k).
  for (let k = 1; k <= horizon; k++) {
    const nextDate = addDays(lastDay, k);
    const se = stdDev * Math.sqrt(k); // standard error grows with sqrt(k)
    forecast.push({
      day: nextDate,
      value: lastValue,
      lower68: Math.round((lastValue - se) * 100) / 100,
      upper68: Math.round((lastValue + se) * 100) / 100,
      lower95: Math.round((lastValue - 1.96 * se) * 100) / 100,
      upper95: Math.round((lastValue + 1.96 * se) * 100) / 100,
    });
  }

  return {
    provider: "",
    color,
    history: sorted,
    smoothed,
    forecast,
    residuals: {
      mean: Math.round(residualMean * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      rmse: Math.round(rmse * 100) / 100,
    },
  };
}

/** Add k days to an ISO YYYY-MM-DD string. O(1). */
function addDays(isoDay: string, k: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  if (!y || !m || !d) return isoDay;
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + k);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Compute the next `days` ISO day strings starting from `startDay` (inclusive).
 * O(days). Pure.
 */
export function enumerateForecastDays(startDay: string, days: number): string[] {
  const result: string[] = [];
  for (let i = 1; i <= days; i++) {
    result.push(addDays(startDay, i));
  }
  return result;
}
