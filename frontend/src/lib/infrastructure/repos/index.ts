/**
 * lib/infrastructure/repos/index.ts — composition root for the repository
 * bindings. Every API route and server-side module should obtain its
 * repositories through `getRepositories(getDb())` rather than importing a
 * concrete `SqliteXRepo` directly. This is what makes the persistence
 * layer swappable: a future Postgres deployment needs only a parallel
 * set of adapters and a switch on which file this module re-exports.
 *
 * Phase 6 wiring scope (current):
 *   - EntriesRepo   → SqliteEntriesRepo   (v1 `BalanceEntry` shape, writes v2)
 *   - MetaRepo      → SqliteMetaRepo      (v1 `meta` KV table)
 *   - BalanceRepo   → SqliteBalanceRepo   (v2 `provider_balance` snapshot row)
 *   - TransferRepo  → SqliteTransferRepo  (v2 `transfers` double-entry ledger)
 *
 * The AdvisoryRepo / EventRepo ports (Phase 2) target the v2 schema as
 * well; they remain unwired because no route calls them yet. Wiring
 * them is a single-line addition when the route lands.
 */
import type { Database as DB } from "better-sqlite3";

import type { EntriesRepo } from "@/lib/domain/repositories/entriesRepo";
import type { MetaRepo } from "@/lib/domain/repositories/metaRepo";
import type { BalanceRepo } from "@/lib/domain/repositories/balanceRepo";
import type { TransferRepo } from "@/lib/domain/repositories/transferRepo";
import { SqliteEntriesRepo } from "@/lib/infrastructure/repos/sqliteEntriesRepo";
import { SqliteMetaRepo } from "@/lib/infrastructure/repos/sqliteMetaRepo";
import { SqliteBalanceRepo } from "@/lib/infrastructure/repos/sqliteBalanceRepo";
import { SqliteTransferRepo } from "@/lib/infrastructure/repos/sqliteTransferRepo";

export interface Repositories {
  readonly entries: EntriesRepo;
  readonly meta: MetaRepo;
  readonly balances: BalanceRepo;
  readonly transfers: TransferRepo;
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
    balances: new SqliteBalanceRepo(db),
    transfers: new SqliteTransferRepo(db),
  };
}

export type { EntriesRepo, MetaRepo, BalanceRepo, TransferRepo };