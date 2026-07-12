/**
 * metaRepo.test.ts — exercises the meta-table repository.
 *
 * readMetaSnapshot() must always succeed (returning isDemo: false on a
 * missing DB) so the API route never crashes on a cold start. happy
 * path covers all five meta keys being read into the snapshot shape.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { closeDb } from "@/lib/db";
import { ensureMetaTable, readMetaSnapshot } from "@/lib/metaRepo";
import { withTempDb } from "@/__tests__/withTempDb";

function writeMeta(rows: Record<string, string>): void {
  const dbPath = process.env.WALLETSYNC_DB_PATH;
  if (!dbPath) throw new Error("WALLETSYNC_DB_PATH not set");
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  ensureMetaTable();
  const db = new Database(dbPath);
  try {
    const ins = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(rows)) ins.run(k, v);
  } finally {
    db.close();
  }
}

describe("readMetaSnapshot", () => {
  beforeEach(() => {
    closeDb();
  });

  it("returns all-null fields with isDemo=false when the DB file is missing", () => {
    // Point at a path that definitely does not exist yet.
    const tmpPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "walletsync-missing-")),
      "no-such.db",
    );
    process.env.WALLETSYNC_DB_PATH = tmpPath;
    try {
      const snap = readMetaSnapshot();
      expect(snap).toEqual({
        isDemo: false,
        persona: null,
        label: null,
        description: null,
        generatedAt: null,
      });
    } finally {
      delete process.env.WALLETSYNC_DB_PATH;
    }
  });

  it("surfaces isDemo=true when seed.demo='true' is present", async () => {
    await withTempDb(async () => {
      writeMeta({
        "seed.demo": "true",
        "seed.persona": "student",
        "seed.label": "Student",
        "seed.description": "Test desc",
        "seed.generated_at": "2024-06-15T10:00:00.000Z",
      });
      closeDb();
      const snap = readMetaSnapshot();
      expect(snap.isDemo).toBe(true);
      expect(snap.persona).toBe("student");
      expect(snap.label).toBe("Student");
      expect(snap.description).toBe("Test desc");
      expect(snap.generatedAt).toBe("2024-06-15T10:00:00.000Z");
    });
  });

  it("falls back to null persona when an unknown value is stored", async () => {
    await withTempDb(async () => {
      writeMeta({ "seed.persona": "vampire" /* not a known persona */ });
      closeDb();
      const snap = readMetaSnapshot();
      expect(snap.persona).toBeNull();
    });
  });

  it("recognizes all three valid persona names", async () => {
    for (const persona of ["freelancer", "small_business", "student"] as const) {
      await withTempDb(async () => {
        writeMeta({ "seed.persona": persona });
        closeDb();
        const snap = readMetaSnapshot();
        expect(snap.persona).toBe(persona);
      });
    }
  });
});