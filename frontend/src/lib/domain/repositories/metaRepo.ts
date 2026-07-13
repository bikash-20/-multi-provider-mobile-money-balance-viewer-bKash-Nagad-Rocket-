/**
 * lib/domain/repositories/metaRepo.ts — port for the demo-metadata KV table.
 *
 * Today the only consumer is the `/api/meta` route, which surfaces
 * `MetaSnapshot` to the UI so the demo badge can render. The port exists
 * so that:
 *   - the route depends on a domain interface, not on a raw `db.prepare`,
 *   - a Postgres / in-memory / mocked adapter can be substituted in tests
 *     or in a future deployment without rewriting the route.
 */
import type { MetaSnapshot } from "@/lib/metaTypes";

export interface MetaRepo {
  /**
   * Read the metadata snapshot. Returns all-null defaults on a missing
   * table (first-run case) so the UI can tell "no demo data" apart from
   * "demo data missing".
   */
  readSnapshot(): Promise<MetaSnapshot>;

  /**
   * Idempotently create the meta table. Safe to call on every API
   * request — survives missing directories, runs `CREATE TABLE IF NOT
   * EXISTS` only.
   */
  ensureSchema(): Promise<void>;
}
