/**
 * lib/db.ts — the single swap-point for persistence.
 *
 * Every other file in this repo talks to entries through the repository
 * in `lib/entriesRepo.ts`, which only sees the `Database` instance
 * returned here. Swapping SQLite for Postgres (or node:sqlite, or
 * anything else) is therefore a change isolated to this file plus the
 * matching repo implementation — no API route, no React component, no
 * reducer needs to know.
 *
 * Behaviour:
 *  - `getDb()` is a process-wide singleton. Next.js dev mode hot-reloads
 *    modules, so we cache the connection on `globalThis` to avoid opening
 *    a new file handle on every request.
 *  - `resolveDbPath()` honours the `WALLETSYNC_DB_PATH` env override so
 *    the app can point at a writable volume in a deploy target without
 *    code changes.
 *  - Schema is created idempotently on first open via `initSchema()`.
 */
import Database, { type Database as DB } from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

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

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function initSchema(db: DB): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Append-only log. No UPDATE / DELETE paths anywhere in the app — this
  // matches the original spec's "log is append-only" rule (WALLETSYNC_SPEC
  // §4). The most recent row per provider is the current balance; older
  // rows are kept for the Recent Entries view.
  db.exec(`
    CREATE TABLE IF NOT EXISTS balance_entries (
      id          TEXT PRIMARY KEY,
      provider    TEXT NOT NULL CHECK (provider IN ('bkash', 'nagad', 'rocket')),
      balance     REAL NOT NULL CHECK (balance >= 0),
      timestamp   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_balance_entries_provider_ts
      ON balance_entries (provider, timestamp DESC);
  `);
}

/** Returns the singleton Database. Opens on first call, returns the
 *  cached connection thereafter. */
export function getDb(): DB {
  const g = globalThis as unknown as { [GLOBAL_KEY]?: CachedDb };
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY]!.db;

  const filePath = resolveDbPath();
  ensureDir(filePath);
  const db = new Database(filePath);
  initSchema(db);
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