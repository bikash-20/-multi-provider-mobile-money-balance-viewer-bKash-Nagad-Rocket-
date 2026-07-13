/**
 * lib/db.ts — the single swap-point for persistence.
 *
 * Every other file in this repo talks to entries through the repository
 * factories in `lib/infrastructure/repos/`, which only see the `Database`
 * instance returned here. Swapping SQLite for Postgres (or node:sqlite, or
 * anything else) is therefore a change isolated to this file plus the
 * matching repo implementations — no API route, no React component, no
 * reducer needs to know.
 *
 * Behaviour:
 *  - `getDb()` is a process-wide singleton. Next.js dev mode hot-reload
 *    modules, so we cache the connection on `globalThis` to avoid opening
 *    a new file handle on every request.
 *  - `resolveDbPath()` honours the `WALLETSYNC_DB_PATH` env override so
 *    the app can point at a writable volume in a deploy target without
 *    code changes.
 *  - Schema is provisioned by the migration runner in
 *    `lib/infrastructure/migrate.ts`, applied idempotently on first open.
 *    Migrations live in `lib/infrastructure/migrations/*.sql` and are
 *    recorded in the `_migrations` table so a rerun is a no-op.
 */
import Database, { type Database as DB } from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

import { migrate } from "@/lib/infrastructure/migrate";

interface CachedDb {
  db: DB;
}

const GLOBAL_KEY = "__walletsync_db__" as const;

function resolveDbPath(): string {
  if (process.env.WALLETSYNC_DB_PATH) {
    return process.env.WALLETSYNC_DB_PATH;
  }
  // Default: <repo-root>/data/walletsync.db, resolved relative to cwd.
  // Next.js runs from the project root (frontend/), so we step up one
  // directory to land at the repo root where /data lives.
  return path.resolve(process.cwd(), "..", "data", "walletsync.db");
}

function resolveMigrationsDir(): string {
  // Migrations live in source — Next.js runs from the project root, so the
  // path is stable. The same convention is used by `@/__tests__/migratedDb`.
  return path.resolve(
    process.cwd(),
    "src",
    "lib",
    "infrastructure",
    "migrations",
  );
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Returns the singleton Database. Opens on first call, returns the
 *  cached connection thereafter. */
export function getDb(): DB {
  const g = globalThis as unknown as { [GLOBAL_KEY]?: CachedDb };
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY]!.db;

  const filePath = resolveDbPath();
  ensureDir(filePath);
  const db = new Database(filePath);
  // Match the PRAGMAs that 001_init.sql sets when run against a fresh DB,
  // so a v1-style DB opened *before* migrations have run still gets WAL +
  // foreign_keys. migrate() will re-PRAGMA the same values; the duplicate
  // is harmless.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db, resolveMigrationsDir());
  g[GLOBAL_KEY] = { db };
  return db;
}

/** Test-only / db:reset helper. Closes and forgets the singleton so the
 *  next getDb() reopens (typically pointing at a fresh file). */
export function closeDb(): void {
  const g = globalThis as unknown as { [GLOBAL_KEY]?: CachedDb };
  if (g[GLOBAL_KEY]) {
    g[GLOBAL_KEY]!.db.close();
    delete g[GLOBAL_KEY];
  }
}