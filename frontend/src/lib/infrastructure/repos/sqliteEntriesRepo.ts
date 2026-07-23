/**
 * SqliteEntriesRepo — v2-binding for the `EntriesRepo` port.
 *
 * The UI's contract is the v1 `BalanceEntry` shape ({id, provider, balance,
 * timestamp}); the persistence layer is now the v2 schema from
 * `migrations/001_init.sql` (`personas` + `provider_balance` + per-persona
 * `balance_entries`). This binding is the adapter that keeps the v1
 * response shape while writing to the v2 tables.
 *
 * Persona scoping:
 *  - The UI is persona-agnostic: the dashboard shows one active persona at
 *    a time and the URL/reducer doesn't carry a persona parameter. The
 *    active persona lives in `meta.active_persona`, set by seedDemo.
 *  - `listEntries` reads that key; on a cold start with no active persona
 *    we return `[]` (the seeder hasn't been run yet, so there's nothing to
 *    show). The dashboard surfaces this as "empty" rather than crashing.
 *  - `appendEntry` will lazily create a `student` persona + default
 *    provider_balance rows on a cold append, so the demo UI can be poked
 *    before the seeder runs and not 500.
 */
import type { Database as DB } from "better-sqlite3";
import { withTransaction } from "@/lib/infrastructure/transaction";
import { runWithRetry, type RetryPolicy } from "@/lib/infrastructure/retry";
import type {
  EntriesRepo,
  EntriesCursor,
} from "@/lib/domain/repositories/entriesRepo";
import type {
  BalanceEntry,
  Provider,
} from "@/features/wallet/types";
import type { Currency } from "@/features/currency/types";

/** Marker for optimistic-lock conflicts inside v2 writes. Phase 5
 *  retry hook re-throws this so the jittered retry loop can pick it
 *  up without re-running the cold-start persona provisioning. */
class BalanceConflictError extends Error {
  constructor(
    readonly personaId: string,
    readonly provider: Provider,
  ) {
    super(`balance write conflict for ${personaId}/${provider}; retry`);
    this.name = "BalanceConflictError";
  }
}

/** Two of the appends in a row should never see the same race twice,
 *  so a 5-attempt policy is plenty: each retry backs off by ~factor
 *  but the total budget is capped so we never block the request for
 *  more than a few hundred ms. */
const APPEND_RETRY_POLICY: Partial<RetryPolicy> = {
  maxAttempts: 5,
  baseDelayMs: 20,
  maxTotalMs: 500,
  factor: 2,
};

const isBalanceConflict = (e: unknown): boolean =>
  e instanceof BalanceConflictError;

interface V2Row {
  id: number;
  persona_id: string;
  provider_id: Provider;
  balance: number;
  source: string;
  transfer_id: string | null;
  ts: number;
  currency: string | null;
  exchange_rate: number | null;
}

const DEFAULT_PERSONA = "student";
const DEFAULT_PROVIDERS: Provider[] = ["bkash", "nagad", "rocket"];
const DEFAULT_OPENING: Record<Provider, number> = {
  bkash: 1800,
  nagad: 950,
  rocket: 350,
};

