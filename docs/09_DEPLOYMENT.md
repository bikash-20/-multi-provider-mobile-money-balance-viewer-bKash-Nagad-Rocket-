# 09 — Deployment

This document is the operator-facing deploy guide. The README
"Deployment" section is the short version; this is the long one.

## TL;DR

| Host          | One click?                    | SQLite persistent? | Recommended? |
| ------------- | ----------------------------- | ------------------ | ------------ |
| Render        | yes (`render.yaml`)           | yes (disk)         | **yes**      |
| Vercel        | yes (`vercel.json`)           | **no** (read-only) | for preview only |

If you just want to try the demo end-to-end without reading further:
**click the Render button**. Render provisions the service + a
persistent disk for the SQLite file in one click.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/bikash-20/-multi-provider-mobile-money-balance-viewer-bKash-Nagad-Rocket-)

After deploy, seed demo data:

```bash
# Replace $URL with your Render service URL.
WALLETSYNC_URL=https://walletsync.onrender.com npm --prefix frontend run db:seed
```

…then open `$URL` in a browser.

---

## Why Render, not Vercel?

WalletSync ships **SQLite inside the container**. SQLite is a single
embedded file under `data/walletsync.db`. To persist it across
restarts you need a **mounted persistent volume**. Where SQLite
works:

- ✅ Render (Web Service + Disk)
- ✅ Fly.io (volume)
- ✅ Railway (volume)
- ✅ A plain VM (Docker, plain Linux)
- ❌ Vercel (serverless functions, filesystem is ephemeral and
  often read-only — second request gets a fresh container)
- ❌ Cloud Run (no persistent disk attached by default)
- ❌ AWS Lambda, Azure Functions, etc.

Vercel still works for the **read paths** — the UI will render and
even `/api/health` will respond — but anything you click (a transfer,
a manual balance edit) will not survive the next request. Don't use
Vercel for a demo that involves writing data.

For the v1.5 demo this is the right trade-off: Render is free,
the disk is free, and the deploy is one click.

---

## Render — step by step

### One-click (preferred)

1. Fork the repo.
2. Open
   <https://render.com/deploy?repo=https://github.com/bikash-20/-multi-provider-mobile-money-balance-viewer-bKash-Nagad-Rocket->.
3. Confirm the service name + region. Render reads `render.yaml`
   from the repo root; no further config is needed.
4. Click **Apply**. Render builds and deploys.

First deploy takes ~3 minutes (free tier is cold-start slow; npm
install is the bulk of it).

### Manual (Dashboard)

If you'd rather not use the Blueprint:

1. Render Dashboard → **New +** → **Web Service**.
2. Connect the GitHub repo.
3. Settings:
   - **Environment:** `Node`
   - **Region:** `Oregon` (cheapest free tier)
   - **Branch:** `main`
   - **Build Command:**
     ```bash
     cd frontend && npm ci && npm run build
     ```
   - **Start Command:**
     ```bash
     cd frontend && npm run start
     ```
   - **Health Check Path:** `/api/health`
4. **Advanced** → add a **Disk**:
   - **Name:** `walletsync-data`
   - **Mount Path:** `/var/data`
   - **Size:** `1 GB` (more than enough)
5. **Environment Variables:**
   | Key                    | Value                       |
   | ---------------------- | --------------------------- |
   | `NODE_ENV`             | `production`                |
   | `WALLETSYNC_DB_PATH`   | `/var/data/walletsync.db`   |
   | `NODE_OPTIONS`         | `--max-old-space-size=384`  |
6. Click **Create Web Service**.

### What Render actually does

Render maps `$PORT` automatically. Our `npm start` script is
`next start -p ${PORT:-3001}`, so `$PORT` (usually `10000` on the
free tier) becomes the bind port. Render also exposes `/api/health`
to its liveness probe; if `/api/health` returns 503 (`status:"down"`)
for more than a couple of minutes, Render restarts the container.

### Seed data after deploy

The CLI runs locally but writes through to the deployed DB via the
HTTP API. From your laptop:

```bash
git clone https://github.com/<you>/-multi-provider-mobile-money-balance-viewer-bKash-Nagad-Rocket-.git
cd -multi-provider-mobile-money-balance-viewer-bKash-Nagad-Rocket-
WALLETSYNC_URL=https://walletsync.onrender.com npm --prefix frontend run db:seed
```

Output should end with `✓ seeded N entries across M days`.

