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
import type { Currency } from "@/features/currency/types";

/**
 * Keyset cursor for paging back through the entries log. `id` is the
 * stringified autoincrement primary key of the row at the bottom of
 * the current page (the OLDEST row on the page, since we list
 * newest-first); clients feed both back as `beforeTs` + `beforeId`
 * to fetch the next page. The composite cursor is stable across
 * same-ms ties because `id` is monotonically increasing.
 */
export interface EntriesCursor {
  ts: number;
  id: string;
}

export interface EntriesRepo {
  /**
   * All entries, newest-first. Thin wrapper over `listPage({limit})`
   * — preserved for callers that want the full history (e.g. the
   * sparkline series builder). Pagination-aware callers should use
   * `listPage` instead.
   */
  listEntries(): Promise<BalanceEntry[]>;

  /**
   * Page through the entries log newest-first using a composite
   * `(ts, id)` keyset cursor. When `before` is omitted, the first
   * page is returned; otherwise only rows strictly older than the
   * cursor row are returned. The page size is bounded by `limit`.
   *
   * Phase 10: mirrors Phase 9's transferRepo.recentPage so the two
   * streams on the dashboard can paginate in lockstep.
   */
  listPage(opts: {
    limit: number;
    before?: EntriesCursor;
  }): Promise<BalanceEntry[]>;

  /**
   * Append a single row. Server assigns `id` and `timestamp` (ISO 8601).
   * Optional `currency` (defaults to 'BDT') and `exchangeRateBdt` (used
   * only for USD entries) for multi-currency support. Returns the
   * persisted row, including the assigned id and timestamp.
   */
  appendEntry(
    provider: Provider,
    balance: number,
    currency?: Currency,
    exchangeRateBdt?: number,
  ): Promise<BalanceEntry>;
}
