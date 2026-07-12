# 8. Architecture Diagram

This document is the authoritative single-page view of LiquiGuard's runtime
architecture. Every box and arrow corresponds to a concrete, currently
shipped component — there is no aspirational material here. Where useful,
the diagram points back to the file that owns each component so a reviewer
can verify the claim in one click.

For the surrounding context, see:

- `docs/01_REQUIREMENTS_ANALYSIS.md` — what the system commits to.
- `docs/02_DATA_FLOW_AND_STATE_MACHINES.md` — sequencing and FSM detail.
- `docs/03_DATABASE_DESIGN.md` — schema and table ownership.
- `docs/04_API_CONTRACT.md` — every `/v1/*` route, request, and response.
- `docs/05_MONOREPO_LAYOUT.md` — folder map.
- `docs/06_DOMAIN_INJECTIONS.md` — scenario injectors.
- `docs/07_DEMO_SCRIPT.md` — judge-facing run sheet.

---

## 8.1 Layered overview (text)

```text
                         +---------------------------------------+
                         |  Operator / Judge Browser             |
                         |  Next.js 16 + Turbopack (Vercel)      |
                         +-------------------+-------------------+
                                             |
                                             |  /v1/* rewrites via
                                             |  next.config.js
                                             v
+-----------------------------+       +-------+------------------+
|   Frontend (Next.js app)    |       |   FastAPI backend         |
|                             |       |   (Render)                |
|   shell/Shell.tsx           |       |                           |
|     +- themeStore (Zustand)  |       |   app/main.py             |
|     +- ThemeToggle           |       |     +- app/api/routes_*   |
|     +- InstallAppBanner      |       |     |   (telemetry,        |
|     +- Live evidence chip    |       |     |    simulation,      |
|                             |       |     |    metrics,         |
|   features/                 |       |     |    coordination,    |
|     ops/OpsWebView          |       |     |    cases)           |
|     agent/AgentMobileView   |       |     |                     |
|     risk/RiskReviewerView   |       |   app/simulation/         |
|     advisory/AdvisoryCard   |       |     +- simulation_engine |
|     coordination/*          |       |     +- injection/        |
|     debug/LiveEvidencePanel |       |     +- scenarios/         |
|     historical/Historical*  |       |     +- broadcaster.py     |
|     telemetry/              |       |                           |
|       useTelemetryStream    |       |   app/domain/             |
|         (SSE EventSource)   |       |     liquidity/            |
|                             |       |       forecaster (EWMA)   |
|                             |       |       historical_        |
|                             |       |       analytics.py (CTE) |
|                             |       |     risk/                |
|                             |       |       anomaly_detector    |
|                             |       |     coordination/         |
|                             |       |       state_machine (FSM) |
|                             |       |     metrics/              |
|                             |       |       collector           |
|                             |       |     provider/             |
|                             |       |       bkash/nagad/rocket  |
|                             |       |       SECURITY DEFINER    |
+-----------------------------+       +-------+------------------+
                                             |
                                             |  asyncpg / SQLAlchemy
                                             |  (per-role connection)
                                             v
+----------------------------------------------------------------------------+
|                              PostgreSQL 16                                  |
|                                                                            |
|   shared:                                                                   |
|     simulation_events (append-only, replay source)                          |
|     shared_cash_ledger        (versioned physical cash)                     |
|     shared_cash_movement      (append-only delta log)                       |
|     provider_customer_journal (audit of zero-sum legs)                      |
|     coordination_alerts       (FSM rows + transition JSON)                  |
|     dead_letter_logs          (durable exhausted/fatal work)                |
|     case_notes                (judge annotations)                           |
|                                                                            |
|   bkash:    provider_balance, provider_txn                                  |
|   nagad:    provider_balance, provider_txn                                  |
|   rocket:   provider_balance, provider_txn                                  |
+----------------------------------------------------------------------------+
```

Notes on each layer:

- **Frontend rewrite proxy**: `frontend/next.config.js` rewrites every
  `/v1/*` request to `${NEXT_PUBLIC_BACKEND_URL}/v1/*`. The browser
  therefore speaks to the same origin as the page and is not blocked by
  CORS or mixed-content rules in production.
- **Backend transport**: FastAPI on uvicorn; SSE delivered by a
  streaming ASGI generator backed by `app/infrastructure/broadcaster.py`.
- **Database roles**: `liquiguard_app_bkash`, `liquiguard_app_nagad`,
  `liquiguard_app_rocket`, `liquiguard_app_shared`. The application
  connects as the role whose schema it must touch; it physically cannot
  reach a peer provider's tables. Defined in
  `backend/infra/001_init.sql` and locked down by
  `backend/infra/002_hardening.sql`.

