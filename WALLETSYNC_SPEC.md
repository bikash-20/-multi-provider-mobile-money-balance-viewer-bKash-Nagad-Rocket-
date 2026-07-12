# WalletSync — Frontend Build Spec (v1)

**Project type:** Demo / portfolio app — personal multi-provider mobile money
balance viewer (bKash / Nagad / Rocket)
**Status:** Frontend first, backend later
**Design system:** Reuse the LiquiGuard token system exactly (see
[`docs/00_README.md`](./docs/00_README.md) for the originating brief) — do not
invent a new palette.

---

## 0. Non-goals (read this before writing any code)

- **No real bKash / Nagad / Rocket API calls.** These providers do not expose
  a personal-balance-read API. Do not attempt OAuth, screen-scraping, or SMS
  parsing in this build. All data is manually entered or seeded as mock data.
- **No PII fields.** No phone numbers, no NID, no names tied to real people.
  If a "linked account" concept is needed, use an opaque label the user types
  themselves (e.g. "My bKash").
- **No backend dependency for v1.** The entire frontend must run and demo
  correctly with in-memory / local state only. Backend wiring is a separate
  phase — don't block on it.
- **Not a payment app.** No send / receive money flows. This is read-only
  balance tracking plus a manual transaction log.

---

## 1. Tech stack (match LiquiGuard, don't diverge)

- **Next.js (App Router)**, **TypeScript**, same repo conventions as the
  LiquiGuard `frontend/`.
- **Tailwind**, but only via the existing CSS-variable tokens
  (`bg-surface`, `text-ink`, `text-muted`, `border-border`, `signal`) — no
  new raw hex colors.
- Reuse the existing theme system as-is: `THEME_BOOT` inline script in
  `app/layout.tsx`, `localStorage` key pattern (`walletsync.theme` to avoid
  collision with `liquiguard.theme` if these ever share a device),
  light → dark → system cycle.
- PWA shell optional for v1 — skip unless time permits; not core to the demo.

---

## 2. Design tokens (copy from LiquiGuard, do not restyle)

| Token         | Use                                    |
| ------------- | -------------------------------------- |
| `bg-surface`  | Card / panel backgrounds               |
| `text-ink`    | Primary text                           |
| `text-muted`  | Secondary / meta text (timestamps)     |
| `border-border` | Card borders, dividers               |
| `signal`      | Accent color for positive / highlight  |

Per-provider accent colors (bKash `#E0447A`, Nagad `#E0883B`, Rocket `#8B7FE8`)
are defined in `tailwind.config.js` and exposed as `bg-bkash`, `bg-nagad`,
`bg-rocket` — consumed unchanged from the LiquiGuard palette.

Dark palette = the existing "financial command center" look (dark background,
high-contrast numerals, monospace-leaning figures for currency). Light palette =
same structure, white surface. No new visual language — if it doesn't exist as
a token in LiquiGuard, don't add it without asking first.

---

## 3. Information architecture

Single-page dashboard, three sections stacked vertically (mobile-first, since
this mirrors a wallet-checking use case):

```
┌─────────────────────────────────┐
│  Total Balance (all providers)  │  ← hero number, largest text on page
├─────────────────────────────────┤
│  Provider Card: bKash           │
│  Provider Card: Nagad           │
│  Provider Card: Rocket          │
├─────────────────────────────────┤
│  Recent Entries (log)           │
└─────────────────────────────────┘
```

### 3.1 Total Balance header

- Large numeral, sum of all three provider balances, BDT formatting
  (e.g. `৳12,450.00`).
- Small caption underneath: "Manually tracked · updated {relative time}" —
  updates whenever any entry changes.
- Do not call this a "wallet balance" in a way that implies live sync —
  caption should read like "as entered" language.

### 3.2 Provider Card (×3: bKash, Nagad, Rocket)

Each card shows:

- Provider name + a small colored dot or badge (each provider gets a distinct
  accent, reusing the per-provider mapping defined in the design tokens).
- Current balance, large numeral.
- Small "Update balance" button → opens an inline edit (tap number, becomes an
  input, confirm / cancel).
- Small ghost-text below balance: "Updated {relative time}".

Component: `ProviderBalanceCard.tsx`

