/**
 * SqliteEntriesRepo — v1-binding tests for the BalanceEntry log.
 *
 * Mirrors the contract exercised by the old `entriesRepo` facade unit tests:
 *  - empty table → empty list
 *  - newest-first ordering across providers
 *  - tie-break by id (DESC) when timestamps collide
 *  - appendEntry writes a UUID + ISO timestamp and round-trips
 *  - appendEntry + listEntries preserve insertion order across multiple writes
 */
import { describe, it, expect, beforeEach } from "vitest";

import { closeDb, getDb } from "@/lib/db";
import { SqliteEntriesRepo } from "@/lib/infrastructure/repos/sqliteEntriesRepo";
import { withTempDb } from "@/__tests__/withTempDb";

describe("SqliteEntriesRepo", () => {
  beforeEach(() => {
    closeDb();
  });

  it("returns an empty list when the table is empty", async () => {
    await withTempDb(async () => {
      const repo = new SqliteEntriesRepo(getDb());
      expect(await repo.listEntries()).toEqual([]);
    });
  });

  it("returns entries newest-first across providers", async () => {
    await withTempDb(async () => {
      const db = getDb();
      // Bypass appendEntry to control timestamps exactly; same shape as a
      // real import path.
      const insert = db.prepare(
        "INSERT INTO balance_entries (id, provider, balance, timestamp) VALUES (?, ?, ?, ?)",
      );
      insert.run("a", "bkash", 100, "2025-01-01T00:00:00.000Z");
      insert.run("b", "rocket", 200, "2025-01-02T00:00:00.000Z");
      insert.run("c", "nagad", 300, "2025-01-03T00:00:00.000Z");

      const repo = new SqliteEntriesRepo(db);
      const result = await repo.listEntries();
      expect(result.map((e) => e.provider)).toEqual(["nagad", "rocket", "bkash"]);
      expect(result.map((e) => e.balance)).toEqual([300, 200, 100]);
    });
  });

  it("breaks timestamp ties deterministically by id (DESC)", async () => {
    await withTempDb(async () => {
      const db = getDb();
      const insert = db.prepare(
        "INSERT INTO balance_entries (id, provider, balance, timestamp) VALUES (?, ?, ?, ?)",
      );
      const ts = "2025-01-01T00:00:00.000Z";
      insert.run("first", "bkash", 10, ts);
      insert.run("second", "bkash", 11, ts);
      insert.run("third", "bkash", 12, ts);

      const repo = new SqliteEntriesRepo(db);
      const result = await repo.listEntries();
      expect(result.map((e) => e.id)).toEqual(["third", "second", "first"]);
    });
  });

  it("appendEntry assigns a UUID + ISO timestamp and persists all fields", async () => {
    await withTempDb(async () => {
      const db = getDb();
      const repo = new SqliteEntriesRepo(db);

      const before = new Date().toISOString();
      const entry = await repo.appendEntry("bkash", 250);
      const after = new Date().toISOString();

      // Shape: {id, provider, balance, timestamp}
      expect(Object.keys(entry).sort()).toEqual(
        ["balance", "id", "provider", "timestamp"].sort(),
      );
      expect(entry.provider).toBe("bkash");
      expect(entry.balance).toBe(250);
      // Server-generated id looks like a v4 UUID.
      expect(entry.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      // Timestamp is an ISO string bracketed by the wall-clock before/after.
      expect(entry.timestamp >= before).toBe(true);
      expect(entry.timestamp <= after).toBe(true);

      // Round-trip via the DB row.
      const row = db
        .prepare(
          "SELECT id, provider, balance, timestamp FROM balance_entries WHERE id = ?",
        )
        .get(entry.id) as
        | { id: string; provider: string; balance: number; timestamp: string }
        | undefined;
      expect(row).toEqual({
        id: entry.id,
        provider: "bkash",
        balance: 250,
        timestamp: entry.timestamp,
      });
    });
  });

  it("appendEntry + listEntries round-trip preserves order", async () => {
    await withTempDb(async () => {
      const repo = new SqliteEntriesRepo(getDb());

      await repo.appendEntry("bkash", 100);
      // Sleep one ms so subsequent entries have strictly greater timestamps;
      // better-sqlite3 timestamps are millisecond-precision strings and can
      // collide on very fast machines.
      await new Promise((r) => setTimeout(r, 2));
      const a = await repo.appendEntry("nagad", 200);
      await new Promise((r) => setTimeout(r, 2));
      const b = await repo.appendEntry("rocket", 300);

      const all = await repo.listEntries();
      expect(all[0]?.id).toBe(b.id);
      expect(all[1]?.id).toBe(a.id);
    });
  });
});
