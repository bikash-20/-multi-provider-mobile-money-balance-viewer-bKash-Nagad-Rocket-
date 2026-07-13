/**
 * lib/domain/repositories/entriesRepo.ts — port for the v1 BalanceEntry log.
 *
 * v1 doesn't have a `provider_balance` snapshot row; the current balance per
 * provider is derived from the most recent `balance_entries` row. This port
 * matches that shape so a v1 SQLite binding can sit beside the Phase 2 v2
 * shapes (`BalanceRepo` etc.) without conflict.
 *
 * The Phase 3 migration introduces this port as the first wire-up between
 * the v1 legacy layout (frontend/src/lib/db.ts) and the v2 schema layout
 * (lib/infrastructure/migrations/001_init.sql). They target the same logical
 * concept (the wallet's balance history) but different physical shapes; in
 * a future Phase 4 the v1 binding will be deleted in favour of the v2
 * `BalanceRepo` adapter.
 */
import type { BalanceEntry, Provider } from "@/features/wallet/types";

export interface EntriesRepo {
  /** All entries, newest-first. Empty array when no rows persist. */
  listEntries(): Promise<BalanceEntry[]>;

  /**
   * Append a single row. Server assigns `id` (UUIDv4) and `timestamp`
   * (ISO 8601) so the client cannot lie about either. Returns the
   * persisted row, including the assigned id and timestamp.
   */
  appendEntry(provider: Provider, balance: number): Promise<BalanceEntry>;
}
