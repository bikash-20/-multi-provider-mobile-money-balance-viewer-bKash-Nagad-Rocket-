/**
 * App state reducer — single source of truth for the dashboard.
 *
 * The Total Balance header is NEVER stored. It's derived from the most
 * recent entry per provider on every render (see `selectors.ts`). This
 * prevents the classic drift bug where the header and the cards
 * disagree after a partial update.
 */

import type { AppState, BalanceEntry, Provider } from "./types";
import { SEED_ENTRIES } from "./seed";

export type Action =
  | {
      type: "update_balance";
      provider: Provider;
      balance: number;
      timestamp: string;
      id: string;
    }
  | { type: "reset" };

export const initialState: AppState = {
  entries: SEED_ENTRIES,
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "update_balance": {
      const entry: BalanceEntry = {
        id: action.id,
        provider: action.provider,
        balance: action.balance,
        timestamp: action.timestamp,
      };
      // Newest entries first — keeps the log readable and matches the
      // "prepend a row to Recent Entries" behaviour from section 5.
      return { entries: [entry, ...state.entries] };
    }
    case "reset":
      return { entries: SEED_ENTRIES };
  }
}