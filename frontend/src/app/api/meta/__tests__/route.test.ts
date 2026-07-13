/**
 * /api/meta route — exposes the demo metadata row.
 *
 * Phase 3: the test no longer pokes the meta facade; it just opens the
 * same SQLite connection the route uses (`getDb()`) and writes the seed
 * rows directly. The v1 `ensureMetaTable()` call was a pre-condition
 * for the inline-CREATE-table schema in `lib/db.ts`; with the meta
 * schema already managed by the inline `initSchema()` in `db.ts`, the
 * test just writes rows.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DB } from "better-sqlite3";

import { closeDb, getDb } from "@/lib/db";
import { GET } from "@/app/api/meta/route";
import { withTempDb } from "@/__tests__/withTempDb";

function writeMeta(rows: Record<string, string>): void {
  const db: DB = getDb();
  const ins = db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
  );
  for (const [k, v] of Object.entries(rows)) ins.run(k, v);
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