```ts
interface ProviderBalanceCardProps {
  provider: "bkash" | "nagad" | "rocket";
  balance: number;
  lastUpdated: string; // ISO timestamp
  onUpdate: (newBalance: number) => void;
}
```

### 3.3 Recent Entries log

- Reverse-chronological list of balance updates across all providers.
- Each row: provider badge, old → new balance, timestamp.
- Reuses the "evidence panel" visual pattern from LiquiGuard (compact,
  collapsible on mobile) — same collapse / expand interaction, not a new
  pattern.
- Empty state: friendly placeholder text, not a blank void — e.g.
  "No entries yet. Update a balance above to get started."

---

## 4. State & data model

Two layers. The server (SQLite via Next.js API routes — see §8) is the
source of truth for the entries log; the page holds a local mirror for
the duration of a session. The mirror is what gets optimistically
updated and rendered; the server is what gets re-fetched on mount.

### 4.1 Server-side record

```ts
interface BalanceEntry {
  id: string;          // crypto.randomUUID(), server-assigned
  provider: "bkash" | "nagad" | "rocket";
  balance: number;     // non-negative finite
  timestamp: string;   // ISO 8601, server-assigned (new Date().toISOString())
}
```

### 4.2 Client mirror

```ts
interface AppState {
  entries: BalanceEntry[]; // append-only log, newest first
}
```

`useReducer` at the page level. The Total Balance header and per-card
current balances are always **derived** from the most recent entry per
provider (see `selectors.ts`) — never stored as separate fields.

> Note on `localStorage`: the spec's "no localStorage" rule applies to
> **app data** (balance entries). Theme preference is a UI concern and is
> permitted to persist under the `walletsync.theme` key — same category as
> remembering a scroll position or a panel collapsed state.

### 4.3 Reducer actions

```ts
type Action =
  | { type: "set_entries"; entries: BalanceEntry[] }                 // GET result lands
  | { type: "update_balance"; id, provider, balance, timestamp }     // optimistic append
  | { type: "remove_entry"; id };                                    // optimistic rollback on POST failure
```

Empty `entries: []` is the initial state — the server provides the real
contents on first GET. Anything else here would be lying on the first
render.

---

## 5. Interaction spec

- Tapping a provider's balance number turns it into an editable numeric input,
  pre-filled with current value, decimal-aware, BDT.
- **Confirm** (checkmark icon or Enter key) → appends a new `BalanceEntry`,
  updates the card, updates the Total, prepends a row to Recent Entries.
- **Cancel** (X icon or Escape key) → reverts to display state, no state
  mutation.
- Reject negative numbers and non-numeric input inline (small red helper text
  under the input); don't allow submission until valid.
- Total Balance header re-renders reactively from the three current balances —
  **never stored as its own separate state** (avoid drift bugs).

---

## 6. Acceptance criteria

- [x] Loads with an empty Recent Entries log on first run (the server is
      the source of truth — no seed data is shipped).
- [x] After typing values into the three provider cards, reloading the
      page preserves them (proves SQLite persistence across restarts).
- [x] Editing any one provider's balance updates: that card, the Total header,
      and adds one row to Recent Entries — all without waiting for the
      server (optimistic update).
- [x] If the POST to /api/entries fails, the optimistic row is rolled back
      and an inline error appears (graceful degradation, no half-saved state).
- [x] Server-side validation rejects: bad provider, negative balance,
      non-finite balance, non-object body, malformed JSON (all → 400 with
      a human-readable message).
- [x] Theme toggle (light / dark / system) works identically to LiquiGuard's
      implementation, no flash-of-unstyled-theme on reload.
- [x] No console errors, no network calls to any bKash / Nagad / Rocket domain.
- [x] Fully usable on a phone-width viewport (this is a "check my balance" app —
      mobile is the primary surface).
- [x] No `localStorage` / `sessionStorage` used for app data.

---

## 7. Still explicitly deferred (post backend phase)

- Multi-device sync (would need an account model — see below).
- Any real provider connectivity (still not available — revisit only if
  Bangladesh Bank or providers open a consumer API).
- Auth / login (learn from LiquiGuard hackathon feedback — get this right
  early if it's added, don't bolt it on late).
- Encryption at rest — the SQLite file is plain. Fine for a single-user
  local app, not fine once there's any shared host.
