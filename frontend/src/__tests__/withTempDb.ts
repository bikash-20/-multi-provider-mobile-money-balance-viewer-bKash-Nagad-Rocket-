/**
 * withTempDb — give every test a fresh, isolated SQLite file.
 *
 * better-sqlite3 holds a file-handle per Database instance, and `getDb`
 * (in src/lib/db.ts) caches one globally on globalThis. To test isolation
 * without contaminating the dev DB, we (a) point getDb at a random temp
 * file via `WALLETSYNC_DB_PATH`, (b) `closeDb()` to drop the singleton
 * between tests, (c) rm the temp file when the test is done.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { closeDb } from "@/lib/db";

let activePath: string | null = null;

export function withTempDb<T>(fn: () => Promise<T> | T): Promise<T> {
  return (async () => {
    closeDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walletsync-test-"));
    activePath = path.join(dir, "test.db");
    process.env.WALLETSYNC_DB_PATH = activePath;
    try {
      return await fn();
    } finally {
      closeDb();
      delete process.env.WALLETSYNC_DB_PATH;
      try {
        fs.rmSync(dir, { force: true, recursive: true });
      } catch {
        // best-effort cleanup
      }
      activePath = null;
    }
  })();
}

/** Path to the temp db currently in use (debug aid only). */
export function activeDbPath(): string | null {
  return activePath;
}
