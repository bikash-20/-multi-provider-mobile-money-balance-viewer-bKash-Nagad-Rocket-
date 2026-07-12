#!/usr/bin/env node
/**
 * scripts/seed-demo-data.mjs — DEMO DATA ONLY. CLI wrapper.
 *
 * Thin shell around `src/lib/seedDemo.ts` + `src/lib/seedDemo.cli.ts`.
 * All persona specs, generation logic, DB persistence, and meta-row
 * stamping live in the shared TS module so the in-app
 * `/api/persona/switch` endpoint and this CLI produce identical data.
 *
 * Usage:
 *   node scripts/seed-demo-data.mjs                     # default: freelancer, 75 days
 *   node scripts/seed-demo-data.mjs --persona=small_business
 *   node scripts/seed-demo-data.mjs --persona=student --days=60
 *
 * ⚠️  Demo data only — see src/lib/seedDemo.ts header for the same
 *     warning.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/* ─── path resolution (mirrors src/lib/db.ts + scripts/db-reset.mjs) ──── */

function resolveDbPath() {
  if (process.env.WALLETSYNC_DB_PATH) return process.env.WALLETSYNC_DB_PATH;
  return path.resolve(process.cwd(), "..", "data", "walletsync.db");
}

const dbPath = resolveDbPath();
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

/* ─── cli args ───────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const hit = args.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.split("=")[1] : fallback;
}

const persona = getArg("persona", "freelancer");
const days = getArg("days", "75");

/* ─── shell out to the shared TS CLI ────────────────────────────────── */

// Invoke the shared seedDemo via a one-off tsx run. Keeps logic in one
// place, no duplication.
const seedModule = path.resolve(process.cwd(), "src/lib/seedDemo.cli.ts");
const result = spawnSync(
  "npx",
  [
    "tsx",
    seedModule,
    "--persona=" + persona,
    "--days=" + days,
    "--db-path=" + dbPath,
  ],
  { stdio: "inherit", env: process.env },
);

if (result.status !== 0) {
  console.error("seed failed");
  process.exit(result.status ?? 1);
}
