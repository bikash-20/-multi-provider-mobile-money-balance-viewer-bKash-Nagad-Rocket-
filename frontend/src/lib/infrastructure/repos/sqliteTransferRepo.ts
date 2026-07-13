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
 */
import type { Database as DB } from "better-sqlite3";
import { withTransaction } from "@/lib/infrastructure/transaction";
import type { TransferRepo, } from "@/lib/domain/repositories/transferRepo";
import { TransferConflictError } from "@/lib/domain/repositories/transferRepo";
import { transferFromRow } from "@/lib/domain/entities/transfer";
import type { Paise } from "@/lib/domain/money";
import type { ProviderId } from "@/lib/domain/providerId";
import type { TransferIdT } from "@/lib/domain/transferId";

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
}

interface BalanceRow {
  persona_id: string;
  provider_id: ProviderId;
  balance: number;
  version_id: number;
  updated_at: number;
}

export class SqliteTransferRepo implements TransferRepo {
  constructor(private readonly db: DB) {}

  byId(transferId: TransferIdT) {
    const row = this.db
      .prepare<[string], TransferRow>(
        `SELECT transfer_id, persona_id, from_provider, to_provider,
                amount_bdt, from_delta, to_delta,
                from_after, from_version, to_after, to_version,
                note, ts
         FROM transfers WHERE transfer_id = ?`,
      )
      .get(transferId as string);
    return Promise.resolve(row ? transferFromRow(row) : null);
  }

  recent(personaId: string, limit: number) {
    const rows = this.db
      .prepare<[string, number], TransferRow>(
        `SELECT transfer_id, persona_id, from_provider, to_provider,
                amount_bdt, from_delta, to_delta,
                from_after, from_version, to_after, to_version,
                note, ts
         FROM transfers
         WHERE persona_id = ?
         ORDER BY ts DESC, transfer_id DESC
         LIMIT ?`,
      )
      .all(personaId, limit);
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
              `SELECT transfer_id, persona_id, from_provider, to_provider,
                      amount_bdt, from_delta, to_delta,
                      from_after, from_version, to_after, to_version,
                      note, ts
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
                  note, ts)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            `SELECT transfer_id, persona_id, from_provider, to_provider,
                    amount_bdt, from_delta, to_delta,
                    from_after, from_version, to_after, to_version,
                    note, ts
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
}
