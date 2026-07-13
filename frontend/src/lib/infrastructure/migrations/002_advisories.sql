-- =========================================================================
-- 002_advisories.sql — advisory FSM table
-- -------------------------------------------------------------------------
-- LiquiGuard port: replaces `coordination_alerts`. Same lifecycle
-- (PENDING -> ACKNOWLEDGED -> ESCALATED -> RESOLVED), same append-only
-- `transitions` JSONB-equivalent column, plus a `dedup_key` so a recurring
-- condition reuses the same case instead of opening a new one each tick.
-- =========================================================================

CREATE TABLE IF NOT EXISTS advisories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_token  TEXT    NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  persona_id   TEXT    NOT NULL REFERENCES personas(id),
  provider_id  TEXT    NULL,
  severity     TEXT    NOT NULL DEFAULT 'medium' CHECK (severity <> ''),
  status       TEXT    NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','ACKNOWLEDGED','ESCALATED','RESOLVED')),
  reason       TEXT    NOT NULL CHECK (reason <> ''),
  transitions  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(transitions)),
  dedup_key    TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (persona_id, dedup_key, status)
);

CREATE INDEX IF NOT EXISTS idx_advisories_status
  ON advisories(persona_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_advisories_provider_status
  ON advisories(persona_id, provider_id, status, updated_at DESC)
  WHERE provider_id IS NOT NULL;