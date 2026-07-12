#!/usr/bin/env node
/**
 * scripts/db-reset.mjs — wipe the local SQLite database file.
 *
 * Used for demos and local development when you want a clean slate.
 * Resolves the same path as src/lib/db.ts (env override first, then
 * <repo-root>/data/walletsync.db) and removes the file plus any WAL
 * siblings. Safe to run while the dev server is not running.
 */
import fs from "node:fs";
import path from "node:path";

function resolveDbPath() {
  if (process.env.WALLETSYNC_DB_PATH) return process.env.WALLETSYNC_DB_PATH;
  return path.resolve(process.cwd(), "..", "data", "walletsync.db");
}

const filePath = resolveDbPath();
const siblings = ["", "-journal", "-wal", "-shm"].map((suffix) => filePath + suffix);

let removedAny = false;
for (const p of siblings) {
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log(`removed: ${p}`);
    removedAny = true;
  }
}
if (!removedAny) {
  console.log(`no db files found at ${filePath} (or its -journal / -wal / -shm siblings)`);
}