/**
 * lib/domain/repositories/transferRepo.ts — append-only double-entry ledger.
 *
 * `commit` writes both balance updates and the transfer row atomically.
 * The unique constraint on `transfer_id` makes a replay a no-op (returns
 * the previously persisted row), so the same `transferId` can be safely
 * retried from any layer.
 *
 * Phase 8: `commitReverse` issues a compensating transfer against an
 * existing one. The compensation is itself a fresh transfers row with
 * from/to swapped and `reverses_transfer_id` pointing at the original.
 * The ledger stays append-only — no UPDATE, no DELETE. Each original
 * may be reversed at most once.
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

  /**
   * Atomically compensate an existing forward transfer. The new row's
   * `from` is the original's `to` and vice versa, with the same
   * `amountBdt`. The new row's `reverses_transfer_id` points back at
   * the original so the UI can render "reversed" badges.
   *
   * Errors:
   *   TransferNotFoundError       → original id does not exist
   *   TransferAlreadyReversedError → original has already been reversed
   *   TransferConflictError        → optimistic-lock version mismatch
   *                                  OR the inverse leg would leave a
   *                                  negative balance (insufficient funds
   *                                  to put the money back where it came)
   *
   * The expectedVersion fields refer to the CURRENT provider_balance
   * versions (not the originals) so a concurrent writer bumping either
   * side fails with TransferConflictError → 409, same as `commit`.
   */
  commitReverse(args: {
    originalTransferId: TransferIdT;
    personaId: string;
    fromExpectedVersion: number; // version of the original's `to` provider (now the inverse `from`)
    toExpectedVersion: number;   // version of the original's `from` provider (now the inverse `to`)
    note: string;
  }): Promise<Transfer>;

  byId(transferId: TransferIdT): Promise<Transfer | null>;

  /**
   * Most recent N transfers for a persona, newest first. Compensating
   * rows appear in the same list as forward rows — callers that want
   * to highlight "already reversed" pairs should compare each row's
   * `reversesTransferId` against the rest of the page.
   */
  recent(personaId: string, limit: number): Promise<Transfer[]>;
}

export class TransferConflictError extends Error {
  constructor(public readonly transferId: TransferIdT) {
    super(`transfer conflict for ${transferId}: optimistic version was stale`);
    this.name = "TransferConflictError";
  }
}

export class TransferNotFoundError extends Error {
  constructor(public readonly transferId: TransferIdT) {
    super(`transfer not found: ${transferId}`);
    this.name = "TransferNotFoundError";
  }
}

export class TransferAlreadyReversedError extends Error {
  constructor(
    public readonly originalTransferId: TransferIdT,
    public readonly compensatingTransferId: TransferIdT,
  ) {
    super(
      `transfer ${originalTransferId} is already reversed by ${compensatingTransferId}`,
    );
    this.name = "TransferAlreadyReversedError";
  }
}