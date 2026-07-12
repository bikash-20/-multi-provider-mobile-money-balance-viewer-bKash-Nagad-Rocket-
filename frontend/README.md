# WalletSync — Frontend

Next.js + TypeScript + Tailwind. Mobile-first dashboard for manually-tracked
bKash / Nagad / Rocket balances.

## Run

```bash
npm install
npm run dev          # http://localhost:3001
```

Other scripts:

```bash
npm run build        # production build
npm start            # serve the production build on :3001
npm run typecheck    # tsc --noEmit
npm run lint         # next eslint config
```

## Layout

```
src/
├── app/
│   ├── layout.tsx       # fonts, THEME_BOOT inline script, <html lang="en">
│   ├── page.tsx         # dashboard (reducer + 3 components)
│   └── globals.css      # theme tokens, hairline gradients, hero-total
├── features/
│   ├── shell/
│   │   ├── AppShell.tsx       # minimal header + ThemeToggle
│   │   ├── ThemeToggle.tsx    # light → dark → system cycle
│   │   └── themeStore.ts      # zustand + persist, key "walletsync.theme"
│   └── wallet/
│       ├── ProviderBalanceCard.tsx   # per-provider card + inline edit
│       ├── TotalBalanceHeader.tsx    # hero number
│       ├── RecentEntries.tsx         # collapsible log with old→new deltas
│       ├── reducer.ts                # update_balance action
│       ├── seed.ts                   # 3 mock entries
│       ├── selectors.ts              # grandTotal, latestFor, lastUpdatedAt
│       └── types.ts                  # Provider, BalanceEntry, AppState
└── lib/
    └── time.ts            # formatRelative(iso), formatBDT(n)
```

## Theme

Persists to `walletsync.theme` in `localStorage` (namespaced from
`liquiguard.theme`). The inline `THEME_BOOT` script in `app/layout.tsx` applies
the matching `.dark` class to `<html>` before React hydrates — no flash of
wrong theme on reload.

## Non-goals (v1)

No real provider API calls, no PII, no backend. See [`../WALLETSYNC_SPEC.md`](../WALLETSYNC_SPEC.md)
for the full v1 brief and what's deferred to the backend phase.