---

## 8.2 Runtime request lifecycle (a single tick)

```text
client                 api                       engine               domain                     Postgres
  |   POST /v1/simulation/scenario (or /tick)   |                       |                              |
   ----------------------->|                       |                       |                              |
                            |   validate provider   |                       |                              |
                            |   validate input      |                       |                              |
                            |   enqueue(Tick)       |                       |                              |
                            |   record tick.enqueued|                       |                              |
                            |----------------------->| - - - - - - - - - - - - - - - - - - - - - - - - ->|
                            |   202 Accepted        |   asyncio.Queue(maxsize=10_000)                  |
                            |<----------------------|   tick.enqueued durably visible                    |
                            |                       |   _WORKER_COUNT = 4 consumer tasks               |
                            |                       |   one pulls the tick                             |
                            |                       |                       |                              |
                            |                       |   invoke domain command                          |
                            |                       |----------------------->|                              |
                            |                       |                       |   SECURITY DEFINER call         |
                            |                       |                       |   (provider role or shared)     |
                            |                       |                       |----------------------------->|
                            |                       |                       |   zero-sum ledger mutation     |
                            |                       |                       |   append journal/movement row   |
                            |                       |                       |<- - - - - - - - - - - - - - - -|
                            |                       |                       |   committed balance returned   |
                            |                       |   EWMA forecaster    |                              |
                            |                       |<- - - - - - - - - - -|                              |
                            |                       |   drain, TTE, CI, conf|                              |
                            |                       |   detector score     |                              |
                            |                       |                       |                              |
                            |                       |   FSM transition      |                              |
                            |                       |----------------------->|                              |
                            |                       |                       |   PENDING -> ACKNOWLEDGED      |
                            |                       |                       |----------------------------->|
                            |                       |                       |   row + transitions JSON       |
                            |                       |                       |<- - - - - - - - - - - - - - - -|
                            |   record tick.done    |                       |                              |
                            |   (terminal row)      |                       |                              |
                            |----------------------->| - - - - - - - - - - - - - - - - - - - - - - - - ->|
                            |                       |   broadcaster.publish |                              |
                            |                       |   (bounded 1024 deque)|                              |
                            |                       |-------- SSE ---------v
```

Key facts:

- Every box with `---->` toward `Postgres` corresponds to an actual SQL
  statement audited in `shared.simulation_events`.
- The worker pool size is set in
  `backend/app/simulation/simulation_engine.py:95`:
  `WORKER_COUNT: Final = 4` and
  `QUEUE_MAX_BACKLOG: Final = 10_000`.
- The broadcaster buffer is bounded at
  `backend/app/infrastructure/broadcaster.py:35`:
  `MAX_BUFFER: Final = 1024`.
- A 15-second comment heartbeat is emitted when no work has been
  published, so dead connections are detected within one missed cycle.

---

## 8.3 Coordination finite state machine

```text
                     raise_alert()           producer (advisory condition)
                          |                         |
                          v                         v
                   +-----------+             +--------------+
                   |  PENDING  |------------>|  ACKNOWLEDGED|
                   +-----+-----+             +-------+------+
                         |                           |
                         |                           |
                  resolve (API/human)         resolve (API/human)
                         |                           |
                         v                           v
                   +-----------------------------------+
                   |              RESOLVED             |
                   |              (terminal)           |
                   +-----------------------------------+
```

- Source of truth: `backend/app/domain/coordination/state_machine.py`.
- Authoritative storage: `shared.coordination_alerts` (current status +
  transitions JSON array).
- Allowed edges: `PENDING -> ACKNOWLEDGED`, `ACKNOWLEDGED -> RESOLVED`,
  `RESOLVED -> none`. Anything else returns HTTP 409 and writes nothing.
- The state machine only broadcasts via SSE after the DB transaction
  commits, so subscribers can never observe a state that is not durable.

---

## 8.4 Provider isolation (zero-sum, no peer reach)

```text
  shared schema                       provider schemas
  ----------------------------------  ----------------------------------
  shared_cash_ledger                  bkash.provider_balance
  shared_cash_movement                bkash.provider_txn
  provider_customer_journal           nagad.provider_balance
  coordination_alerts                 nagad.provider_txn
  simulation_events                   rocket.provider_balance
  dead_letter_logs                    rocket.provider_txn
  case_notes
           ^                                  ^
           |                                  |
           |                                  |
    SECURITY DEFINER                    SECURITY DEFINER
    functions called                    functions called
    with role                          with role
    liquiguard_app_shared              liquiguard_app_<provider>
           |                                  |
           +-------------+--------------------+
                         |
                         v
              each role has USAGE only on
              its own schema; SELECT/INSERT/
              UPDATE/DELETE granted narrowly
              on the tables it must touch
```

