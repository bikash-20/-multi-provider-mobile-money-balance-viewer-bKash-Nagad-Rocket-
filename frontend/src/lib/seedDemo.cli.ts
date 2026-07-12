/**
 * src/lib/seedDemo.cli.ts — CLI entrypoint that the .mjs script shells
 * out to. Kept separate from seedDemo.ts so the module's runtime API
 * (seedDemo + readMeta + buildDailySeries) stays import-clean with no
 * shebang / process.exit / console side effects when the Next.js app
 * pulls it in.
 */

import { seedDemo, type PersonaName } from "./seedDemo";

interface CliArgs {
  persona: string;
  days: string;
  dbPath: string;
}

function parseArgs(): CliArgs {
  const out: CliArgs = { persona: "freelancer", days: "75", dbPath: "" };
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.replace(/^--/, "").split("=");
    if (k === "persona") out.persona = v ?? "";
    else if (k === "days") out.days = v ?? "";
    else if (k === "db-path") out.dbPath = v ?? "";
  }
  return out;
}

function resolveDbPath(): string {
  if (process.env.WALLETSYNC_DB_PATH) return process.env.WALLETSYNC_DB_PATH;
  const path = require("node:path") as typeof import("node:path");
  return path.resolve(process.cwd(), "..", "data", "walletsync.db");
}

const args = parseArgs();
const dbPath = args.dbPath || resolveDbPath();

try {
  const result = seedDemo(
    args.persona as PersonaName,
    Number.parseInt(args.days, 10),
    dbPath,
  );
  console.log(`✓ seeded ${result.totalEntries} entries across ${result.daysCovered} days`);
  console.log(`  persona: ${result.label} (${result.persona})`);
  for (const p of ["bkash", "nagad", "rocket"] as const) {
    console.log(`  ${p.padEnd(7)} ${result.perProvider[p]} entries`);
  }
  console.log(`  db: ${result.dbPath}`);
  console.log(`  ⚠️  demo data — not real financial records`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}