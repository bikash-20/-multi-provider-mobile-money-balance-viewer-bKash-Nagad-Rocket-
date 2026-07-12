/**
 * lib/metaRepo.ts — read/seed metadata about the database.
 *
 * Keeps the `meta` table (persona label, generation timestamp, demo
 * flag) behind a thin repository so the API routes don't need to know
 * about better-sqlite3 directly.
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { PERSONAS } from "./seedDemo";
import type { MetaSnapshot, PersonaName } from "./metaTypes";

export type { MetaSnapshot, PersonaName } from "./metaTypes";

function asPersona(raw: string | undefined): PersonaName | null {
  if (!raw) return null;
  return raw in PERSONAS ? (raw as PersonaName) : null;
}

function resolveDbPath(): string {
  if (process.env.WALLETSYNC_DB_PATH) return process.env.WALLETSYNC_DB_PATH;
  // Resolve relative to the frontend package directory (<repo>/frontend),
  // so the canonical DB lives at <repo>/data/walletsync.db regardless of
  // where `next start` is invoked from. Server-only path.
  return path.resolve(process.cwd(), "..", "data", "walletsync.db");
}

function ensureSchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function readMetaSnapshot(): MetaSnapshot {
  const dbPath = resolveDbPath();
  // Tolerate a missing DB — first-run the app has zero entries, zero
  // meta rows. We surface that as isDemo: false so the UI can
  // distinguish "no demo data" from "demo data missing".
  if (!fs.existsSync(dbPath)) {
    return {
      isDemo: false,
      persona: null,
      label: null,
      description: null,
      generatedAt: null,
    };
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare("SELECT key, value FROM meta")
      .all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      isDemo: map.get("seed.demo") === "true",
      persona: asPersona(map.get("seed.persona")),
      label: map.get("seed.label") ?? null,
      description: map.get("seed.description") ?? null,
      generatedAt: map.get("seed.generated_at") ?? null,
    };
  } finally {
    db.close();
  }
}

/** Re-open the real DB (writable) just to ensure the meta table
 *  exists. Idempotent. Safe to call from API routes. */
export function ensureMetaTable(): void {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  try {
    ensureSchema(db);
  } finally {
    db.close();
  }
}
