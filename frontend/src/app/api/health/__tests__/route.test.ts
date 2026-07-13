/**
 * route.test.ts — /api/health
 *
 * The probe is the canary the deploy pipeline calls every few
 * seconds, so the contract here is exactly the one Render / Fly /
 * the smoke script will assert against:
 *
 *   - 200 + status:"ok"      on a healthy DB
 *   - 200 + status:"degraded" when reads work but writes fail
 *   - 503 + status:"down"    when the DB itself is unreachable
 *
 * We pin the body shape (status, version, db.*) because dashboards
 * consume it. Adding a new field is fine; renaming one is breaking.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { closeDb, getDb } from "@/lib/db";
import { GET } from "@/app/api/health/route";
import { withTempDb } from "@/__tests__/withTempDb";

describe("/api/health", () => {
  beforeEach(() => {
    closeDb();
  });

  afterEach(() => {
    // Restore any DB spy we set up in a specific test.
    vi.restoreAllMocks();
  });

  it("returns 200 + status:ok on a healthy DB", async () => {
    await withTempDb(async () => {
      // Apply migrations so balance_entries / personas exist.
      getDb();
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        version: string;
        db: {
          open: boolean;
          writesOk: boolean;
          personaCount: number;
          entryCount: number;
          transferCount: number;
          activePersona: string | null;
          error: string | null;
        };
        uptimeSeconds: number;
        now: string;
      };
      expect(body.status).toBe("ok");
      expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(body.db.open).toBe(true);
      expect(body.db.writesOk).toBe(true);
      expect(body.db.personaCount).toBe(0);
      expect(body.db.entryCount).toBe(0);
      expect(body.db.transferCount).toBe(0);
      expect(body.db.activePersona).toBeNull();
      expect(body.db.error).toBeNull();
      expect(typeof body.uptimeSeconds).toBe("number");
      expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
      // `now` is a parseable ISO timestamp.
      expect(Number.isNaN(Date.parse(body.now))).toBe(false);
    });
  });

  it("counts personas / entries / transfers after seeding", async () => {
    await withTempDb(async () => {
      const db = getDb();
      // Minimal v2 seed: one persona + one entry + one transfer.
      db.prepare(
        `INSERT INTO personas
           (id, display_name, opening_bkash, opening_nagad, opening_rocket,
            inflow_rate, volatility)
         VALUES ('freelancer', 'Freelancer', 0, 0, 0, 1.0, 0.10)`,
      ).run();
      db.prepare(
        `INSERT INTO balance_entries
           (persona_id, provider_id, balance, source, transfer_id, ts)
         VALUES ('freelancer', 'bkash', 100, 'seed', NULL, ?)`,
      ).run(Date.now());
      db.prepare(
        `INSERT INTO transfers
           (transfer_id, persona_id, from_provider, to_provider,
            amount_bdt, from_delta, to_delta,
            from_after, from_version, to_after, to_version,
            note, ts)
         VALUES ('a1', 'freelancer', 'bkash', 'nagad',
                 50, -50, 50,
                 100, 1, 200, 1,
                 '', ?)`,
      ).run(Date.now());
      db.prepare(
        "INSERT INTO meta (key, value) VALUES ('active_persona', 'freelancer')",
      ).run();

      const res = await GET();
      const body = (await res.json()) as {
        status: string;
        db: {
          personaCount: number;
          entryCount: number;
          transferCount: number;
          activePersona: string | null;
        };
      };
      expect(body.status).toBe("ok");
      expect(body.db.personaCount).toBe(1);
      expect(body.db.entryCount).toBe(1);
      expect(body.db.transferCount).toBe(1);
      expect(body.db.activePersona).toBe("freelancer");
    });
  });

  it("returns 200 + status:degraded when the write probe fails", async () => {
    await withTempDb(async () => {
      const db = getDb();

      // Force every CREATE statement to throw after we've already
      // passed the count queries. The probe uses CREATE TEMP TABLE,
      // so we hook the `exec` call from the probe path only — we do
      // that by wrapping `prepare` (which the counts use) and
      // letting `exec` be free, then spying on `exec` with a
      // one-shot override.
      //
      // Simpler path: spy on exec and reject only if the SQL
      // contains CREATE TEMP TABLE. The counts use prepare, not
      // exec, so they still pass.
      const originalExec = db.exec.bind(db);
      const execSpy = vi
        .spyOn(db, "exec")
        .mockImplementation((sql: string) => {
          if (sql.includes("CREATE TEMP TABLE")) {
            throw new Error("read-only filesystem");
          }
          return originalExec(sql);
        });

      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        db: { writesOk: boolean; error: string | null };
      };
      expect(body.status).toBe("degraded");
      expect(body.db.writesOk).toBe(false);
      expect(body.db.error).toMatch(/read-only filesystem/);

      execSpy.mockRestore();
    });
  });

  it("returns 503 + status:down when the DB itself throws", async () => {
    await withTempDb(async () => {
      const db = getDb();

      // Make every prepare() throw on the personas COUNT — that
      // simulates a corrupt / unmigrated DB where the first read
      // call inside the route's try-block blows up. The route's
      // outer catch maps this to status:"down" + HTTP 503.
      const realPrepare = db.prepare.bind(db);
      vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
        if (sql.includes("FROM personas")) {
          throw new Error("no such table: personas");
        }
        return realPrepare(sql);
      }) as typeof db.prepare);

      const res = await GET();
      expect(res.status).toBe(503);
      const body = (await res.json()) as {
        status: string;
        db: { open: boolean; error: string | null };
      };
      expect(body.status).toBe("down");
      expect(body.db.open).toBe(false);
      expect(body.db.error).toMatch(/no such table/);
    });
  });
});
