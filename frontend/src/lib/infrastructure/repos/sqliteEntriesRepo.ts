/**
 * lib/infrastructure/repos/sqliteEntriesRepo.ts — SQLite binding for the
 * `EntriesRepo` port.
 *
 * Targets the v1 `balance_entries` schema as defined in `lib/db.ts`:
 *
 *   CREATE TABLE balance_entries (
 *     id        TEXT PRIMARY KEY,
 *     provider  TEXT NOT NULL CHECK (provider IN ('bkash','nagad','rocket')),
 *     balance   REAL NOT NULL CHECK (balance >= 0),
 *     timestamp TEXT NOT NULL
 *   );
 *
 * The v1 schema is the one currently shipping — Phase 4 will fold this into
 * the v2 `BalanceRepo` adapter (provider_balance snapshot + balance_entries
 * ledger) but for Phase 3 the goal is purely to move the call site through
 * the port without changing externally-visible behavior.
 */
import type { Database as DB } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { EntriesRepo } from "@/lib/domain/repositories/entriesRepo";
import type { BalanceEntry, Provider } from "@/features/wallet/types";

interface Row {
  id: string;
  provider: Provider;
  balance: number;
  timestamp: string;
}

function rowToEntry(row: Row): BalanceEntry {
  return {
    id: row.id,
    provider: row.provider,
    balance: row.balance,
    timestamp: row.timestamp,
  };
}

export class SqliteEntriesRepo implements EntriesRepo {
  constructor(private readonly db: DB) {}

  listEntries(): Promise<BalanceEntry[]> {
    const rows = this.db
      .prepare<[], Row>(
        `SELECT id, provider, balance, timestamp
         FROM balance_entries
         ORDER BY timestamp DESC, id DESC`,
      )
      .all();
    return Promise.resolve(rows.map(rowToEntry));
  }

  appendEntry(provider: Provider, balance: number): Promise<BalanceEntry> {
    const entry: BalanceEntry = {
      id: randomUUID(),
      provider,
      balance,
      timestamp: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO balance_entries (id, provider, balance, timestamp)
         VALUES (@id, @provider, @balance, @timestamp)`,
      )
      .run(entry);
    return Promise.resolve(entry);
  }
}
