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

## 4. State & data model (v1, no backend)

Use React state (`useReducer`) held at the page level, passed down. No
`localStorage` / `sessionStorage` for app data — if persistence across reloads
matters for the demo, that's a backend-phase concern, not v1.

> Note on `localStorage`: the spec's "no localStorage" rule applies to
> **app data** (balance entries). Theme preference is a UI concern and is
> permitted to persist under the `walletsync.theme` key — same category as
> remembering a scroll position or a panel collapsed state.

```ts
interface BalanceEntry {
  id: string;
  provider: "bkash" | "nagad" | "rocket";
  balance: number;
  timestamp: string; // ISO
}

interface AppState {
  entries: BalanceEntry[]; // append-only log
  // current balance per provider = most recent entry for that provider
}
```

Seed with 3 mock entries on load (one per provider, plausible BDT amounts) so
the dashboard never looks empty on first render.

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

- [x] Loads with 3 seeded provider balances and a non-empty Recent Entries log.
- [x] Editing any one provider's balance updates: that card, the Total header,
      and adds one row to Recent Entries.
- [x] Theme toggle (light / dark / system) works identically to LiquiGuard's
      implementation, no flash-of-unstyled-theme on reload.
- [x] No console errors, no network calls to any bKash / Nagad / Rocket domain.
- [x] Fully usable on a phone-width viewport (this is a "check my balance" app —
      mobile is the primary surface).
- [x] No `localStorage` / `sessionStorage` used for app data in v1.

---

## 7. What's explicitly deferred to "backend phase"

- Persisting entries across reloads (needs a backend + DB, mirrors LiquiGuard's
  Postgres pattern).
- Multi-device sync.
- Any real provider connectivity (still not available even then — revisit only
  if Bangladesh Bank or providers open a consumer API).
- Auth / login (learn from LiquiGuard hackathon feedback — get this right
  early if it's added, don't bolt it on late).