- A provider-scoped transaction (e.g. bKash customer cash-out)
  atomically updates `shared.shared_cash_ledger` AND
  `bkash.provider_balance` AND appends `bkash.provider_txn` in one DB
  transaction. The provider connection only sees its own schema; the
  shared connection only sees the shared schema. Neither role can read a
  peer's tables — this is enforced by `002_hardening.sql`, not by
  application discipline.
- Optimistic-lock conflicts on the shared ledger use bounded jittered
  retries (`random.uniform(0.01, 0.05)`). Exhausted retries land in
  `shared.dead_letter_logs`, not in memory.

---

## 8.5 Telemetry stream topology

```text
                                                       shared.simulation_events
                                                       (durable, replayable)
                                                            ^
                                                            |
+-----------+        +-------------+       +--------------+ +----------------+
|  Browser  |  SSE   |  SSE        |  pub  | Broadcaster  | |   FS Advisory   |
|  role view|<------>| generator   |<------|  (bounded    |<-+   Detector     |
|           |  text/ |<------------|       |   1024 deque)| |   EWMA          |
| /v1/telem |  event |  filter by  |       +--------------+ +----------------+
|   /stream |  stream|  subscriber |              ^
+-----------+        +-------------+              |
                                              process epoch + sequence
                                              event id format:
                                              <process-epoch>:<sequence>
```

- The stream endpoint is `GET /v1/telemetry/stream` and emits a
  `snapshot` event first (operational snapshot), then incremental
  events. A reconnect re-begins from the snapshot, so a stale
  `last-event-id` from a previous backend process is ignored safely.
- The broadcaster buffer (1024) is a delivery optimisation, never the
  durable source. Anything evicted from the buffer that the client has
  not yet consumed can still be recovered from
  `GET /v1/telemetry/events?since=<timestamp>`.
- Named event names (clients bind via `addEventListener`, not
  `onmessage`):
  - `snapshot`, `ready` — connection hydration
  - `tick.enqueued`, `tick.done`, `tick.dead_letter`, `tick.fatal` —
    simulation lifecycle
  - `coordination.PENDING`, `coordination.ACKNOWLEDGED`,
    `coordination.RESOLVED` — alert FSM transitions
- Heartbeat: a comment line (`:`) every 15 seconds of silence. The
  client treats any opening without data for >30s as suspect.

---

## 8.6 Frontend role views

```text
                 /v1/telemetry/snapshot + /v1/telemetry/stream
                                |
                +---------------+---------------+
                |               |               |
                v               v               v
        +---------------+ +------------+ +------------------+
        |  OpsWebView   | | AgentMobile| | RiskReviewerView |
        | (operations)  | | (agent)    | |   (judge)        |
        +-------+-------+ +-----+------+ +---------+--------+
                |               |                |
        +-------+-------+ +-----+------+ +---------+--------+
        | Historical    | | Compact    | | Anomaly evidence  |
        | ContextCard   | |  evidence  | | + scoring detail  |
        | LiveEvidence  | | panel      | | + uncertainty     |
        | Panel (full)  | | (collapsed| | + dead-letter     |
        | AdvisoryCard  | | by default)| |   triage view     |
        | Coordination  | | Recent     | | Reviewer approve/ |
        |   action bar  | | activity   | |   override        |
        |               | | Pending    | |                   |
        |               | | actions    | |                   |
        +---------------+ +------------+ +-------------------+
```

- `Shell.tsx` mounts the role selector, the theme toggle, the live
  evidence cursor chip, and the install banner. These are role-shared
  chrome.
- `useTelemetryStream` owns the single `EventSource` per page and
  feeds a Zustand store consumed by every card. There is no per-card
  reconnect logic — the page owns connection lifecycle.
- The `LiveEvidencePanel` mounts:
  - in `OpsWebView` as `variant="full"` between the historical context
    card and the advisory card;
  - in `AgentMobileView` as `variant="compact"` inside the recent
    activity section with a "Show evidence" toggle.

---

## 8.7 Deployment topology (production)

