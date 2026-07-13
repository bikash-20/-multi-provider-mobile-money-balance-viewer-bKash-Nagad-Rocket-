/**
 * lib/infrastructure/migrate.ts — apply SQL migrations in lexical order.
 *
 * Replaces `db.ts`'s inline `initSchema()` for the new SQLite layer.
 * Behaviour:
 *   1. Ensure the `_migrations(name, applied_at)` table exists.
 *   2. Read every `*.sql` file in `migrationsDir` sorted by filename.
 *   3. For each file not already recorded in `_migrations`, run its full
 *      contents inside `withTransaction` and insert a row on success.
 *
 * Re-running `migrate(db, dir)` is a no-op except for genuinely new files.
 * Failures roll back the current migration AND leave its row absent, so
 * the next run retries it cleanly — no half-applied state.
 */
import fs from "node:fs";
import path from "node:path";
import type { Database as DB } from "better-sqlite3";
import { withTransaction } from "./transaction";

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    name       TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`;

function listSqlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Apply every pending SQL migration from `migrationsDir` to `db`.
 * Returns the filenames that were applied in this call (empty on rerun).
 */
export function migrate(db: DB, migrationsDir: string): string[] {
  db.exec(CREATE_MIGRATIONS_TABLE);
  const alreadyApplied = new Set(
    db.prepare<[], { name: string }>("SELECT name FROM _migrations").all().map((r) => r.name),
  );
  const files = listSqlFiles(migrationsDir);
  const appliedNow: string[] = [];
  const record = db.prepare(
    "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
  );
  for (const file of files) {
    if (alreadyApplied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    withTransaction(db, () => {
      db.exec(sql);
      record.run(file, Date.now());
    });
    appliedNow.push(file);
  }
  return appliedNow;
}