> The seed CLI needs read-write access to the SQLite file. With
> Render's free tier, the SQLite file lives on the disk only —
> there's no admin URL for it. So the seed CLI goes through the
> app's HTTP API rather than touching the file directly. **If you
> ever switch to a setup where the DB lives elsewhere (Postgres,
> Turso, etc.), update `scripts/seed-demo-data.mjs` to point at
> the new DB location.**

### Verify it's working

```bash
curl -s https://walletsync.onrender.com/api/health | jq
```

You should see something like:

```json
{
  "status": "ok",
  "version": "0.4.0",
  "uptimeSeconds": 42,
  "now": "2026-07-14T...",
  "db": {
    "open": true,
    "writesOk": true,
    "personaCount": 3,
    "activePersona": "freelancer",
    "entryCount": 243,
    "transferCount": 0,
    "error": null
  }
}
```

If `status` is `degraded`, the DB is readable but **not** writable —
almost certainly a missing disk. If `status` is `down`, the API
couldn't connect to the DB at all — check `WALLETSYNC_DB_PATH`.

---

## Vercel — preview only

```bash
# From the repo root
npx vercel deploy --prod
```

`vercel.json` at the repo root points Vercel at `frontend/`. The
build will succeed and the dashboard will render. **Writes will not
persist.** The `/api/health` endpoint will report
`db.writesOk: false`.

Vercel is fine for:
- Showing the UI to someone who isn't writing data.
- Validating that the prod build runs.
- Reviewing the visuals.

Vercel is **not** fine for:
- Demoing a transfer or balance edit and reloading the page.
- Any flow that depends on per-session state.

---

## Environment variable matrix

| Var                    | Required? | Default              | Notes                                |
| ---------------------- | --------- | -------------------- | ------------------------------------ |
| `PORT`                 | no        | `3001`               | Injected by Render; honored by `npm start`. Local dev uses `3001` for consistency. |
| `NODE_ENV`             | yes (prod)| unset                | Set to `production` on Render.       |
| `WALLETSYNC_DB_PATH`   | no        | `data/walletsync.db` | Set to a disk-mounted path on Render. |
| `NODE_OPTIONS`         | no        | unset                | `--max-old-space-size=384` recommended for free tier. |

The app **reads no secrets**; there are no API keys for provider
integrations because WalletSync is intentionally offline-only
(manual entry).

---

## Smoke-checking a deploy

```bash
WALLETSYNC_URL=https://walletsync.onrender.com npm --prefix frontend run smoke
```

Output (passing):

```
🔎 WalletSync smoke check against https://walletsync.onrender.com

✓ Dashboard SSR        200        84ms  /
✓ Health probe         200        12ms  /api/health
    └─ health.status=ok db.open=true db.writesOk=true
✓ Meta snapshot        200         7ms  /api/meta
✓ Entries page-1       200        10ms  /api/entries
✓ Transfers page-1     200         6ms  /api/transfers

✅ All checks passed in 119ms
```

Wire this into a Render **post-deploy hook** or GitHub Action to
make every deploy self-verifying.

---

## Troubleshooting

### Symptom: `/api/health` returns `status: "down"`

- `$WALLETSYNC_DB_PATH` is empty or points to a missing file.
- The persistent disk didn't mount (`/var/data` is empty). Verify
  on Render → your service → **Disks** tab.

### Symptom: `/api/health` returns `status: "degraded"`

- Database is reachable but the write probe failed.
- Almost always: filesystem is read-only. On Vercel this is
  expected (serverless has read-only FS); on Render it's a config
  bug — check your disk mount and the `WALLETSYNC_DB_PATH` value.

### Symptom: deploy succeeded but site shows a 504

- Render free tier services idle after 15 min of no traffic. The
  first request after idle takes 30–60s while Render wakes the
  container. Hit it twice if you see a 5xx on first try.

### Symptom: seed CLI says "DB not found"

- The seed CLI writes via the HTTP API now, not directly to the
  file. If you're still seeing a file error, you're running an
  older version of the CLI — `git pull` first, then re-run.
- On Vercel, the seed CLI is intentionally unsupported. Move to
  Render for any flow that needs persistent state.

---

## Future work (not in v1.5 scope)

- Postgres backend. Repository ports + composition root are
  already in place to make this a parallel `lib/infrastructure/repos/`
  set. Trigger: "single SQLite file is a single point of failure
  for multi-region."
- CI to actually deploy. Today we run CI on every push; promotion
  to staging/prod is manual via a Render branch selector.
- The smoke script as a Render post-deploy hook. Render supports
  hitting a URL after deploy is healthy; `npm run smoke` against
  the deploy URL would be a natural fit.
