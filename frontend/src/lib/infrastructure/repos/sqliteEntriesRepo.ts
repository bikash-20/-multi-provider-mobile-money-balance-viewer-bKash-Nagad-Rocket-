/**
 * SqliteEntriesRepo — v2-binding for the `EntriesRepo` port.
 *
 * The UI's contract is the v1 `BalanceEntry` shape ({id, provider, balance,
 * timestamp}); the persistence layer is now the v2 schema from
 * `migrations/001_init.sql` (`personas` + `provider_balance` + per-persona
 * `balance_entries`). This binding is the adapter that keeps the v1
 * response shape while writing to the v2 tables.
 *
 * Persona scoping:
 *  - The UI is persona-agnostic: the dashboard shows one active persona at
 *    a time and the URL/reducer doesn't carry a persona parameter. The
 *    active persona lives in `meta.active_persona`, set by seedDemo.
 *  - `listEntries` reads that key; on a cold start with no active persona
 *    we return `[]` (the seeder hasn't been run yet, so there's nothing to
 *    show). The dashboard surfaces this as "empty" rather than crashing.
 *  - `appendEntry` will lazily create a `student` persona + default
 *    provider_balance rows on a cold append, so the demo UI can be poked
 *    before the seeder runs and not 500.
 */
import type { Database as DB } from "better-sqlite3";
import { withTransaction } from "@/lib/infrastructure/transaction";
import type { EntriesRepo } from "@/lib/domain/repositories/entriesRepo";
import type {
  BalanceEntry,
  Provider,
} from "@/features/wallet/types";

interface V2Row {
  id: number;
  persona_id: string;
  provider_id: Provider;
  balance: number;
  source: string;
  transfer_id: string | null;
  ts: number;
}

const DEFAULT_PERSONA = "student";
const DEFAULT_PROVIDERS: Provider[] = ["bkash", "nagad", "rocket"];
const DEFAULT_OPENING: Record<Provider, number> = {
  bkash: 1800,
  nagad: 950,
  rocket: 350,
};

/** Read the active persona id from `meta.active_persona`, or null. */
function readActivePersona(db: DB): string | null {
  // meta may not exist on a pre-migration dev DB that someone opened
  // without running the migrations; guard with try/catch.
  try {
    const row = db
      .prepare<[], { value: string }>(
        "SELECT value FROM meta WHERE key = 'active_persona'",
      )
      .get();
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/** Ensure the active persona exists in `personas` + `provider_balance`. */
function ensurePersona(db: DB, personaId: string): void {
  const existing = db
    .prepare<[string], { id: string }>("SELECT id FROM personas WHERE id = ?")
    .get(personaId);
  if (existing) return;
  db.prepare(
    `INSERT INTO personas
       (id, display_name, opening_bkash, opening_nagad, opening_rocket,
        inflow_rate, volatility)
     VALUES (?, ?, ?, ?, ?, 1.0, 0.10)`,
  ).run(
    personaId,
    personaId,
    DEFAULT_OPENING.bkash,
    DEFAULT_OPENING.nagad,
    DEFAULT_OPENING.rocket,
  );
  const now = Date.now();
  const ins = db.prepare(
    `INSERT INTO provider_balance
       (persona_id, provider_id, balance, version_id, updated_at)
     VALUES (?, ?, ?, 1, ?)`,
  );
  for (const p of DEFAULT_PROVIDERS) {
    ins.run(personaId, p, DEFAULT_OPENING[p], now);
  }
}

function hydrate(row: V2Row): BalanceEntry {
  return Object.freeze({
    // Stringify the autoincrement id so the v1 UI contract (id: string)
    // holds. UI never parses it as a number; it just uses it as a key.
    id: String(row.id),
    provider: row.provider_id,
    balance: row.balance,
    timestamp: new Date(row.ts).toISOString(),
  });
}

export class SqliteEntriesRepo implements EntriesRepo {
  constructor(private readonly db: DB) {}

  listEntries(): Promise<BalanceEntry[]> {
    const personaId = readActivePersona(this.db);
    if (!personaId) return Promise.resolve([]);
    const rows = this.db
      .prepare<[string], V2Row>(
        `SELECT id, persona_id, provider_id, balance, source, transfer_id, ts
         FROM balance_entries
         WHERE persona_id = ?
         ORDER BY ts DESC, id DESC`,
      )
      .all(personaId);
    return Promise.resolve(rows.map(hydrate));
  }

  appendEntry(provider: Provider, balance: number): Promise<BalanceEntry> {
    // Cold-start append: lazily create the default persona + balances.
    let personaId = readActivePersona(this.db);
    if (!personaId) {
      personaId = DEFAULT_PERSONA;
      ensurePersona(this.db, personaId);
      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
        .run("active_persona", personaId);
    }

    // Read current version + balance for the optimistic lock. If the row
    // is missing (persona exists but no provider_balance row), seed it
    // with the same default-opening value used by the seeder.
    const cur = this.db
      .prepare<
        [string, Provider],
        { balance: number; version_id: number }
      >(
        `SELECT balance, version_id FROM provider_balance
         WHERE persona_id = ? AND provider_id = ?`,
      )
      .get(personaId, provider);
    if (!cur) {
      this.db
        .prepare(
          `INSERT INTO provider_balance
             (persona_id, provider_id, balance, version_id, updated_at)
           VALUES (?, ?, ?, 1, ?)`,
        )
        .run(personaId, provider, balance, Date.now());
    }

    const ts = Date.now();
    const result = withTransaction(this.db, () => {
      // Re-read inside the transaction to close the read/write gap.
      const fresh = this.db
        .prepare<
          [string, Provider],
          { balance: number; version_id: number }
        >(
          `SELECT balance, version_id FROM provider_balance
           WHERE persona_id = ? AND provider_id = ?`,
        )
        .get(personaId!, provider)!;
      const upd = this.db
        .prepare(
          `UPDATE provider_balance
           SET balance    = ?,
               version_id = version_id + 1,
               updated_at = ?
           WHERE persona_id  = ?
             AND provider_id = ?
             AND version_id  = ?`,
        )
        .run(balance, ts, personaId!, provider, fresh.version_id);
      if (upd.changes !== 1) {
        // Someone else wrote in between; the v1 contract has no
        // conflict-recovery surface, so we surface a generic error and
        // let the client retry. (Future Phase 5: a BalanceConflictError
        // + jittered retry, mirroring LiquiGuard.)
        throw new Error(
          `balance write conflict for ${personaId}/${provider}; retry`,
        );
      }
      const ins = this.db
        .prepare(
          `INSERT INTO balance_entries
             (persona_id, provider_id, balance, source, transfer_id, ts)
           VALUES (?, ?, ?, 'manual', NULL, ?)`,
        )
        .run(personaId!, provider, balance, ts);
      const id = Number(ins.lastInsertRowid);
      return hydrate({
        id,
        persona_id: personaId!,
        provider_id: provider,
        balance,
        source: "manual",
        transfer_id: null,
        ts,
      });
    });
    return Promise.resolve(result);
  }
}
