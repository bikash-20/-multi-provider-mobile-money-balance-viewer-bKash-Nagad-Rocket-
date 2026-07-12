/**
 * db.test.ts — verifies the persistence singleton:
 *  - schema creation is idempotent
 *  - WAL mode actually sticks (not silently regressed to journal)
 *  - CHECK constraints reject bad providers + negative balances
 */
import { describe, it, expect, beforeEach } from "vitest";

import { closeDb, getDb } from "@/lib/db";
import { withTempDb } from "@/__tests__/withTempDb";

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

  it("creates the balance_entries schema and is idempotent on re-open", async () => {
    await withTempDb(() => {
      const first = getDb();
      first
        .prepare(
          "INSERT INTO balance_entries (id, provider, balance, timestamp) VALUES (?, ?, ?, ?)",
        )
        .run("seed-1", "bkash", 100, "2025-01-01T00:00:00.000Z");

      // Force a clean re-open by closing the singleton. The file on disk
      // must already have the schema; open() should not throw or
      // re-create it (CREATE TABLE IF NOT EXISTS).
      closeDb();
      const second = getDb();
      const row = second
        .prepare("SELECT id FROM balance_entries WHERE id = ?")
        .get("seed-1") as { id: string } | undefined;
      expect(row?.id).toBe("seed-1");
    });
  });

  it("rejects an INSERT whose provider is outside the allowlist", async () => {
    await withTempDb(() => {
      const db = getDb();
      expect(() =>
        db
          .prepare(
            "INSERT INTO balance_entries (id, provider, balance, timestamp) VALUES (?, ?, ?, ?)",
          )
          .run("bad-1", "paypal", 50, "2025-01-01T00:00:00.000Z"),
      ).toThrow(/CHECK constraint/i);
    });
  });

  it("rejects an INSERT whose balance is negative", async () => {
    await withTempDb(() => {
      const db = getDb();
      expect(() =>
        db
          .prepare(
            "INSERT INTO balance_entries (id, provider, balance, timestamp) VALUES (?, ?, ?, ?)",
          )
          .run("bad-2", "rocket", -1, "2025-01-01T00:00:00.000Z"),
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
