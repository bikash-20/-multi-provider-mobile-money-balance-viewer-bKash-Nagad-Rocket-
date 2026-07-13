/**
 * RuntimeMetrics — percentiles bounded, counters accumulate, snapshot is frozen.
 */
import { describe, it, expect } from "vitest";
import { RuntimeMetrics } from "../runtimeMetrics";

describe("RuntimeMetrics", () => {
  it("accumulates counters and latencies", () => {
    const m = new RuntimeMetrics();
    m.recordTransfer({ success: true, latencyMs: 10 });
    m.recordTransfer({ success: false, latencyMs: 25 });
    m.recordAdvisoryEvaluation({ detected: true, latencyMs: 5 });
    m.recordAdvisoryEvaluation({ detected: false, latencyMs: 7 });
    m.recordForecast();
    const snap = m.snapshot();
    expect(snap.transferCount).toBe(2);
    expect(snap.transferFailureCount).toBe(1);
    expect(snap.advisoryEvaluationCount).toBe(2);
    expect(snap.advisoryDetectionCount).toBe(1);
    expect(snap.forecastCount).toBe(1);
    expect(snap.sampleCount).toBe(4);
  });

  it("linear-interpolates p50 and p95", () => {
    const m = new RuntimeMetrics();
    for (let i = 1; i <= 100; i++) m.recordTransfer({ success: true, latencyMs: i });
    const snap = m.snapshot();
    expect(snap.processingLatencyP50Ms).toBeCloseTo(50.5, 1);
    expect(snap.processingLatencyP95Ms).toBeCloseTo(95.05, 1);
  });

  it("returns null percentiles on empty samples", () => {
    const m = new RuntimeMetrics();
    const snap = m.snapshot();
    expect(snap.processingLatencyP50Ms).toBeNull();
    expect(snap.processingLatencyP95Ms).toBeNull();
    expect(snap.sampleCount).toBe(0);
  });

  it("is bounded to 2048 latency samples", () => {
    const m = new RuntimeMetrics();
    for (let i = 0; i < 3000; i++) m.recordTransfer({ success: true, latencyMs: i });
    expect(m.snapshot().sampleCount).toBe(2048);
  });
});
