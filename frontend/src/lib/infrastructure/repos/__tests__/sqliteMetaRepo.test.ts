/**
 * SqliteMetaRepo — v1-binding tests for the demo-metadata KV table.
 *
 * Mirrors the contract exercised by the old `metaRepo` facade unit tests:
 *  - readSnapshot() returns all-null snapshot when the meta table is missing
 *    (defensive: the API route must never crash on a cold start)
 *  - isDemo=true surfaces when seed.demo='true'
 *  - unknown persona values fall back to null
 *  - all three valid persona names (freelancer / small_business / student)
 *    round-trip cleanly
 */
import { describe, it, expect, beforeEach } from "vitest";

import { closeDb, getDb } from "@/lib/db";
import { SqliteMetaRepo } from "@/lib/infrastructure/repos/sqliteMetaRepo";
import { withTempDb } from "@/__tests__/withTempDb";

describe("SqliteMetaRepo.readSnapshot", () => {
  beforeEach(() => {
    closeDb();
  });

  it("returns all-null fields with isDemo=false when the meta table is missing", async () => {
    // withTempDb points the singleton at a fresh tempfile; `getDb()`'s
    // inline initSchema creates `balance_entries` only — `meta` does NOT
    // exist. readSnapshot() must return the empty snapshot rather than
    // throw, so a cold-start API read never 500s.
    await withTempDb(async () => {
      const snap = await new SqliteMetaRepo(getDb()).readSnapshot();
      expect(snap).toEqual({
        isDemo: false,
        persona: null,
        label: null,
        description: null,
        generatedAt: null,
      });
    });
  });

  it("surfaces isDemo=true when seed.demo='true' is present", async () => {
    await withTempDb(async () => {
      const db = getDb();
      const repo = new SqliteMetaRepo(db);
      await repo.ensureSchema();
      const ins = db.prepare(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
      );
      ins.run("seed.demo", "true");
      ins.run("seed.persona", "student");
      ins.run("seed.label", "Student");
      ins.run("seed.description", "Test desc");
      ins.run("seed.generated_at", "2024-06-15T10:00:00.000Z");

      const snap = await repo.readSnapshot();
      expect(snap.isDemo).toBe(true);
      expect(snap.persona).toBe("student");
      expect(snap.label).toBe("Student");
      expect(snap.description).toBe("Test desc");
      expect(snap.generatedAt).toBe("2024-06-15T10:00:00.000Z");
    });
  });

  it("falls back to null persona when an unknown value is stored", async () => {
    await withTempDb(async () => {
      const db = getDb();
      const repo = new SqliteMetaRepo(db);
      await repo.ensureSchema();
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
        "seed.persona",
        "vampire" /* not a known persona */,
      );

      const snap = await repo.readSnapshot();
      expect(snap.persona).toBeNull();
    });
  });

  it("recognizes all three valid persona names", async () => {
    for (const persona of ["freelancer", "small_business", "student"] as const) {
      await withTempDb(async () => {
        const db = getDb();
        const repo = new SqliteMetaRepo(db);
        await repo.ensureSchema();
        db.prepare(
          "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
        ).run("seed.persona", persona);

        const snap = await repo.readSnapshot();
        expect(snap.persona).toBe(persona);
      });
    }
  });
});
