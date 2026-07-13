/**
 * lib/infrastructure/repos/sqliteTransferRepo.ts — sqlite binding for
 * `TransferRepo`. Atomic 4-row write: optimistic-lock both balances,
 * INSERT the transfer row, append the matching wallet_events row — all
 * inside one `withTransaction` so observers see either a fully-applied
 * move or no move at all.
 *
 * Replay safety: `transferId` is the PRIMARY KEY, so a retry with the
 * same id is a unique-constraint no-op. We catch `SQLITE_CONSTRAINT`
 * and return the previously persisted row so callers see the *result*
 * of their operation, not a 500.
 *
 * Phase 8: `commitReverse` adds a second atomic shape — it inserts a
 * compensating transfers row (with from/to swapped) and links it to the
 * original via `reverses_transfer_id`. The compensating row's PK is a
 * freshly-generated transferId, so retry-safety on the original path
 * (commit) does not collide with reverse idempotency.
 */
import type { Database as DB } from "better-sqlite3";
import { withTransaction } from "@/lib/infrastructure/transaction";
import type { TransferRepo, } from "@/lib/domain/repositories/transferRepo";
import {
  TransferConflictError,
  TransferNotFoundError,
  TransferAlreadyReversedError,
} from "@/lib/domain/repositories/transferRepo";
import { transferFromRow } from "@/lib/domain/entities/transfer";
import type { Paise } from "@/lib/domain/money";
import type { ProviderId } from "@/lib/domain/providerId";
import type { TransferIdT } from "@/lib/domain/transferId";
import { newTransferId } from "@/lib/domain/transferId";

interface TransferRow {
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
}

interface BalanceRow {
  persona_id: string;
  provider_id: ProviderId;
  balance: number;
  version_id: number;
  updated_at: number;
}

// Column list shared by every SELECT that hydrates a TransferRow. Keep
// in sync with the TransferRow interface above; if you add a column to
// transfers you almost certainly want it in both places.
const TRANSFER_COLUMNS = `
  transfer_id, persona_id, from_provider, to_provider,
  amount_bdt, from_delta, to_delta,
  from_after, from_version, to_after, to_version,
  note, ts, reverses_transfer_id
`;

export class SqliteTransferRepo implements TransferRepo {
  constructor(private readonly db: DB) {}

  byId(transferId: TransferIdT) {
    const row = this.db
      .prepare<[string], TransferRow>(
        `SELECT ${TRANSFER_COLUMNS}
         FROM transfers WHERE transfer_id = ?`,
      )
      .get(transferId as string);
    return Promise.resolve(row ? transferFromRow(row) : null);
  }

  recent(personaId: string, limit: number) {
    return this.recentPage(personaId, { limit });
  }

  recentPage(
    personaId: string,
    opts: { limit: number; before?: { ts: number; id: TransferIdT } },
  ) {
    if (opts.before) {
      // Keyset page: rows strictly older than the cursor. The
      // composite (`ts`, `transfer_id`) tuple comparison is stable
      // because `transfer_id` is UUIDv7, so two rows that share a ms
      // timestamp are still ordered deterministically.
      const rows = this.db
        .prepare<
          [string, number, string, number],
          TransferRow
        >(
          `SELECT ${TRANSFER_COLUMNS}
           FROM transfers
           WHERE persona_id = ?
             AND (ts, transfer_id) < (?, ?)
           ORDER BY ts DESC, transfer_id DESC
           LIMIT ?`,
        )
        .all(
          personaId,
          opts.before.ts,
          opts.before.id as string,
          opts.limit,
        );
      return Promise.resolve(rows.map(transferFromRow));
    }
    const rows = this.db
      .prepare<[string, number], TransferRow>(
        `SELECT ${TRANSFER_COLUMNS}
         FROM transfers
         WHERE persona_id = ?
         ORDER BY ts DESC, transfer_id DESC
         LIMIT ?`,
      )
      .all(personaId, opts.limit);
    return Promise.resolve(rows.map(transferFromRow));
  }

