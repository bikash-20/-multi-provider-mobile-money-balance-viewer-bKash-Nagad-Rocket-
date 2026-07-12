# WalletSync — Multi-Provider Mobile Money Balance Viewer

A manually-tracked, read-only balance viewer for **bKash**, **Nagad**, and **Rocket**.
Web app, mobile-first, no provider API calls, no PII.

This repo is the standalone home for the WalletSync project. The frontend lives in
[`frontend/`](./frontend). The original LiquiGuard design and product brief that
WalletSync descends from is preserved in [`docs/`](./docs) so the project's history
stays in one place.

## What's in this build

- Single-page dashboard: total balance, one card per provider, recent-entries log
- Manually entered balances only — no real provider connectivity
- Local SQLite persistence via Next.js API routes (`GET` / `POST /api/entries`)
- Optimistic updates with rollback on POST failure — never half-saves
- Light / dark / system theme toggle, persisted across reloads
- No authentication, no payments, no multi-device sync — explicitly out of scope

See [`WALLETSYNC_SPEC.md`](./WALLETSYNC_SPEC.md) for the full spec (v1 UI + v1.1 backend phase — §8).

## Repository layout

```
.
├── README.md                    # you are here
├── WALLETSYNC_SPEC.md           # full spec: v1 UI + v1.1 backend phase (§8)
├── data/                        # local SQLite db (gitignored; .gitkeep tracks the folder)
├── docs/                        # LiquiGuard context — domain, architecture, data flow
└── frontend/                    # Next.js + TypeScript app (run this)
```

## Quick start

```bash
cd frontend
npm install
npm run dev      # http://localhost:3001
```

The app boots with an empty Recent Entries log (the server is
authoritative — no seed data). Type values into the three provider cards
and they're written to `../data/walletsync.db`. They survive a page
reload, a server bounce, and a fresh clone of the repo (the db is
gitignored; only the `data/` folder is tracked via `.gitkeep`).

Wipe the local DB:

```bash
npm run db:reset
```

Point at a writable volume on a deploy target:

```bash
export WALLETSYNC_DB_PATH=/var/data/walletsync.db
npm run dev
```

Build / typecheck / lint:

```bash
npm run build
npm run typecheck
npm run lint
```

## Status

v1 frontend + v1.1 backend (SQLite + Next.js API routes) are both shipped here.
Multi-device sync and auth remain explicitly deferred — see
`WALLETSYNC_SPEC.md` §7.

## Credits

Built and maintained by **Bikash Talukder** ([bikashtalukder040@gmail.com](mailto:bikashtalukder040@gmail.com)).
Originally prototyped as part of the **bKash presents SUST CSE Carnival 2026** hackathon.
The LiquiGuard domain documents in `docs/` were authored during that hackathon and
are preserved here unchanged.