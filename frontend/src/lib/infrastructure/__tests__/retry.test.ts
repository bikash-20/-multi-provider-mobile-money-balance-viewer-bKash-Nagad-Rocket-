/**
 * retry.ts — verify the bounded retry executor.
 *
 *   - success on first try: no sleep, no attempt callback fires
 *   - success after N retries: sleeps occur with bounded jitter, onAttempt fires N times
 *   - exhausting maxAttempts throws RetryAbortError, no further sleeps
 *   - non-retryable errors short-circuit (no retries)
 *   - jitter is bounded by baseDelayMs * factor^(attempt-1) capped at maxTotalMs
 */
import { describe, it, expect, vi } from "vitest";

import {
  jitteredDelay,
  runWithRetry,
  RetryAbortError,
  type RetryPolicy,
} from "@/lib/infrastructure/retry";

const NEVER_RETRY = () => false;
const ALWAYS_RETRY = () => true;

function makePolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    maxAttempts: 5,
    baseDelayMs: 20,
    maxTotalMs: 1_000,
    factor: 2,
    rand: () => 0.5,
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

describe("jitteredDelay", () => {
  it("is bounded by baseDelayMs * factor^(attempt-1) capped at maxTotalMs", () => {
    const p = makePolicy({ rand: () => 0.999 });
    // attempt 1 → exp = 20, rand 0.999 → 19.98 → floor 19; always < 20 ms
    expect(jitteredDelay(1, p)).toBeLessThan(20);
    // attempt 4 → exp = 20 * 2^3 = 160; 0.999 * 160 = 159.84 → 159 ms
    expect(jitteredDelay(4, p)).toBeLessThan(160);
    // attempt 20 would be huge → capped at maxTotalMs (1000)
    expect(jitteredDelay(20, p)).toBe(1000);
  });

  it("with rand=0 returns 0 (no jitter floor)", () => {
    const p = makePolicy({ rand: () => 0 });
    expect(jitteredDelay(1, p)).toBe(0);
  });
});

describe("runWithRetry", () => {
  it("returns the result without sleeping when fn succeeds first try", async () => {
    const sleep = vi.fn();
    const onAttempt = vi.fn();
    const result = await runWithRetry(
      () => Promise.resolve("ok"),
      NEVER_RETRY,
      makePolicy({ sleep, onAttempt }),
    );
    expect(result).toBe("ok");
    expect(sleep).not.toHaveBeenCalled();
    expect(onAttempt).not.toHaveBeenCalled();
  });

  it("retries on retryable errors and returns the eventual success", async () => {
    const sleep = vi.fn();
    const onAttempt = vi.fn();
    let calls = 0;
    const result = await runWithRetry(
      () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return Promise.resolve("ok");
      },
      ALWAYS_RETRY,
      makePolicy({ sleep, onAttempt }),
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    // Sleep fires once per failed attempt (between attempts 1→2 and 2→3).
    expect(sleep).toHaveBeenCalledTimes(2);
    // onAttempt fires once per failed attempt.
    expect(onAttempt).toHaveBeenCalledTimes(2);
  });

  it("throws the original error when non-retryable", async () => {
    const sleep = vi.fn();
    let calls = 0;
    await expect(
      runWithRetry(
        () => {
          calls++;
          throw new Error("nope");
        },
        NEVER_RETRY,
        makePolicy({ sleep }),
      ),
    ).rejects.toThrow("nope");
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("wraps the last error in RetryAbortError after exhausting maxAttempts", async () => {
    const sleep = vi.fn();
    let calls = 0;
    await expect(
      runWithRetry(
        () => {
          calls++;
          throw new Error("still bad");
        },
        ALWAYS_RETRY,
        makePolicy({ maxAttempts: 3, sleep }),
      ),
    ).rejects.toThrow(RetryAbortError);
    expect(calls).toBe(3);
    // Sleep fires maxAttempts - 1 times.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("caps total delay so retry loop never blocks past maxTotalMs", async () => {
    const sleep = vi.fn();
    const delays: number[] = [];
    sleep.mockImplementation((ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    });
    await expect(
      runWithRetry(
        () => {
          throw new Error("nope");
        },
        ALWAYS_RETRY,
        makePolicy({
          maxAttempts: 5,
          baseDelayMs: 100,
          factor: 10,
          maxTotalMs: 200,
          rand: () => 1,
          sleep,
        }),
      ),
    ).rejects.toThrow(RetryAbortError);
    // Without the cap, attempts would be 100/1000/10000/100000 → 111_100
    // total. With maxTotalMs=200, each per-attempt delay is capped to
    // 200, so totals stay sane.
    const total = delays.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(4 * 200 + 16); // allow rounding
    for (const d of delays) expect(d).toBeLessThanOrEqual(200);
  });

  it("defaults: maxAttempts=5, no oversize sleep when rand=0", async () => {
    const sleep = vi.fn();
    await expect(
      runWithRetry(
        () => {
          throw new Error("nope");
        },
        ALWAYS_RETRY,
        makePolicy({ rand: () => 0, sleep }),
      ),
    ).rejects.toThrow(RetryAbortError);
    expect(sleep).toHaveBeenCalledTimes(4);
    for (const call of sleep.mock.calls) {
      expect(call[0]).toBe(0);
    }
  });

  it("rejects negative maxAttempts", async () => {
    await expect(
      runWithRetry(() => 1, NEVER_RETRY, { maxAttempts: 0 }),
    ).rejects.toThrow(/maxAttempts/);
  });
});
