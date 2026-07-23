/**
 * features/currency/types.ts — Currency-related types.
 *
 * These types are shared between server and client components.
 * No server-only imports (better-sqlite3, node:*) in this file.
 */

/** Supported currencies for balance entries. */
export type Currency = "BDT" | "USD";

/** Display metadata for currencies. */
export interface CurrencyMeta {
  code: Currency;
  symbol: string;
  name: string;
  /** Number of decimal places for display. */
  decimals: number;
  /** Locale for formatting. */
  locale: string;
}

export const CURRENCIES: Record<Currency, CurrencyMeta> = {
  BDT: {
    code: "BDT",
    symbol: "৳",
    name: "Bangladeshi Taka",
    decimals: 2,
    locale: "en-BD",
  },
  USD: {
    code: "USD",
    symbol: "$",
    name: "US Dollar",
    decimals: 2,
    locale: "en-US",
  },
};

/** Check if a string is a valid Currency. */
export function isCurrency(x: unknown): x is Currency {
  return x === "BDT" || x === "USD";
}
