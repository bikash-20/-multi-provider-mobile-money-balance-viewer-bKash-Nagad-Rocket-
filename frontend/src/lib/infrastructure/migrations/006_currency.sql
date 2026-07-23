-- Migration 006: Add currency support to balance_entries.
--
-- Adds two nullable columns:
--   currency       TEXT DEFAULT 'BDT'  — 'BDT' or 'USD'
--   exchange_rate  REAL DEFAULT NULL   — BDT per 1 USD at entry time
--
-- Existing rows are backfilled with 'BDT' / NULL so the constraint
-- "non-NULL currency" is maintained for new writes while allowing
-- legacy rows to be read cleanly.

ALTER TABLE balance_entries
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'BDT';

ALTER TABLE balance_entries
  ADD COLUMN exchange_rate REAL DEFAULT NULL;

-- Index on currency so filtering/reporting by currency stays fast.
CREATE INDEX IF NOT EXISTS idx_balance_entries_currency
  ON balance_entries (currency);
