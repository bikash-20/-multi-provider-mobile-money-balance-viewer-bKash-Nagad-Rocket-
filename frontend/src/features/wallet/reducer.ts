/**
 * App state reducer — single source of truth for the dashboard.
 *
 * The Total Balance header is NEVER stored. It's derived from the most
 * recent entry per provider on every render (see `selectors.ts`). This
 * prevents the classic drift bug where the header and the cards
 * disagree after a partial update.
 *
 * Backend phase (spec §8): entries come from the server. The reducer
 * still owns local state for the duration of a session; the new
 * `remove_entry` action exists so the page can roll back an optimistic
 * append if the POST fails.
 */

import type { AppState, BalanceEntry, Provider } from "./types";

export type Action =
  | { type: "set_entries"; entries: BalanceEntry[] }
  | {
      type: "update_balance";
      provider: Provider;
      balance: number;
      timestamp: string;
      id: string;
    }
  | { type: "remove_entry"; id: string };

/** Empty initial state — the server provides the entries on first GET.
 *  Anything else here would be lying on the first render. */
export const initialState: AppState = {
  entries: [],
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "set_entries": {
      // Server is authoritative; replace whatever was here.
      return { entries: action.entries };
    }
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
    case "remove_entry": {
      // Used for optimistic-rollback when the POST to /api/entries fails.
      return {
        entries: state.entries.filter((e) => e.id !== action.id),
      };
    }
  }
}
