/**
 * @/__tests__/migratedDb.ts — fresh in-memory DB with the new schema applied.
 *
 * Phase 2 test helper. Spins up an isolated SQLite, runs every
 * `migrations/*.sql` file via the production `migrate()` runner, and seeds
 * a single persona so the balance/transfer/advisory tests have a target.
 */
import path from "node:path";
import Database, { type Database as DB } from "better-sqlite3";
import { migrate } from "@/lib/infrastructure/migrate";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "src/lib/infrastructure/migrations");

export interface Seeded {
  readonly db: DB;
  readonly personaId: string;
}

export function freshMigratedDb(): Seeded {
  const db = new Database(":memory:");
  // Pragmas match 001_init.sql + db.ts for honest surface-area testing.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db, MIGRATIONS_DIR);

  const personaId = "persona-test";
  db.prepare(
    `INSERT INTO personas
       (id, display_name, opening_bkash, opening_nagad, opening_rocket,
        inflow_rate, volatility)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    personaId,
    "Test Persona",
    50_000,  // opening bkash in paise (500 BDT)
    20_000,  // opening nagad (200 BDT)
    10_000,  // opening rocket (100 BDT)
    1.0,
    0.10,
  );

  db.prepare(
    `INSERT INTO provider_balance
       (persona_id, provider_id, balance, version_id, updated_at)
     VALUES (?, 'bkash',  ?, 1, ?),
            (?, 'nagad',  ?, 1, ?),
            (?, 'rocket', ?, 1, ?)`,
  ).run(
    personaId, 50_000, Date.now(),
    personaId, 20_000, Date.now(),
    personaId, 10_000, Date.now(),
  );

  db.prepare(
    `INSERT INTO balance_entries (persona_id, provider_id, balance, source, ts)
     VALUES (?, 'bkash',  ?, 'seed', ?),
            (?, 'nagad',  ?, 'seed', ?),
            (?, 'rocket', ?, 'seed', ?)`,
  ).run(
    personaId, 50_000, Date.now(),
    personaId, 20_000, Date.now(),
    personaId, 10_000, Date.now(),
  );

  return { db, personaId };
}
