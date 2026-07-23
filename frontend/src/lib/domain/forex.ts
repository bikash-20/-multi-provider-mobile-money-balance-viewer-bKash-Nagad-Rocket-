/**
 * lib/domain/forex.ts — Exchange rate fetching and conversion.
 *
 * Uses the Frankfurter API (free, no key required) for live rates.
 * Falls back to a configurable default rate when the API is unreachable.
 *
 * Design:
 *  - getRate(): fetches from Frankfurter, caches in module memory for 1 hour
 *  - convertToBdt(): converts a USD amount to BDT using the cached rate
 *  - formatUsd(): formats USD amounts with $ symbol
 *
 * The module-level cache avoids hitting the API on every keystroke while
 * keeping the displayed rate fresh enough for a manual-entry tracker.
 *
 * Thread safety: Node.js is single-threaded, so the cache read/write is
 * safe without locks. Two concurrent requests could both fetch; the
 * second fetch just overwrites the cache — harmless.
 */

const API_BASE = "https://api.frankfurter.app";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FALLBACK_USD_BDT = 110; // approximate rate when API is unreachable
const PAISE_PER_UNIT = 100; // smallest unit per major currency

interface RateCache {
  rate: number;
  fetchedAt: number;
}

let cache: RateCache | null = null;

/**
 * Fetch the USD → BDT exchange rate.
 *
 * Strategy:
 *  1. Return cached rate if fresh (< 1 hour old).
 *  2. Fetch from Frankfurter API (free, no key).
 *  3. On success, update cache and return.
 *  4. On failure, return fallback rate (but DON'T cache it — retry on
 *     next call).
 *
 * Returns the rate as BDT per 1 USD (e.g., 110.50).
 */
export async function getUsdBdtRate(): Promise<number> {
  // 1. Fresh cache hit.
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rate;
  }

  // 2. Try Frankfurter API.
  try {
    const url = `${API_BASE}/latest?from=USD&to=BDT`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      throw new Error(`Frankfurter returned ${res.status}`);
    }

    const data = (await res.json()) as { rates: Record<string, number> };
    const rate = data.rates?.BDT;

    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Invalid BDT rate: ${String(rate)}`);
    }

    cache = { rate, fetchedAt: Date.now() };
    return rate;
  } catch {
    // 3. API unreachable — return fallback but don't cache so we retry
    //    on the next call.
    return FALLBACK_USD_BDT;
  }
}

/**
 * Force-refresh the rate cache (e.g., when the user explicitly requests
 * it). Clears the cache so the next call to getUsdBdtRate() fetches
 * fresh data.
 */
export function clearForexCache(): void {
  cache = null;
}

/**
 * Convert a USD amount (in major units like 100.50) to BDT.
 * @param usdAmount — Amount in USD (e.g., 100.50 for $100.50)
 * @param rate — Optional explicit rate (uses live rate if omitted)
 */
export async function usdToBdt(
  usdAmount: number,
  rate?: number,
): Promise<number> {
  const r = rate ?? (await getUsdBdtRate());
  return usdAmount * r;
}

/**
 * Convert an amount in any currency to a BDT amount for the grand total.
 * @param amount — Amount in the entry's currency (major units)
 * @param currency — 'BDT' or 'USD'
 * @param rate — USD→BDT rate (used only for USD entries)
 */
export async function toBdtForTotal(
  amount: number,
  currency: "BDT" | "USD",
  rate?: number,
): Promise<number> {
  if (currency === "BDT") return amount;
  return usdToBdt(amount, rate);
}

/**
 * Convert paise/cents back to major units for display.
 */
export function toMajorUnits(smallestUnits: number): number {
  return smallestUnits / PAISE_PER_UNIT;
}

/* ── Formatting ───────────────────────────────────────────────────── */

/**
 * Format a USD amount for display. e.g. 100.5 → "$100.50"
 */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  const fixed = n.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${withCommas}.${decPart}`;
}

/**
 * Format a BDT-equivalent hint for display. e.g. 11050 → "≈ ৳11,050.00"
 */
export function formatBdtEquivalent(bdtAmount: number): string {
  if (!Number.isFinite(bdtAmount) || bdtAmount <= 0) return "";
  const fixed = bdtAmount.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `≈ ৳${withCommas}.${decPart}`;
}