```text
+-----------------------------+       +-----------------------------------+
|  Vercel                     |       |  Render                           |
|  liquiguard-frontend        |       |  liquiguard-backend                |
|  .vercel.app                |       |  .onrender.com                    |
|                             |       |                                   |
|  Next.js 16 + Turbopack     | ----> |  FastAPI + uvicorn                |
|  static + SSR               |  /v1/*|  SSE origin                       |
|  rewrites to BACKEND_URL    |       |  asyncpg pool                     |
|                             |       |  bounded broadcaster              |
+-----------------------------+       +-----------------+-----------------+
                                                        |
                                                        v
                                          +---------------------------+
                                          |  PostgreSQL 16             |
                                          |  (managed; Render-linked)  |
                                          |                           |
                                          |  shared / bkash / nagad /  |
                                          |  rocket schemas + roles    |
                                          +---------------------------+
```

- Public URLs (verified live during the demo window):
  - Frontend: `https://liquiguard-frontend.vercel.app/`
  - Backend health: `https://liquiguard-backend.onrender.com/healthz`
  - Backend docs: `https://liquiguard-backend.onrender.com/docs`
  - Live snapshot: `https://liquiguard-backend.onrender.com/v1/telemetry/snapshot`
  - Live SSE: `https://liquiguard-backend.onrender.com/v1/telemetry/stream`
- The browser never sees a cross-origin call. The `/v1/*` rewrite on the
  Vercel side keeps the SSE upgrade on the same origin as the
  document, so there is no mixed-content or CORS preflight at runtime.
- On Render free tier the service idles. The first request after a cold
  start can take 30-60s; subsequent requests are normal.

---

## 8.8 Failure surface and what each box does on failure

```text
   failure                       observed behaviour                     durable artefact
   --------------------------------------------------------------------------------------------
   optimistic-lock race          jittered retry (0.01-0.05s)            eventually tick.done
                                 bounded N attempts
   exhausted retries / fatal     durable dead-letter row                shared.dead_letter_logs
   balance would go negative     mutation rejected                      shared.dead_letter_logs
   worker exception              tick written to dead-letter,           shared.dead_letter_logs
                                 tick.fatal broadcast
   illegal FSM transition        HTTP 409, no DB write                  none (request rejected)
   unknown alert token           HTTP 404                               none
   browser disconnect            SSE generator exits cleanly            none (replay from events)
   backend restart               new SSE epoch, watermark replayed      shared.simulation_events
                                 from shared.simulation_events
   provider feed inconsistent    telemetry-only inconsistency event      shared.simulation_events
                                 (no ledger mutation)                   (telemetry payload)
   swarm of slow consumers       bounded deque drops oldest event       nothing lost on the wire,
                                                                         authoritative replay from
                                                                         shared.simulation_events
```

The point of this column is: **no durable side effect of the simulation
ever lives only in process memory.** If a box on this diagram disappears
(restart, OOM, scale-down), the worst case is "we re-read history from
Postgres on cold start".

---

## 8.9 Verification checklist for the diagram

A reviewer can confirm every claim on this page with one of:

| Claim                              | Where to look                                            |
| ---------------------------------- | -------------------------------------------------------- |
| 4 worker tasks, 10k queue cap      | `backend/app/simulation/simulation_engine.py:95-96`     |
| 1024 broadcaster buffer            | `backend/app/infrastructure/broadcaster.py:35`           |
| 15s SSE heartbeat                  | `backend/app/infrastructure/broadcaster.py:132`          |
| Per-provider roles no peer access  | `backend/infra/002_hardening.sql`                        |
| FSM allowed transitions            | `backend/app/domain/coordination/state_machine.py`       |
| CTE for historical analytics       | `backend/app/domain/liquidity/historical_analytics.py`   |
| EWMA drain/TTE/CI/confidence       | `backend/app/domain/liquidity/forecaster.py`             |
| Anomaly score + uncertainty        | `backend/app/domain/risk/anomaly_detector.py`            |
| Next.js `/v1/*` rewrite            | `frontend/next.config.js`                                |
| Live evidence panel source-of-SQL  | `frontend/src/features/debug/LiveEvidencePanel.tsx`      |
| Theme persistence key/version      | `frontend/src/features/shell/themeStore.ts`              |

---

## 8.10 What this diagram deliberately does NOT show

- No automatic money movement, no account freeze, no dispute filed on
  the user's behalf — no advisory in this prototype performs an
  action. The system only decides "human in the loop, please review";
  every consequential action is an explicit human transition through
  `POST /v1/coordination/transit`.
- No real provider integration. Synthetic event shapes are documented in
  `docs/06_DOMAIN_INJECTIONS.md`. Real bKash/Nagad/Rocket feeds are
  out of scope for this prototype.
- No service worker. `public/manifest.json` declares an installable
  shell only; offline caching is intentionally not implemented. See
  the `Installable shell (PWA)` section in `README.md`.
