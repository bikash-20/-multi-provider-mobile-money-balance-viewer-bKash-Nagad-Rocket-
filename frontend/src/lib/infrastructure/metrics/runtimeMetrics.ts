/**
 * lib/infrastructure/metrics/runtimeMetrics.ts — bounded, in-process
 * runtime metrics. LiquiGuard port: `processing_latency_ms` deque with
 * capacity 2048, linear-interpolated percentiles, cumulative counters
 * with no per-decay component (the durable metrics live in wallet_events
 * — this collector is the hot-path efficiency measurement).
 *
 * Safe for concurrent use within a single Node process. Thread safety
 * is not required because SQLite ops are synchronous on this thread.
 */
import type {
  MetricsCollector,
  MetricsSnapshot,
} from "@/lib/domain/repositories/metricsCollector";

const LATENCY_CAPACITY = 2048;

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const clamped = Math.max(0, Math.min(1, p));
  const idx = clamped * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

export class RuntimeMetrics implements MetricsCollector {
  private readonly latencies: number[] = [];
  private transferCount = 0;
  private transferFailureCount = 0;
  private forecastCount = 0;
  private advisoryEvaluationCount = 0;
  private advisoryDetectionCount = 0;

  recordTransfer(args: { success: boolean; latencyMs: number }): void {
    this.transferCount++;
    if (!args.success) this.transferFailureCount++;
    this.recordLatency(args.latencyMs);
  }

  recordForecast(): void {
    this.forecastCount++;
  }

  recordAdvisoryEvaluation(args: { detected: boolean; latencyMs: number }): void {
    this.advisoryEvaluationCount++;
    if (args.detected) this.advisoryDetectionCount++;
    this.recordLatency(args.latencyMs);
  }

  snapshot(): MetricsSnapshot {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return Object.freeze({
      transferCount: this.transferCount,
      transferFailureCount: this.transferFailureCount,
      forecastCount: this.forecastCount,
      advisoryEvaluationCount: this.advisoryEvaluationCount,
      advisoryDetectionCount: this.advisoryDetectionCount,
      processingLatencyP50Ms: percentile(sorted, 0.5),
      processingLatencyP95Ms: percentile(sorted, 0.95),
      sampleCount: this.latencies.length,
    });
  }

  reset(): void {
    this.latencies.length = 0;
    this.transferCount = 0;
    this.transferFailureCount = 0;
    this.forecastCount = 0;
    this.advisoryEvaluationCount = 0;
    this.advisoryDetectionCount = 0;
  }

  private recordLatency(latencyMs: number): void {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    this.latencies.push(latencyMs);
    if (this.latencies.length > LATENCY_CAPACITY) {
      this.latencies.splice(0, this.latencies.length - LATENCY_CAPACITY);
    }
  }
}

export const runtimeMetrics = new RuntimeMetrics();
