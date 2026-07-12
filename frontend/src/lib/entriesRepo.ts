/**
 * lib/entriesRepo.ts — repository for balance entries.
 *
 * This is the only place the app talks to the persistence layer. The
 * API route and any future server-side consumer go through here. The
 * function signatures deliberately look like what a Postgres-backed
 * implementation would expose, so a future swap (see `lib/db.ts`) is
 * mechanical.
 */
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { BalanceEntry, Provider } from "@/features/wallet/types";

interface Row {
  id: string;
  provider: Provider;
  balance: number;
  timestamp: string;
}

function rowToEntry(row: Row): BalanceEntry {
  return {
    id: row.id,
    provider: row.provider,
    balance: row.balance,
    timestamp: row.timestamp,
  };
}

/** Return all entries, newest-first. */
export function listEntries(): BalanceEntry[] {
  const rows = getDb()
    .prepare<[], Row>(
      "SELECT id, provider, balance, timestamp FROM balance_entries ORDER BY timestamp DESC, id DESC",
    )
    .all();
  return rows.map(rowToEntry);
}

/** Append a single entry. Server assigns id + timestamp — the client
 *  only supplies provider + balance. Returns the persisted entry. */
export function appendEntry(
  provider: Provider,
  balance: number,
): BalanceEntry {
  const entry: BalanceEntry = {
    id: randomUUID(),
    provider,
    balance,
    timestamp: new Date().toISOString(),
  };
  getDb()
    .prepare(
      "INSERT INTO balance_entries (id, provider, balance, timestamp) VALUES (@id, @provider, @balance, @timestamp)",
    )
    .run(entry);
  return entry;
}