  async commit(args: {
    transferId: TransferIdT;
    personaId: string;
    fromProvider: ProviderId;
    toProvider: ProviderId;
    amountBdt: Paise;
    fromExpectedVersion: number;
    toExpectedVersion: number;
    note: string;
  }) {
    const amountAbs = args.amountBdt as number;
    try {
      return Promise.resolve(
        withTransaction(this.db, () => {
          // Replay path — return prior row if transferId already committed.
          const existing = this.db
            .prepare<[string], TransferRow>(
              `SELECT ${TRANSFER_COLUMNS}
               FROM transfers WHERE transfer_id = ?`,
            )
            .get(args.transferId as string);
          if (existing) return transferFromRow(existing);

          // Apply source delta (negative).
          const fromInfo = this.db
            .prepare(
              `UPDATE provider_balance
               SET balance    = balance - ?,
                   version_id = version_id + 1,
                   updated_at = ?
               WHERE persona_id  = ?
                 AND provider_id = ?
                 AND version_id  = ?`,
            )
            .run(amountAbs, Date.now(), args.personaId,
                 args.fromProvider, args.fromExpectedVersion);
          if (fromInfo.changes !== 1) {
            throw new TransferConflictError(args.transferId);
          }

          // Apply target delta (positive).
          const toInfo = this.db
            .prepare(
              `UPDATE provider_balance
               SET balance    = balance + ?,
                   version_id = version_id + 1,
                   updated_at = ?
               WHERE persona_id  = ?
                 AND provider_id = ?
                 AND version_id  = ?`,
            )
            .run(amountAbs, Date.now(), args.personaId,
                 args.toProvider, args.toExpectedVersion);
          if (toInfo.changes !== 1) {
            throw new TransferConflictError(args.transferId);
          }

          // Read post-commit balances for the transfer row.
          const fromRow = this.db
            .prepare<[string, ProviderId], BalanceRow>(
              `SELECT persona_id, provider_id, balance, version_id, updated_at
               FROM provider_balance
               WHERE persona_id = ? AND provider_id = ?`,
            )
            .get(args.personaId, args.fromProvider)!;
          const toRow = this.db
            .prepare<[string, ProviderId], BalanceRow>(
              `SELECT persona_id, provider_id, balance, version_id, updated_at
               FROM provider_balance
               WHERE persona_id = ? AND provider_id = ?`,
            )
            .get(args.personaId, args.toProvider)!;
          const ts = Date.now();

          // Append the canonical double-entry row. CHECK constraints in
          // 001_init.sql enforce from_delta = -amount and to_delta = +amount.
          this.db
            .prepare(
              `INSERT INTO transfers
                 (transfer_id, persona_id, from_provider, to_provider,
                  amount_bdt, from_delta, to_delta,
                  from_after, from_version, to_after, to_version,
                  note, ts, reverses_transfer_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            )
            .run(
              args.transferId as string,
              args.personaId,
              args.fromProvider,
              args.toProvider,
              amountAbs,
              -amountAbs,
              amountAbs,
              fromRow.balance,
              fromRow.version_id,
              toRow.balance,
              toRow.version_id,
              args.note,
              ts,
            );

          // Append per-leg history rows + the SSE event.
          this.db
            .prepare(
              `INSERT INTO balance_entries
                 (persona_id, provider_id, balance, source, transfer_id, ts)
               VALUES (?, ?, ?, 'transfer', ?, ?),
                      (?, ?, ?, 'transfer', ?, ?)`,
            )
            .run(
              args.personaId, args.fromProvider, fromRow.balance,
              args.transferId as string, ts,
              args.personaId, args.toProvider, toRow.balance,
              args.transferId as string, ts,
            );

          this.db
            .prepare(
              `INSERT INTO wallet_events
                 (persona_id, event_type, provider_id, payload, ts)
               VALUES (?, 'transfer.committed', ?, ?, ?)`,
            )
            .run(
              args.personaId,
              args.fromProvider,
              JSON.stringify({
                transferId: args.transferId,
                fromProvider: args.fromProvider,
                toProvider: args.toProvider,
                amountBdt: amountAbs,
                fromAfter: fromRow.balance,
                toAfter: toRow.balance,
              }),
              ts,
            );

          // Return shape consistent with from-row hydration.
          return transferFromRow({
            transfer_id: args.transferId as string,
            persona_id: args.personaId,
            from_provider: args.fromProvider,
            to_provider: args.toProvider,
            amount_bdt: amountAbs,
            from_delta: -amountAbs,
            to_delta: amountAbs,
            from_after: fromRow.balance,
            from_version: fromRow.version_id,
            to_after: toRow.balance,
            to_version: toRow.version_id,
            note: args.note,
            ts,
            reverses_transfer_id: null,
          });
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE constraint failed: transfers.transfer_id")) {
        // Race lost — fetch the winning row synchronously. Should never
        // be null here because the UNIQUE constraint only fires AFTER
        // another writer has already inserted a row.
        const row = this.db
          .prepare<[string], TransferRow>(
            `SELECT ${TRANSFER_COLUMNS}
             FROM transfers WHERE transfer_id = ?`,
          )
          .get(args.transferId as string);
        if (!row) throw new TransferConflictError(args.transferId);
        return Promise.resolve(transferFromRow(row));
      }
      if (msg.includes("constraint")) {
        // CHECK(balance>=0) on provider_balance tripped.
        throw new TransferConflictError(args.transferId);
      }
      throw e;
    }
  }

  /**
   * Compensating transfer: append a NEW transfers row whose from/to are
   * swapped and whose `reverses_transfer_id` points at the original.
   * The expectedVersion fields refer to the CURRENT provider_balance
   * rows (not the originals), so a concurrent writer still fails with
   * TransferConflictError.
   *
   * Idempotency note: we deliberately do NOT make `commitReverse`
   * replay-safe on `originalTransferId`. A retry of the same original
   * is rejected with TransferAlreadyReversedError so callers must
   * detect the duplicate via `byId(originalTransferId).reversesTransferId`
   * before retrying.
   */
  async commitReverse(args: {
    originalTransferId: TransferIdT;
    personaId: string;
    fromExpectedVersion: number; // version of the inverse `from` (= original's `to`)
    toExpectedVersion: number;   // version of the inverse `to`   (= original's `from`)
    note: string;
  }) {
    const compensatingId = newTransferId();
    try {
      return Promise.resolve(
        withTransaction(this.db, () => {
          // 1. Look up the original — throws NotFound if it does not exist.
          const original = this.db
            .prepare<[string], TransferRow>(
              `SELECT ${TRANSFER_COLUMNS}
               FROM transfers WHERE transfer_id = ?`,
            )
            .get(args.originalTransferId as string);
          if (!original) {
            throw new TransferNotFoundError(args.originalTransferId);
          }

          // 2. Already-reversed check. We surface the compensating id in
          //    the error so the route can echo it in the 409 body and
          //    the UI can offer "jump to it".
          const existingReverse = this.db
            .prepare<[string], { transfer_id: string }>(
              `SELECT transfer_id FROM transfers
               WHERE reverses_transfer_id = ? LIMIT 1`,
            )
            .get(args.originalTransferId as string);
          if (existingReverse) {
            throw new TransferAlreadyReversedError(
              args.originalTransferId,
              existingReverse.transfer_id as TransferIdT,
            );
          }

          // 3. The inverse leg's from-side is the original's to-side.
          //    Apply the negative delta first (matches the commit() order
          //    so CHECK(balance>=0) failures surface the same way).
          const inverseFrom = original.to_provider;
          const inverseTo = original.from_provider;
          const amountAbs = original.amount_bdt;

          const fromInfo = this.db
            .prepare(
              `UPDATE provider_balance
               SET balance    = balance - ?,
                   version_id = version_id + 1,
                   updated_at = ?
               WHERE persona_id  = ?
                 AND provider_id = ?
                 AND version_id  = ?`,
            )
            .run(amountAbs, Date.now(), original.persona_id,
                 inverseFrom, args.fromExpectedVersion);
          if (fromInfo.changes !== 1) {
            throw new TransferConflictError(args.originalTransferId);
          }

          const toInfo = this.db
            .prepare(
              `UPDATE provider_balance
               SET balance    = balance + ?,
                   version_id = version_id + 1,
                   updated_at = ?
               WHERE persona_id  = ?
                 AND provider_id = ?
                 AND version_id  = ?`,
            )
            .run(amountAbs, Date.now(), original.persona_id,
                 inverseTo, args.toExpectedVersion);
          if (toInfo.changes !== 1) {
            throw new TransferConflictError(args.originalTransferId);
          }

          // 4. Re-read post-update balances for the compensation row.
          const fromRow = this.db
            .prepare<[string, ProviderId], BalanceRow>(
              `SELECT persona_id, provider_id, balance, version_id, updated_at
               FROM provider_balance
               WHERE persona_id = ? AND provider_id = ?`,
            )
            .get(original.persona_id, inverseFrom)!;
          const toRow = this.db
            .prepare<[string, ProviderId], BalanceRow>(
              `SELECT persona_id, provider_id, balance, version_id, updated_at
               FROM provider_balance
               WHERE persona_id = ? AND provider_id = ?`,
            )
            .get(original.persona_id, inverseTo)!;
          const ts = Date.now();

          // 5. Persist the compensating row. The CHECK constraints in
          //    001_init.sql still hold (from_delta = -amount, to_delta =
          //    +amount, from_provider <> to_provider) because we wrote
          //    them as ordinary deltas on a new id.
          this.db
            .prepare(
              `INSERT INTO transfers
                 (transfer_id, persona_id, from_provider, to_provider,
                  amount_bdt, from_delta, to_delta,
                  from_after, from_version, to_after, to_version,
                  note, ts, reverses_transfer_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              compensatingId as string,
              original.persona_id,
              inverseFrom,
              inverseTo,
              amountAbs,
              -amountAbs,
              amountAbs,
              fromRow.balance,
              fromRow.version_id,
              toRow.balance,
              toRow.version_id,
              args.note,
              ts,
              args.originalTransferId as string,
            );

          // 6. Per-leg history + SSE event. The event_type is
          //    'transfer.reversed' so observers (SSE, advisory engine)
          //    can distinguish a compensation from a fresh forward move
          //    without parsing the payload.
          this.db
            .prepare(
              `INSERT INTO balance_entries
                 (persona_id, provider_id, balance, source, transfer_id, ts)
               VALUES (?, ?, ?, 'transfer', ?, ?),
                        (?, ?, ?, 'transfer', ?, ?)`,
            )
            .run(
              original.persona_id, inverseFrom, fromRow.balance,
              compensatingId as string, ts,
              original.persona_id, inverseTo, toRow.balance,
              compensatingId as string, ts,
            );

          this.db
            .prepare(
              `INSERT INTO wallet_events
                 (persona_id, event_type, provider_id, payload, ts)
               VALUES (?, 'transfer.reversed', ?, ?, ?)`,
            )
            .run(
              original.persona_id,
              inverseFrom,
              JSON.stringify({
                transferId: compensatingId,
                originalTransferId: args.originalTransferId,
                fromProvider: inverseFrom,
                toProvider: inverseTo,
                amountBdt: amountAbs,
                fromAfter: fromRow.balance,
                toAfter: toRow.balance,
              }),
              ts,
            );

          return transferFromRow({
            transfer_id: compensatingId as string,
            persona_id: original.persona_id,
            from_provider: inverseFrom,
            to_provider: inverseTo,
            amount_bdt: amountAbs,
            from_delta: -amountAbs,
            to_delta: amountAbs,
            from_after: fromRow.balance,
            from_version: fromRow.version_id,
            to_after: toRow.balance,
            to_version: toRow.version_id,
            note: args.note,
            ts,
            reverses_transfer_id: args.originalTransferId as string,
          });
        }),
      );
    } catch (e) {
      // Re-throw our own typed errors unchanged.
      if (
        e instanceof TransferConflictError ||
        e instanceof TransferNotFoundError ||
        e instanceof TransferAlreadyReversedError
      ) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("constraint")) {
        // CHECK(balance>=0) on provider_balance tripped — the inverse
        // leg wanted to debit a side that no longer has enough funds.
        throw new TransferConflictError(args.originalTransferId);
      }
      throw e;
    }
  }
}
