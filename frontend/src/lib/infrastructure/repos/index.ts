/**
 * lib/infrastructure/repos/index.ts — composition root for the repository
 * bindings. Every API route and server-side module should obtain its
 * repositories through `getRepositories(getDb())` rather than importing a
 * concrete `SqliteXRepo` directly. This is what makes the persistence
 * layer swappable: a future Postgres deployment needs only a parallel
 * set of adapters and a switch on which file this module re-exports.
 *
 * Phase 3 wiring scope (current):
 *   - EntriesRepo   → SqliteEntriesRepo   (v1 `balance_entries` shape)
 *   - MetaRepo      → SqliteMetaRepo      (v1 `meta` KV table)
 *
 * The Phase 2 ports (`BalanceRepo`, `TransferRepo`, `EventRepo`,
 * `AdvisoryRepo`) target the v2 schema in
 * `lib/infrastructure/migrations/001_init.sql`. They are not wired
 * here yet because the application, seeder, and tests still target v1.
 * Wiring those is Phase 4 (schema swap).
 */
import type { Database as DB } from "better-sqlite3";

import type { EntriesRepo } from "@/lib/domain/repositories/entriesRepo";
import type { MetaRepo } from "@/lib/domain/repositories/metaRepo";
import { SqliteEntriesRepo } from "@/lib/infrastructure/repos/sqliteEntriesRepo";
import { SqliteMetaRepo } from "@/lib/infrastructure/repos/sqliteMetaRepo";

export interface Repositories {
  readonly entries: EntriesRepo;
  readonly meta: MetaRepo;
}

/**
 * Build the repository bundle for a given Database handle. Stateless —
 * call this with the singleton returned by `getDb()` from every
 * request path.
 */
export function getRepositories(db: DB): Repositories {
  return {
    entries: new SqliteEntriesRepo(db),
    meta: new SqliteMetaRepo(db),
  };
}

export type { EntriesRepo, MetaRepo };