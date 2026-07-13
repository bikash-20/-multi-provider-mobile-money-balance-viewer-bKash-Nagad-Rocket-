-- ============================================================================
-- 004_meta.sql — demo-metadata KV table
-- ----------------------------------------------------------------------------
-- Small key/value table used to carry demo-persona metadata + the currently
-- active persona selection across requests. Not present in 001_init.sql
-- originally (added here so SqliteMetaRepo can hydrate snapshots on cold
-- start without crashing on a missing table — same defensive semantics as
-- the old v1 binding).
-- ============================================================================

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);