/** Read the active persona id from `meta.active_persona`, or null. */
function readActivePersona(db: DB): string | null {
  // meta may not exist on a pre-migration dev DB that someone opened
  // without running the migrations; guard with try/catch.
  try {
    const row = db
      .prepare<[], { value: string }>(
        "SELECT value FROM meta WHERE key = 'active_persona'",
      )
      .get();
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/** Ensure the active persona exists in `personas` + `provider_balance`. */
function ensurePersona(db: DB, personaId: string): void {
  const existing = db
    .prepare<[string], { id: string }>("SELECT id FROM personas WHERE id = ?")
    .get(personaId);
  if (existing) return;
  db.prepare(
    `INSERT INTO personas
       (id, display_name, opening_bkash, opening_nagad, opening_rocket,
        inflow_rate, volatility)
     VALUES (?, ?, ?, ?, ?, 1.0, 0.10)`,
  ).run(
    personaId,
    personaId,
    DEFAULT_OPENING.bkash,
    DEFAULT_OPENING.nagad,
    DEFAULT_OPENING.rocket,
  );
  const now = Date.now();
  const ins = db.prepare(
    `INSERT INTO provider_balance
       (persona_id, provider_id, balance, version_id, updated_at)
     VALUES (?, ?, ?, 1, ?)`,
  );
  for (const p of DEFAULT_PROVIDERS) {
    ins.run(personaId, p, DEFAULT_OPENING[p], now);
  }
}

function hydrate(row: V2Row): BalanceEntry {
  const entry: BalanceEntry = {
    id: String(row.id),
    provider: row.provider_id,
    balance: row.balance,
    timestamp: new Date(row.ts).toISOString(),
  };
  if (row.currency && row.currency !== "BDT") {
    entry.currency = row.currency as Currency;
    if (row.exchange_rate != null) {
      entry.exchangeRateBdt = row.exchange_rate;
    }
  }
  return Object.freeze(entry);
}

export class SqliteEntriesRepo implements EntriesRepo {
  constructor(private readonly db: DB) {}

  listEntries(): Promise<BalanceEntry[]> {
    // Thin wrapper over listPage for callers that want the whole
    // history (e.g. the sparkline series builder). Pagination-aware
    // callers should use listPage directly.
    return this.listPage({ limit: Number.MAX_SAFE_INTEGER });
  }

  listPage(opts: {
    limit: number;
    before?: EntriesCursor;
  }): Promise<BalanceEntry[]> {
    const personaId = readActivePersona(this.db);
    if (!personaId) return Promise.resolve([]);
    const { limit, before } = opts;
    const rows = before
      ? this.db
          .prepare<[string, number, number, number], V2Row>(
            `SELECT id, persona_id, provider_id, balance, source, transfer_id,
                    ts, currency, exchange_rate
             FROM balance_entries
             WHERE persona_id = ?
               AND (ts, id) < (?, ?)
             ORDER BY ts DESC, id DESC
             LIMIT ?`,
          )
          .all(
            personaId,
            before.ts,
            Number(before.id),
            limit,
          )
      : this.db
          .prepare<[string, number], V2Row>(
            `SELECT id, persona_id, provider_id, balance, source, transfer_id,
                    ts, currency, exchange_rate
             FROM balance_entries
             WHERE persona_id = ?
             ORDER BY ts DESC, id DESC
             LIMIT ?`,
          )
          .all(personaId, limit);
    return Promise.resolve(rows.map(hydrate));
  }

  appendEntry(
    provider: Provider,
    balance: number,
    currency?: Currency,
    exchangeRateBdt?: number,
  ): Promise<BalanceEntry> {
    // Cold-start append: lazily create the default persona + balances.
    // This must run before the retry loop because the persona + the
    // initial provider_balance rows need to exist before any optimistic
    // UPDATE can succeed.
    let personaId = readActivePersona(this.db);
    if (!personaId) {
      personaId = DEFAULT_PERSONA;
      ensurePersona(this.db, personaId);
      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
        .run("active_persona", personaId);
    }

    // If the persona row exists but the per-provider row hasn't been
    // seeded yet, write it with the requested balance + version 1.
    // This is a one-shot INSERT outside the retry loop; it either
    // commits or it conflicts (e.g. two clients racing to first-write)
    // and the binding below re-reads + proceeds.
    const cur = this.db
      .prepare<
        [string, Provider],
        { balance: number; version_id: number }
      >(
        `SELECT balance, version_id FROM provider_balance
         WHERE persona_id = ? AND provider_id = ?`,
      )
      .get(personaId, provider);
    if (!cur) {
      this.db
        .prepare(
          `INSERT INTO provider_balance
             (persona_id, provider_id, balance, version_id, updated_at)
           VALUES (?, ?, ?, 1, ?)`,
        )
        .run(personaId, provider, balance, Date.now());
    }

    const db = this.db;
    const pid = personaId;

    return runWithRetry(
      () => {
        const ts = Date.now();
        return withTransaction(db, () => {
          // Re-read inside the transaction to close the read/write gap.
          const fresh = db
            .prepare<
              [string, Provider],
              { balance: number; version_id: number }
            >(
              `SELECT balance, version_id FROM provider_balance
               WHERE persona_id = ? AND provider_id = ?`,
            )
            .get(pid, provider)!;
          const upd = db
            .prepare(
              `UPDATE provider_balance
               SET balance    = ?,
                   version_id = version_id + 1,
                   updated_at = ?
               WHERE persona_id  = ?
                 AND provider_id = ?
                 AND version_id  = ?`,
            )
            .run(balance, ts, pid, provider, fresh.version_id);
          if (upd.changes !== 1) {
            // Optimistic-lock conflict — the retry loop above decides
            // whether to back off + try again or surface to the caller.
            throw new BalanceConflictError(pid, provider);
          }
          const ins = db
            .prepare(
              `INSERT INTO balance_entries
                 (persona_id, provider_id, balance, source, transfer_id,
                  ts, currency, exchange_rate)
               VALUES (?, ?, ?, 'manual', NULL, ?, ?, ?)`,
            )
            .run(
              pid,
              provider,
              balance,
              ts,
              currency ?? "BDT",
              currency === "USD" && exchangeRateBdt != null ? exchangeRateBdt : null,
            );
          return hydrate({
            id: Number(ins.lastInsertRowid),
            persona_id: pid,
            provider_id: provider,
            balance,
            source: "manual",
            transfer_id: null,
            ts,
            currency: currency ?? "BDT",
            exchange_rate:
              currency === "USD" && exchangeRateBdt != null
                ? exchangeRateBdt
                : null,
          });
        });
      },
      isBalanceConflict,
      APPEND_RETRY_POLICY,
    );
  }
}
