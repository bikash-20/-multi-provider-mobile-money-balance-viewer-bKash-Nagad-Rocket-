/**
 * lib/domain/repositories/transferRepo.ts — append-only double-entry ledger.
 *
 * `commit` writes both balance updates and the transfer row atomically.
 * The unique constraint on `transfer_id` makes a replay a no-op (returns
 * the previously persisted row), so the same `transferId` can be safely
 * retried from any layer.
 */
import type { Transfer } from "../entities/transfer";
import type { ProviderId } from "../providerId";
import type { Paise } from "../money";
import type { TransferIdT } from "../transferId";

export interface TransferRepo {
  /**
   * Atomically: apply both deltas (optimistic-locked), append the transfer
   * row, append the matching `wallet_events` row. Idempotent on
   * `transferId` — replay returns the prior row instead of mutating.
   *
   * Throws `TransferConflictError` if the optimistic-lock versions are stale.
   */
  commit(args: {
    transferId: TransferIdT;
    personaId: string;
    fromProvider: ProviderId;
    toProvider: ProviderId;
    amountBdt: Paise;
    fromExpectedVersion: number;
    toExpectedVersion: number;
    note: string;
  }): Promise<Transfer>;

  byId(transferId: TransferIdT): Promise<Transfer | null>;

  /** Most recent N transfers for a persona, newest first. */
  recent(personaId: string, limit: number): Promise<Transfer[]>;
}

export class TransferConflictError extends Error {
  constructor(public readonly transferId: TransferIdT) {
    super(`transfer conflict for ${transferId}: optimistic version was stale`);
    this.name = "TransferConflictError";
  }
}