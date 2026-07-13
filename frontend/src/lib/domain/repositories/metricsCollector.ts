/**
 * lib/domain/repositories/metricsCollector.ts — bounded runtime metrics.
 *
 * LiquiGuard port: bounded deques, linear-interpolated percentiles, and
 * cumulative counters. The collector is in-process and survives only the
 * request lifetime; the durable history lives in `wallet_events`. This
 * file defines only the contract; the implementation is in
 * `lib/infrastructure/metrics/runtimeMetrics.ts`.
 */
export interface MetricsSnapshot {
  readonly transferCount: number;
  readonly transferFailureCount: number;
  readonly forecastCount: number;
  readonly advisoryEvaluationCount: number;
  readonly advisoryDetectionCount: number;
  readonly processingLatencyP50Ms: number | null;
  readonly processingLatencyP95Ms: number | null;
  readonly sampleCount: number;
}

export interface MetricsCollector {
  recordTransfer(args: { success: boolean; latencyMs: number }): void;
  recordForecast(): void;
  recordAdvisoryEvaluation(args: { detected: boolean; latencyMs: number }): void;
  snapshot(): MetricsSnapshot;
  reset(): void;
}