# WalletSync — Multi-Provider Mobile Money Balance Viewer

A manually-tracked, read-only balance viewer for **bKash**, **Nagad**, and **Rocket**.
Web app, mobile-first, no provider API calls, no PII, no backend dependency for v1.

This repo is the standalone home for the WalletSync project. The frontend lives in
[`frontend/`](./frontend). The original LiquiGuard design and product brief that
WalletSync descends from is preserved in [`docs/`](./docs) so the project's history
stays in one place.

## v1 scope

- Single-page dashboard: total balance, one card per provider, recent-entries log
- Manually entered balances only — no real provider connectivity
- All state in memory; reload starts from seed data
- Light / dark / system theme toggle, persisted across reloads
- No authentication, no payments, no transaction history beyond what the user enters

See [`WALLETSYNC_SPEC.md`](./WALLETSYNC_SPEC.md) for the full v1 brief.

## Repository layout

```
.
├── README.md                    # you are here
├── WALLETSYNC_SPEC.md           # v1 build spec (single source of truth)
├── docs/                        # LiquiGuard context — domain, architecture, data flow
└── frontend/                    # Next.js + TypeScript app (run this)
```

## Quick start

```bash
cd frontend
npm install
npm run dev      # http://localhost:3001
```

Build:

```bash
npm run build
npm start
```

Typecheck / lint:

```bash
npm run typecheck
npm run lint
```

## Status

v1 frontend complete. Backend phase (persistence, multi-device sync) is deferred
and documented at the bottom of `WALLETSYNC_SPEC.md`.

## Credits

Built and maintained by **Bikash Talukder** ([bikashtalukder040@gmail.com](mailto:bikashtalukder040@gmail.com)).
Originally prototyped as part of the **bKash presents SUST CSE Carnival 2026** hackathon.
The LiquiGuard domain documents in `docs/` were authored during that hackathon and
are preserved here unchanged.