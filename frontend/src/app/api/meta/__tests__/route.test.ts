/**
 * /api/meta route — exposes the demo metadata row.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { closeDb } from "@/lib/db";
import { GET } from "@/app/api/meta/route";
import { withTempDb } from "@/__tests__/withTempDb";
import { ensureMetaTable } from "@/lib/metaRepo";

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

describe("/api/meta", () => {
  beforeEach(() => {
    closeDb();
  });

  it("returns 200 with all-null fields on a fresh database", async () => {
    await withTempDb(async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        isDemo: false,
        persona: null,
        label: null,
        description: null,
        generatedAt: null,
      });
    });
  });

  it("returns the snapshot when seed rows are present", async () => {
    await withTempDb(async () => {
      writeMeta({
        "seed.demo": "true",
        "seed.persona": "freelancer",
        "seed.label": "Freelancer",
        "seed.description": "Mixed inflows",
        "seed.generated_at": "2024-06-15T10:00:00.000Z",
      });
      closeDb();
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        isDemo: true,
        persona: "freelancer",
        label: "Freelancer",
        description: "Mixed inflows",
        generatedAt: "2024-06-15T10:00:00.000Z",
      });
    });
  });
});