---

## 8. Backend phase — v1.1 (this update)

A minimal persistence layer so the demo survives a page reload. Single
process, single user, no auth — the explicit scope ceiling.

### 8.1 What changed

- New: `frontend/src/lib/db.ts` — single swap-point for the database.
  Cached singleton, schema bootstrap, env-overridable path.
- New: `frontend/src/lib/entriesRepo.ts` — `listEntries()` + `appendEntry()`.
- New: `frontend/src/app/api/entries/route.ts` — `GET` / `POST` handlers.
- New: `frontend/scripts/db-reset.mjs` — wipe the local DB (npm script `db:reset`).
- Updated: `frontend/src/app/page.tsx` — fetches on mount, optimistic
  dispatch on update, rollback on POST failure.
- Updated: `frontend/src/features/wallet/reducer.ts` — empty initial
  state, new `set_entries` / `remove_entry` actions.
- Updated: `frontend/src/features/wallet/ProviderBalanceCard.tsx` —
  accepts optional `balance` / `lastUpdated` (renders "—" / "No entries yet"
  when there's nothing to show), `disabled` / `pending` props.
- Updated: `frontend/src/features/wallet/seed.ts` — replaced with an
  empty module (server is authoritative; demo data is entered by hand).

### 8.2 Database

- Engine: **SQLite** via `better-sqlite3 ^11.3.0`. Synchronous, embedded,
  one file, no external service.
- Location: `<repo-root>/data/walletsync.db`. Override with the
  `WALLETSYNC_DB_PATH` environment variable for deploy targets that
  expose a writable volume.
- Mode: WAL (`journal_mode = WAL`), foreign keys ON.
- Schema:

  ```sql
  CREATE TABLE balance_entries (
    id        TEXT PRIMARY KEY,
    provider  TEXT NOT NULL CHECK (provider IN ('bkash','nagad','rocket')),
    balance   REAL NOT NULL CHECK (balance >= 0),
    timestamp TEXT NOT NULL
  );
  CREATE INDEX idx_balance_entries_provider_ts
    ON balance_entries (provider, timestamp DESC);
  ```

  No `UPDATE` / `DELETE` paths exist in the app. The log is append-only
  per the original §4 rule. The most recent row per provider is the
  current balance.

### 8.3 API surface

| Method | Path           | Body                              | Response                              |
| ------ | -------------- | --------------------------------- | ------------------------------------- |
| GET    | `/api/entries` | —                                 | `200`, `BalanceEntry[]` (newest first) |
| POST   | `/api/entries` | `{ provider, balance }`           | `201`, `BalanceEntry` (server-assigned id, timestamp) |
| POST   | `/api/entries` | invalid provider / negative / non-finite balance / non-JSON / non-object | `400`, `{ error }` |

The client never sets `id` or `timestamp` — both are server-generated.

### 8.4 Optimistic-update flow

1. User confirms a new balance.
2. Client dispatches `update_balance` immediately (entry appears in the UI
   with a local `id` and the current `timestamp`).
3. Client POSTs to `/api/entries`.
4. On `2xx`, do nothing (the local row matches what the server now has).
5. On failure, dispatch `remove_entry` with the local `id` and show an
   inline error banner. The optimistic row vanishes; the previous state
   is restored.

The point: the user never waits for the network. The worst-case failure
mode is a row that briefly appeared and then disappeared, with an
explanation. The store is never half-written.

### 8.5 Out of scope (still)

- No accounts, no login, no per-user rows.
- No multi-device sync.
- No optimistic appending from multiple tabs (would need SSE or
  polling — both deferred).
- No migration tooling beyond `CREATE TABLE IF NOT EXISTS`. Schema
  changes ship as a new SQL file applied manually (the same shape
  LiquiGuard uses).

### 8.6 Local dev

```bash
cd frontend
npm install
npm run dev        # http://localhost:3001
npm run db:reset   # wipes data/walletsync.db (+ -journal, -wal, -shm)
```

The SQLite file lives outside `frontend/`, so `npm run build` does not
include it in the bundle and `.gitignore` keeps it out of git. The
folder itself is tracked via `data/.gitkeep` so a fresh clone still
has a place for the file to live.
