/**
 * /api/health — lightweight liveness + readiness probe.
 *
 * Intended for:
 *   - Render / Fly / Vercel `healthCheckPath`
 *   - uptime monitors (Pingdom, Better Stack, etc.)
 *   - the Phase 12 smoke script
 *
 * The response shape is intentionally tiny — callers don't need the
 * row counts to decide whether to alert, only the top-level status.
 * Counts are included so on-call humans can sanity-check "did the
 * DB actually open?" from a single curl.
 *
 * Status taxonomy:
 *   - "ok"        — DB open, writes work, schema is the expected
 *                    shape. 200.
 *   - "degraded"  — DB open and reads work, but the write probe
 *                    failed. Still 200: the API is up, persistence
 *                    is just unreliable. The smoke script logs this.
 *   - "down"      — DB open failed entirely (missing file / bad
 *                    permissions / migrations failed). 503.
 *
 * NOTE: `dynamic = "force-dynamic"` is required — Next.js would
 * otherwise try to cache the response, which makes the uptime check
 * useless. We also pin the runtime to nodejs because the v2 repos
 * use better-sqlite3 (native binding), which isn't edge-compatible.
 */
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface HealthBody {
  status: "ok" | "degraded" | "down";
  version: string;
  uptimeSeconds: number;
  now: string;
  db: {
    open: boolean;
    writesOk: boolean;
    personaCount: number;
    activePersona: string | null;
    entryCount: number;
    transferCount: number;
    error: string | null;
  };
}

const PROCESS_START = Date.now();

/** App version reported by the health probe. Bump on release.
 *  Kept as a string (not read from package.json) because Next.js
 *  bundles the route module at build time and a runtime require()
 *  against package.json is fragile across output file tracing. */
const APP_VERSION = "0.4.0";

export async function GET(): Promise<NextResponse<HealthBody>> {
  const db = getDb();
  const body: HealthBody = {
    status: "down",
    version: APP_VERSION,
    uptimeSeconds: Math.floor((Date.now() - PROCESS_START) / 1000),
    now: new Date().toISOString(),
    db: {
      open: false,
      writesOk: false,
      personaCount: 0,
      activePersona: null,
      entryCount: 0,
      transferCount: 0,
      error: null,
    },
  };

  try {
    // 1) Open + read counts. These should always succeed if the
    //    migration runner didn't throw on first getDb().
    const personaCount = (
      db.prepare("SELECT COUNT(*) AS n FROM personas").get() as { n: number }
    ).n;
    const entryCount = (
      db.prepare("SELECT COUNT(*) AS n FROM balance_entries").get() as {
        n: number;
      }
    ).n;
    const transferCount = (
      db.prepare("SELECT COUNT(*) AS n FROM transfers").get() as {
        n: number;
      }
    ).n;
    const activeRow = db
      .prepare("SELECT value FROM meta WHERE key = 'active_persona'")
      .get() as { value: string } | undefined;

    body.db.open = true;
    body.db.personaCount = personaCount;
    body.db.entryCount = entryCount;
    body.db.transferCount = transferCount;
    body.db.activePersona = activeRow?.value ?? null;
    body.status = "ok";

    // 2) Write probe. We use a transient table that we drop on the
    //    same call so we never leave a side effect. This catches
    //    read-only mounts (Render's free tier doesn't have one, but
    //    a misconfigured WALLETSYNC_DB_PATH could land us on one)
    //    without polluting the schema.
    const probeName = `__health_probe_${Date.now()}_${Math.floor(
      Math.random() * 1e6,
    )}`;
    try {
      db.exec(
        `CREATE TEMP TABLE ${probeName} (id INTEGER); INSERT INTO ${probeName} (id) VALUES (1); DROP TABLE ${probeName};`,
      );
      body.db.writesOk = true;
    } catch (writeErr) {
      body.db.writesOk = false;
      body.db.error =
        writeErr instanceof Error
          ? `writes failed: ${writeErr.message}`
          : "writes failed";
      body.status = "degraded";
    }
  } catch (err) {
    // getDb() itself can throw (no fs access, migrations failed).
    // That's the only path that ends in "down".
    body.db.error =
      err instanceof Error ? err.message : "database unavailable";
  }

  const httpStatus = body.status === "down" ? 503 : 200;
  return NextResponse.json(body, { status: httpStatus });
}
