/**
 * lib/infrastructure/transaction.ts — single swap-point for atomic writes.
 *
 * Lives beside `src/lib/db.ts` (which owns the singleton connection) rather
 * than inside it, so the original swap-point contract stays untouched and
 * the existing API routes can migrate to this wrapper one caller at a
 * time.
 *
 * `withTransaction(db, fn)` runs `fn` inside `db.transaction(...)`, which
 * issues a BEGIN before the first statement, COMMITs on resolved return,
 * and ROLLBACKs on any thrown error. The wrapper is the caller's promise
 * that `fn` either succeeds atomically or leaves no trace.
 *
 * Note: better-sqlite3's `db.transaction(fn)` invokes `fn` directly; the
 * implicit `this` is the transaction proxy, but it is not typed as a full
 * Database and has no `prepare` method. Callers should prepare statements
 * on `db` *before* entering `fn` and reuse them inside.
 *
 * This is the LiquiGuard port: in Postgres it would be a single SECURITY
 * DEFINER function call; in SQLite it's just `db.transaction` because the
 * language already guarantees atomicity.
 */
import type { Database as DB } from "better-sqlite3";

/**
 * Run `fn` inside `db.transaction(...)`. Returns whatever `fn` returns.
 * Throws if `fn` throws — the underlying transaction is rolled back
 * before the error propagates.
 */
export function withTransaction<T>(
  db: DB,
  fn: () => T,
): T {
  const txRunner = db.transaction(fn) as unknown as () => T;
  return txRunner();
}

