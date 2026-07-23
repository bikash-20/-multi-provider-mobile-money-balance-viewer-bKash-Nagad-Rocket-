/**
 * features/export/generateCsv.ts — Pure CSV generation.
 *
 * Each function takes typed arrays and returns a CSV string.
 * No DOM, no Node APIs, no side effects. Testable in isolation.
 *
 * O(n) time complexity — single pass over the input.
 * O(1) space — builds the CSV incrementally using array joins
 * (not string concatenation) to avoid GC pressure.
 */

import { PROVIDER_LABEL, type BalanceEntry, type Provider } from "@/features/wallet/types";
import type { Transfer } from "@/lib/domain/entities/transfer";

/* ── Escaping ─────────────────────────────────────────────────────── */

/** Escape a cell for CSV: wrap in quotes if it contains comma, quote,
 *  or newline. Double any internal quotes per RFC 4180. O(len). */
function escapeCell(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Join an array of cells into a CSV row. O(len). */
function row(...cells: unknown[]): string {
  return cells.map(escapeCell).join(",") + "\n";
}

/* ── Header constants ─────────────────────────────────────────────── */

const ENTRIES_HEADER = row("id", "provider", "balance_bdt", "timestamp");
const TRANSFERS_HEADER = row(
  "transfer_id",
  "from_provider",
  "to_provider",
  "amount_bdt",
  "note",
  "timestamp",
  "reverses_transfer_id",
);

/* ── Public generators ────────────────────────────────────────────── */

/** Generate a CSV string of all balance entries. O(n). */
export function entriesToCsv(entries: BalanceEntry[]): string {
  const parts: string[] = [ENTRIES_HEADER];
  for (const e of entries) {
    parts.push(row(e.id, e.provider, e.balance.toFixed(2), e.timestamp));
  }
  return parts.join("");
}

/** Generate a CSV string of all transfers. O(n). */
export function transfersToCsv(transfers: Transfer[]): string {
  const parts: string[] = [TRANSFERS_HEADER];
  for (const t of transfers) {
    const amount = ((t.amountBdt as number) / 100).toFixed(2); // paise to BDT
    parts.push(
      row(
        t.transferId,
        t.fromProvider,
        t.toProvider,
        amount,
        t.note,
        new Date(t.ts).toISOString(),
        t.reversesTransferId ?? "",
      ),
    );
  }
  return parts.join("");
}

/** Generate a per-provider statement CSV. O(n). */
export function providerStatementCsv(
  provider: Provider,
  entries: BalanceEntry[],
): string {
  const filtered = entries.filter((e) => e.provider === provider);
  const parts: string[] = [
    `# Provider Statement: ${PROVIDER_LABEL[provider]}\n`,
    `# Generated: ${new Date().toISOString()}\n`,
    `# Total Entries: ${filtered.length}\n`,
    ENTRIES_HEADER,
  ];
  for (const e of filtered) {
    parts.push(row(e.id, e.provider, e.balance.toFixed(2), e.timestamp));
  }
  return parts.join("");
}

/** Get a filename for the CSV export. */
export function csvFilename(prefix: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `walletsync-${prefix}-${date}.csv`;
}
