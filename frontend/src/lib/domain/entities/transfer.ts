/**
 * lib/domain/entities/transfer.ts — a committed cross-provider move.
 *
 * Captures both the canonical fields (id, persona, providers, amount,
 * timestamp) and the optimistic-lock proofs (from_version/to_version
 * and from_after/to_after). The CHECK constraints in 001_init.sql enforce
 * `from_delta = -amount` and `to_delta = +amount`; this entity mirrors
 * those invariants at the type level so callers don't need to remember.
 *
 * Phase 8: a transfer can be a reversal of an earlier one — when
 * `reversesTransferId` is non-null it points at the row this entry
 * undoes. The compensation is stored as a NEW row (never as an UPDATE
 * or DELETE) so the append-only ledger invariant is preserved.
 */
import type { Paise } from "../money";
import type { ProviderId } from "../providerId";
import type { TransferIdT } from "../transferId";

export interface Transfer {
  readonly transferId: TransferIdT;
  readonly personaId: string;
  readonly fromProvider: ProviderId;
  readonly toProvider: ProviderId;
  readonly amountBdt: Paise;
  readonly fromDelta: Paise; // negative
  readonly toDelta: Paise;   // positive
  readonly fromAfter: Paise;
  readonly fromVersion: number;
  readonly toAfter: Paise;
  readonly toVersion: number;
  readonly note: string;
  readonly ts: number;
  /**
   * When this row is a compensating reversal, the transferId of the
   * original it undoes. Null for the common case (a forward move).
   * Read-only — only `commitReverse` sets it.
   */
  readonly reversesTransferId: TransferIdT | null;
}

export function transferFromRow(row: {
  transfer_id: string;
  persona_id: string;
  from_provider: ProviderId;
  to_provider: ProviderId;
  amount_bdt: number;
  from_delta: number;
  to_delta: number;
  from_after: number;
  from_version: number;
  to_after: number;
  to_version: number;
  note: string;
  ts: number;
  reverses_transfer_id: string | null;
}): Transfer {
  return Object.freeze({
    transferId: row.transfer_id as TransferIdT,
    personaId: row.persona_id,
    fromProvider: row.from_provider,
    toProvider: row.to_provider,
    amountBdt: row.amount_bdt as Paise,
    fromDelta: row.from_delta as Paise,
    toDelta: row.to_delta as Paise,
    fromAfter: row.from_after as Paise,
    fromVersion: row.from_version,
    toAfter: row.to_after as Paise,
    toVersion: row.to_version,
    note: row.note,
    ts: row.ts,
    reversesTransferId: (row.reverses_transfer_id ?? null) as
      | TransferIdT
      | null,
  });
}