/**
 * Domain types for the WalletSync dashboard.
 *
 * v1 is strictly read-only — no transactions, no transfers, no PII.
 * A "linked account" is an opaque label the user types themselves
 * (e.g. "My bKash"), never a phone number / NID / real name.
 */

export type Provider = "bkash" | "nagad" | "rocket";

/** All three providers are tracked. The order here defines the render
 *  order on the dashboard (top → bottom). */
export const PROVIDERS: Provider[] = ["bkash", "nagad", "rocket"];

export const PROVIDER_LABEL: Record<Provider, string> = {
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
};

/** Tailwind class for the per-provider accent dot (mirrors LiquiGuard). */
export const PROVIDER_DOT_CLASS: Record<Provider, string> = {
  bkash: "provider-dot-bkash",
  nagad: "provider-dot-nagad",
  rocket: "provider-dot-rocket",
};

/** Tailwind class for the 2px top hairline gradient on each card. */
export const PROVIDER_HAIRLINE_CLASS: Record<Provider, string> = {
  bkash: "hairline-bkash",
  nagad: "hairline-nagad",
  rocket: "hairline-rocket",
};

/** Raw hex used in inline styles where Tailwind class would not work
 *  (e.g. dot on a Recent Entries row). Matches tailwind.config.js. */
export const PROVIDER_HEX: Record<Provider, string> = {
  bkash: "#E0447A",
  nagad: "#E0883B",
  rocket: "#8B7FE8",
};

export interface BalanceEntry {
  id: string;
  provider: Provider;
  /** New balance as of `timestamp`. */
  balance: number;
  /** ISO 8601 timestamp string. */
  timestamp: string;
}

export interface AppState {
  /** Append-only log. Current balance per provider = the most recent entry
   *  for that provider, or undefined if none exists yet. */
  entries: BalanceEntry[];
}
