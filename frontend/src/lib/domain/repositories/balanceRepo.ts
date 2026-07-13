/**
 * lib/domain/repositories/balanceRepo.ts — read/write contract for current
 * per-provider balances.
 *
 * The interface knows about optimistic locking (callers pass an expected
 * version) but nothing about SQL. The SQLite implementation in
 * `lib/infrastructure/repos/sqliteBalanceRepo.ts` is one possible binding.
 */
import type { ProviderBalance } from "../entities/providerBalance";
import type { ProviderId } from "../providerId";
import type { Paise } from "../money";

export interface BalanceRepo {
  /** Returns null when the persona/provider pair has not been seeded. */
  get(personaId: string, providerId: ProviderId): Promise<ProviderBalance | null>;

  /** Lists the three provider rows for a persona, omitting any that are absent. */
  listByPersona(personaId: string): Promise<ProviderBalance[]>;

  /**
   * Atomically apply a signed delta to `personaId.providerId`. `expectedVersion`
   * must match the current row's version_id; a mismatch raises a
   * `BalanceConflictError` so the caller can retry (with jittered backoff,
   * matching LiquiGuard's pattern).
   *
   * Returns the post-commit row (new balance + new version).
   */
  applyDelta(args: {
    personaId: string;
    providerId: ProviderId;
    deltaBdt: Paise;
    expectedVersion: number;
  }): Promise<ProviderBalance>;
}

/** Raised when the optimistic lock is stale. Callers should re-read and retry. */
export class BalanceConflictError extends Error {
  constructor(public readonly personaId: string, public readonly providerId: ProviderId) {
    super(`balance conflict for ${personaId}/${providerId}: expected_version was stale`);
    this.name = "BalanceConflictError";
  }
}

/** Raised when the requested transfer would push a balance below zero. */
export class InsufficientBalanceError extends Error {
  constructor(public readonly personaId: string, public readonly providerId: ProviderId) {
    super(`insufficient balance for ${personaId}/${providerId}`);
    this.name = "InsufficientBalanceError";
  }
}