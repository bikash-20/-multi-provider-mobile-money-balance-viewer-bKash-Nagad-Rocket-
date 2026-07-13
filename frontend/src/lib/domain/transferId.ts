/**
 * lib/domain/transferId.ts — sortable, URL-safe transfer identifiers.
 *
 * UUIDv7 layout: 48-bit millisecond timestamp + 80 bits of randomness,
 * written as a 32-char lowercase hex string. Zero deps — uses
 * `crypto.getRandomValues` from the standard library. Sortable by
 * string comparison, replay-safe (PK on transfers.transfer_id), and
 * matches the LiquiGuard side's `gen_random_uuid()` / UUID primary keys.
 *
 * Tests can deterministically mint IDs via `withFixedTransferIdClock`.
 */
const HEX = "0123456789abcdef";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX[(b >>> 4) & 0xf];
    out += HEX[b & 0xf];
  }
  return out;
}

export type TransferIdT = string & { readonly __brand: "TransferId" };
export type AlertTokenT = string & { readonly __brand: "AlertToken" };

let pinnedMs: number | null = null;

function nowMs(): number {
  return pinnedMs ?? Date.now();
}

/** Test seam — pin the timestamp prefix used by newTransferId(). */
export function withFixedTransferIdClock(
  ms: number,
  fn: () => void,
): void {
  pinnedMs = ms;
  try {
    fn();
  } finally {
    pinnedMs = null;
  }
}

export function newTransferId(): TransferIdT {
  const tsMs = nowMs();
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  // 48-bit ms timestamp (12 hex chars) + 80 bits randomness (20 hex chars).
  const tsHex = tsMs.toString(16).padStart(12, "0");
  const randHex = bytesToHex(rand);
  return (`${tsHex}${randHex}` as TransferIdT);
}

/** Stable AlertToken used by the FSM to de-dup advisories across calls. */
export function newAlertToken(): AlertTokenT {
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);
  return bytesToHex(rand) as AlertTokenT;
}
