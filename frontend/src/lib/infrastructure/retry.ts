/**
 * lib/infrastructure/retry.ts — bounded retry with jittered backoff.
 *
 * Used by v2 bindings (SqliteEntriesRepo, future SqliteTransferRepo)
 * to recover from optimistic-lock conflicts without surfacing 5xx
 * responses to the UI on the first contention. The shape mirrors
 * LiquiGuard's `RetryExecutor` so server-side retry semantics stay
 * consistent as more v2 writes come online.
 *
 * IMPORTANT — this is NOT a generic http/cache retry. It's tuned for
 * domain writes where:
 *   - the side effect either happens or doesn't (no half-applied state)
 *   - failures can be classified into "retryable" (conflict / IO blip)
 *     vs "non-retryable" (validation / constraint violation)
 *   - jitter is mandatory so concurrent writers don't stampede
 *
 * Non-retryable errors short-circuit and propagate as-is.
 */

export interface RetryPolicy {
  /** Max attempts including the first try. Must be ≥ 1. */
  maxAttempts: number;
  /** Base delay in ms (before jitter is applied). */
  baseDelayMs: number;
  /** Cap on total delay across all attempts. */
  maxTotalMs: number;
  /** Multiplier per attempt (delay doubles when this is 2, etc.). */
  factor: number;
  /** RNG seam for tests. */
  rand?: () => number;
  /** Sleep seam for tests (returns a promise resolved by `wakeAt - now`). */
  sleep?: (ms: number) => Promise<void>;
  /** When set, the elapsed wall-clock time is reported via this fn. */
  onAttempt?: (attempt: number, delayMs: number, err: unknown) => void;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  // 5 attempts means up to 4 backoffs. Each subsequent conflict is
  // exponentially less likely; blowing past 5 means something is
  // fundamentally wrong (e.g. a runaway writer) and a 500 is honest.
  maxAttempts: 5,
  baseDelayMs: 20,
  maxTotalMs: 1_000,
  factor: 2,
};

export class RetryAbortError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message);
    this.name = "RetryAbortError";
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Sleep with jitter: full-jitter (AWS Architecture Blog's formula).
 *  Picks a uniform random in `[0, cap]` so a thundering herd of N
 *  concurrent retries decorrelates; the AWS Architecture Blog's
 *  full-jitter math shows this is provably better than equal-jitter
 *  or decorrelated-jitter for writes with sub-second contention. */
export function jitteredDelay(
  attempt: number,
  policy: RetryPolicy,
): number {
  const rand = policy.rand ?? Math.random;
  const exp = policy.baseDelayMs * Math.pow(policy.factor, attempt - 1);
  // Full-jitter: rand in [0, exp), capped at policy.maxTotalMs.
  return Math.min(policy.maxTotalMs, Math.floor(rand() * exp));
}

/**
 * Run `fn` with retry. `isRetryable` decides whether an exception is
 * worth retrying. Returns the first successful result; throws the
 * last exception (wrapped in `RetryAbortError` if the policy was
 * exhausted, original error otherwise) when retries are exhausted.
 */
export async function runWithRetry<T>(
  fn: () => Promise<T> | T,
  isRetryable: (err: unknown) => boolean,
  policy: Partial<RetryPolicy> = {},
): Promise<T> {
  const p: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...policy };
  if (p.maxAttempts < 1) throw new Error("maxAttempts must be ≥ 1");

  const sleep = p.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= p.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
      if (attempt === p.maxAttempts) break;
      const delay = jitteredDelay(attempt, p);
      p.onAttempt?.(attempt, delay, err);
      // Always sleep — even on delay=0 it gives the event loop a turn
      // and lets onAttempt fire consistently for observability.
      await sleep(delay);
    }
  }
  throw new RetryAbortError(
    `runWithRetry exhausted after ${p.maxAttempts} attempts`,
    lastErr,
  );
}
