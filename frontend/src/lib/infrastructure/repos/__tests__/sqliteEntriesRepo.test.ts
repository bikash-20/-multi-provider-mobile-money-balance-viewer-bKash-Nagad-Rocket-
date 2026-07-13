/**
 * SqliteEntriesRepo — v2-binding tests for the BalanceEntry log.
 *
 * The v2 schema is multi-persona; the binding scopes reads/writes to
 * the persona marked active in `meta.active_persona`. These tests
 * exercise the public contract (`BalanceEntry = {id, provider, balance,
 * timestamp}`) while ensuring the v2 plumbing is wired correctly.
 *
 *   - empty table → empty list
 *   - newest-first ordering across providers
 *   - tie-break by id (DESC) when timestamps collide
 *   - appendEntry writes a numeric id (String of lastInsertRowid) + ISO
 *     timestamp and round-trips
 *   - appendEntry + listEntries preserve insertion order
 *   - appendEntry on a cold DB lazily creates the active persona
 */
import { describe, it, expect, beforeEach } from "vitest";

import { closeDb, getDb } from "@/lib/db";
import { SqliteEntriesRepo } from "@/lib/infrastructure/repos/sqliteEntriesRepo";
import { withTempDb } from "@/__tests__/withTempDb";

const PERSONA = "freelancer";

/** Seed the minimum v2 rows the binding expects: a persona + its
 *  current `provider_balance` rows. Used by tests that exercise the
 *  repo through the public appendEntry path. */
function seedPersona(db: ReturnType<typeof getDb>) {
  db.prepare(
    `INSERT OR IGNORE INTO personas
       (id, display_name, opening_bkash, opening_nagad, opening_rocket,
        inflow_rate, volatility)
     VALUES (?, ?, 8500, 4200, 24000, 1.0, 0.10)`,
  ).run(PERSONA, "Freelancer");
  for (const p of ["bkash", "nagad", "rocket"] as const) {
    db.prepare(
      `INSERT OR IGNORE INTO provider_balance
         (persona_id, provider_id, balance, version_id, updated_at)
       VALUES (?, ?, 0, 1, ?)`,
    ).run(PERSONA, p, Date.now());
  }
  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('active_persona', ?)",
  ).run(PERSONA);
}

/** Insert a single v2 balance_entries row directly. The persona id is
 *  hard-coded so the tests stay focused on ordering / id semantics. */
function insertRow(
  db: ReturnType<typeof getDb>,
  personaId: string,
  provider: "bkash" | "nagad" | "rocket",
  balance: number,
  tsMs: number,
): number {
  const r = db
    .prepare(
      `INSERT INTO balance_entries
         (persona_id, provider_id, balance, source, transfer_id, ts)
       VALUES (?, ?, ?, 'seed', NULL, ?)`,
    )
    .run(personaId, provider, balance, tsMs);
  return Number(r.lastInsertRowid);
}

describe("SqliteEntriesRepo", () => {
  beforeEach(() => {
    closeDb();
  });

  it("returns an empty list when the table is empty", async () => {
    await withTempDb(async () => {
      const db = getDb();
      seedPersona(db);
      const repo = new SqliteEntriesRepo(db);
      expect(await repo.listEntries()).toEqual([]);
    });
  });

  it("returns entries newest-first across providers", async () => {
    await withTempDb(async () => {
      const db = getDb();
      seedPersona(db);
      insertRow(db, PERSONA, "bkash", 100, Date.parse("2025-01-01T00:00:00Z"));
      insertRow(db, PERSONA, "rocket", 200, Date.parse("2025-01-02T00:00:00Z"));
      insertRow(db, PERSONA, "nagad", 300, Date.parse("2025-01-03T00:00:00Z"));

      const repo = new SqliteEntriesRepo(db);
      const result = await repo.listEntries();
      expect(result.map((e) => e.provider)).toEqual(["nagad", "rocket", "bkash"]);
      expect(result.map((e) => e.balance)).toEqual([300, 200, 100]);
    });
  });

  it("breaks timestamp ties deterministically by id (DESC)", async () => {
    await withTempDb(async () => {
      const db = getDb();
      seedPersona(db);
      const ts = Date.parse("2025-01-01T00:00:00Z");
      insertRow(db, PERSONA, "bkash", 10, ts);
      insertRow(db, PERSONA, "bkash", 11, ts);
      insertRow(db, PERSONA, "bkash", 12, ts);

      const repo = new SqliteEntriesRepo(db);
      const result = await repo.listEntries();
      // IDs are strings of lastInsertRowid; DESC sort by integer.
      expect(result.map((e) => Number(e.id))).toEqual([3, 2, 1]);
    });
  });

  it("appendEntry writes a numeric id + ISO timestamp and persists all fields", async () => {
    await withTempDb(async () => {
      const db = getDb();
      seedPersona(db);
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
      // Server-generated id is a numeric string.
      expect(entry.id).toMatch(/^\d+$/);
      // Timestamp is an ISO string bracketed by the wall-clock before/after.
      expect(entry.timestamp >= before).toBe(true);
      expect(entry.timestamp <= after).toBe(true);

      // Round-trip via the DB row (v2 schema).
      const row = db
        .prepare(
          `SELECT id, persona_id, provider_id, balance, ts
             FROM balance_entries WHERE id = ?`,
        )
        .get(Number(entry.id)) as
        | {
            id: number;
            persona_id: string;
            provider_id: string;
            balance: number;
            ts: number;
          }
        | undefined;
      expect(row).toEqual({
        id: Number(entry.id),
        persona_id: PERSONA,
        provider_id: "bkash",
        balance: 250,
        ts: new Date(entry.timestamp).getTime(),
      });

      // provider_balance also got updated + version_id bumped.
      const bal = db
        .prepare(
          `SELECT balance, version_id FROM provider_balance
             WHERE persona_id = ? AND provider_id = ?`,
        )
        .get(PERSONA, "bkash") as
        | { balance: number; version_id: number }
        | undefined;
      expect(bal).toEqual({ balance: 250, version_id: 2 });
    });
  });

  it("lazily creates the active persona on cold-start appendEntry", async () => {
    await withTempDb(async () => {
      const db = getDb();
      // No seedPersona call: this simulates an empty v2 DB.
      const repo = new SqliteEntriesRepo(db);
      const entry = await repo.appendEntry("bkash", 42);

      expect(entry.provider).toBe("bkash");
      expect(entry.balance).toBe(42);
      // A 'student' persona was created lazily.
      const p = db
        .prepare("SELECT id FROM personas WHERE id = ?")
        .get("student") as { id: string } | undefined;
      expect(p?.id).toBe("student");
      // And active_persona now points at it.
      const meta = db
        .prepare("SELECT value FROM meta WHERE key = 'active_persona'")
        .get() as { value: string } | undefined;
      expect(meta?.value).toBe("student");
    });
  });

  it("appendEntry + listEntries round-trip preserves order", async () => {
    await withTempDb(async () => {
      const db = getDb();
      seedPersona(db);
      const repo = new SqliteEntriesRepo(db);

      await repo.appendEntry("bkash", 100);
      // Sleep one ms so subsequent entries have strictly greater
      // timestamps; better-sqlite3 `Date.now()` is ms-precision and can
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
