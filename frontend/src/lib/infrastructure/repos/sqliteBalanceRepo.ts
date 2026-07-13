/**
 * lib/infrastructure/repos/sqliteBalanceRepo.ts — sqlite binding for
 * `BalanceRepo`. Optimistic-lock UPDATE: if the row count drops to 0 it
 * means another writer raced us; the contract is to translate that into
 * `BalanceConflictError` so the application layer can retry with jittered
 * backoff (matching LiquiGuard's `_mutate`).
 *
 * CHECK constraints in 001_init.sql already protect balance >= 0; we map
 * a SQLITE_CONSTRAINT error to `InsufficientBalanceError` so the API
 * layer can surface 409 instead of leaking the SQL error.
 */
import type { Database as DB } from "better-sqlite3";
import type { BalanceRepo, } from "@/lib/domain/repositories/balanceRepo";
import {
  BalanceConflictError,
  InsufficientBalanceError,
} from "@/lib/domain/repositories/balanceRepo";
import { providerBalanceFromRow } from "@/lib/domain/entities/providerBalance";
import type { Paise } from "@/lib/domain/money";
import type { ProviderId } from "@/lib/domain/providerId";

interface BalanceRow {
  persona_id: string;
  provider_id: ProviderId;
  balance: number;
  version_id: number;
  updated_at: number;
}

export class SqliteBalanceRepo implements BalanceRepo {
  constructor(private readonly db: DB) {}

  get(personaId: string, providerId: ProviderId) {
    const row = this.db
      .prepare<[string, ProviderId], BalanceRow>(
        `SELECT persona_id, provider_id, balance, version_id, updated_at
         FROM provider_balance
         WHERE persona_id = ? AND provider_id = ?`,
      )
      .get(personaId, providerId);
    return Promise.resolve(row ? providerBalanceFromRow(row) : null);
  }

  listByPersona(personaId: string) {
    const rows = this.db
      .prepare<[string], BalanceRow>(
        `SELECT persona_id, provider_id, balance, version_id, updated_at
         FROM provider_balance
         WHERE persona_id = ?
         ORDER BY provider_id`,
      )
      .all(personaId);
    return Promise.resolve(rows.map(providerBalanceFromRow));
  }

  async applyDelta(args: {
    personaId: string;
    providerId: ProviderId;
    deltaBdt: Paise;
    expectedVersion: number;
  }) {
    const stmt = this.db.prepare(
      `UPDATE provider_balance
       SET balance     = balance + ?,
           version_id  = version_id + 1,
           updated_at  = ?
       WHERE persona_id  = ?
         AND provider_id = ?
         AND version_id  = ?`,
    );
    let info;
    try {
      info = stmt.run(
        args.deltaBdt as number,
        Date.now(),
        args.personaId,
        args.providerId,
        args.expectedVersion,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("constraint")) {
        throw new InsufficientBalanceError(args.personaId, args.providerId);
      }
      throw e;
    }
    if (info.changes !== 1) {
      throw new BalanceConflictError(args.personaId, args.providerId);
    }
    const row = this.db
      .prepare<[string, ProviderId], BalanceRow>(
        `SELECT persona_id, provider_id, balance, version_id, updated_at
         FROM provider_balance
         WHERE persona_id = ? AND provider_id = ?`,
      )
      .get(args.personaId, args.providerId)!;
    return Promise.resolve(providerBalanceFromRow(row));
  }
}