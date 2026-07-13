-- =========================================================================
-- 001_init.sql — WalletSync foundation schema
-- -------------------------------------------------------------------------
-- Establishes the per-persona, per-provider optimistic-locked balance,
-- the append-only balance history, the idempotent transfer ledger, and
-- the append-only wallet_events log that powers SSE replay.
--
-- PRAGMAs are also set here so that the migration is self-sufficient when
-- run against a fresh database file.
-- =========================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- -------------------------------------------------------------------------
-- personas
-- Six seeded personas (mom, student, freelancer, ...); only one is active
-- at a time, carried in the existing `meta` table under key='active_persona'.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personas (
  id             TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  opening_bkash  INTEGER NOT NULL CHECK (opening_bkash  >= 0),
  opening_nagad  INTEGER NOT NULL CHECK (opening_nagad  >= 0),
  opening_rocket INTEGER NOT NULL CHECK (opening_rocket >= 0),
  inflow_rate    REAL    NOT NULL DEFAULT 1.0,
  volatility     REAL    NOT NULL DEFAULT 0.10
);

-- -------------------------------------------------------------------------
-- provider_balance — optimistic-locked current state.
-- Exactly one row per (persona_id, provider_id).
-- Every successful UPDATE bumps version_id; the caller's expected_version
-- is supplied so we detect concurrent writes without SERIALIZABLE.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_balance (
  persona_id   TEXT    NOT NULL REFERENCES personas(id),
  provider_id  TEXT    NOT NULL CHECK (provider_id IN ('bkash','nagad','rocket')),
  balance      INTEGER NOT NULL CHECK (balance >= 0),   -- integer paise of BDT
  version_id   INTEGER NOT NULL DEFAULT 1 CHECK (version_id > 0),
  updated_at   INTEGER NOT NULL,                       -- epoch millis
  PRIMARY KEY (persona_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_balance_persona
  ON provider_balance(persona_id);

-- -------------------------------------------------------------------------
-- balance_entries — append-only history.
-- Replaces today's `balance_entries` table. Never UPDATEd, never DELETEd.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS balance_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id   TEXT    NOT NULL REFERENCES personas(id),
  provider_id  TEXT    NOT NULL CHECK (provider_id IN ('bkash','nagad','rocket')),
  balance      INTEGER NOT NULL CHECK (balance >= 0),
  source       TEXT    NOT NULL CHECK (source IN
                  ('transfer','seed','scenario','manual','import')),
  transfer_id  TEXT    NULL,
  ts           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_balance_entries_provider_ts
  ON balance_entries(persona_id, provider_id, ts DESC);

-- -------------------------------------------------------------------------
-- transfers — idempotent double-entry ledger.
-- PRIMARY KEY on transfer_id (UUIDv7) enforces exact-once replay.
-- The CHECK constraints are defense-in-depth; LedgerService enforces them
-- in TS first so the error surfaces as 409, not as a SQL exception.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers (
  transfer_id   TEXT    PRIMARY KEY,
  persona_id    TEXT    NOT NULL REFERENCES personas(id),
  from_provider TEXT    NOT NULL CHECK (from_provider IN ('bkash','nagad','rocket')),
  to_provider   TEXT    NOT NULL CHECK (to_provider   IN ('bkash','nagad','rocket')),
  amount_bdt    INTEGER NOT NULL CHECK (amount_bdt > 0),
  from_delta    INTEGER NOT NULL,
  to_delta      INTEGER NOT NULL,
  from_after    INTEGER NOT NULL CHECK (from_after >= 0),
  from_version  INTEGER NOT NULL CHECK (from_version > 0),
  to_after      INTEGER NOT NULL CHECK (to_after   >= 0),
  to_version    INTEGER NOT NULL CHECK (to_version   > 0),
  note          TEXT    NOT NULL DEFAULT '',
  ts            INTEGER NOT NULL,
  CHECK (from_provider <> to_provider),
  CHECK (from_delta = -amount_bdt),
  CHECK (to_delta   =  amount_bdt)
);

CREATE INDEX IF NOT EXISTS idx_transfers_persona_ts
  ON transfers(persona_id, ts DESC, transfer_id DESC);

-- -------------------------------------------------------------------------
-- wallet_events — append-only state-transition log.
-- Every mutation appends here inside the same transaction so SSE clients
-- can replay deterministically from their last-seen id.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id  TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  provider_id TEXT    NULL,
  payload     TEXT    NOT NULL CHECK (json_valid(payload)),
  ts          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_events_persona_id
  ON wallet_events(persona_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_events_type
  ON wallet_events(event_type, id DESC);