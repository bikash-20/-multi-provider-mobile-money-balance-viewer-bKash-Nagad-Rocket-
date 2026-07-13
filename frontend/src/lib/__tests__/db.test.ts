/**
 * db.test.ts — verifies the persistence singleton:
 *  - schema is provisioned by the migration runner (idempotent)
 *  - WAL mode actually sticks (not silently regressed to journal)
 *  - CHECK constraints reject out-of-allowlist providers + negative
 *    balances on the v2 schema
 */
import { describe, it, expect, beforeEach } from "vitest";

import { closeDb, getDb } from "@/lib/db";
import { withTempDb } from "@/__tests__/withTempDb";

const PERSONA = "freelancer";

/** Seed the minimum v2 rows so `balance_entries` can accept an
 *  insert (the FK requires a parent row in `personas`). */
function seedPersona(db: ReturnType<typeof getDb>) {
  db.prepare(
    `INSERT INTO personas
       (id, display_name, opening_bkash, opening_nagad, opening_rocket,
        inflow_rate, volatility)
     VALUES (?, ?, 8500, 4200, 24000, 1.0, 0.10)`,
  ).run(PERSONA, "Freelancer");
}

describe("lib/db", () => {
  beforeEach(() => {
    closeDb();
  });

  it("opens the database and applies WAL + foreign_keys pragmas", async () => {
    await withTempDb(() => {
      const db = getDb();
      const journal = db.pragma("journal_mode", { simple: true }) as string;
      const fk = db.pragma("foreign_keys", { simple: true }) as number;
      expect(journal.toLowerCase()).toBe("wal");
      expect(fk).toBe(1);
    });
  });

  it("provisions the v2 schema and is idempotent on re-open", async () => {
    await withTempDb(() => {
      const first = getDb();
      seedPersona(first);
      first
        .prepare(
          `INSERT INTO balance_entries
             (persona_id, provider_id, balance, source, transfer_id, ts)
           VALUES (?, 'bkash', 100, 'manual', NULL, ?)`,
        )
        .run(PERSONA, Date.parse("2025-01-01T00:00:00Z"));

      // Force a clean re-open. The file on disk must already have the
      // schema; the migration runner must not throw or duplicate.
      closeDb();
      const second = getDb();
      const row = second
        .prepare(
          `SELECT id, persona_id, provider_id FROM balance_entries
             WHERE persona_id = ?`,
        )
        .get(PERSONA) as
        | { id: number; persona_id: string; provider_id: string }
        | undefined;
      expect(row?.persona_id).toBe(PERSONA);
      expect(row?.provider_id).toBe("bkash");
    });
  });

  it("rejects an INSERT whose provider is outside the allowlist", async () => {
    await withTempDb(() => {
      const db = getDb();
      seedPersona(db);
      expect(() =>
        db
          .prepare(
            `INSERT INTO balance_entries
               (persona_id, provider_id, balance, source, transfer_id, ts)
             VALUES (?, 'paypal', 50, 'manual', NULL, ?)`,
          )
          .run(PERSONA, Date.parse("2025-01-01T00:00:00Z")),
      ).toThrow(/CHECK constraint/i);
    });
  });

  it("rejects an INSERT whose balance is negative", async () => {
    await withTempDb(() => {
      const db = getDb();
      seedPersona(db);
      expect(() =>
        db
          .prepare(
            `INSERT INTO balance_entries
               (persona_id, provider_id, balance, source, transfer_id, ts)
             VALUES (?, 'rocket', -1, 'manual', NULL, ?)`,
          )
          .run(PERSONA, Date.parse("2025-01-01T00:00:00Z")),
      ).toThrow(/CHECK constraint/i);
    });
  });

  it("caches the connection on subsequent getDb() calls", async () => {
    await withTempDb(() => {
      const a = getDb();
      const b = getDb();
      // Same native binding, not a fresh file handle.
      expect(a).toBe(b);
    });
  });
});
