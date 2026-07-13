-- =========================================================================
-- 005_transfers_reversal.sql — link compensating transfer rows back to
-- the originals they reverse.
--
-- The transfers ledger is append-only: a reversal is a NEW transfers row
-- whose from/to is swapped, whose amount_bdt equals the original, and
-- whose `reverses_transfer_id` points at the row being undone. This
-- keeps the audit trail intact (no DELETE) while letting us answer
-- "is this transfer already reversed?" in O(1) with a covering index.
--
-- Why a column and not parsing the `note`?
--   The note column is a free-text field exposed to clients (≤120 chars);
--   encoding the reverse link in user-mutable data would let a buggy
--   editor silently re-reverse or hide reversals. The schema-level column
--   is the only trustworthy place for that pointer.
--
-- Why no CHECK(reverses_transfer_id <> transfer_id)?
--   Self-reversal is rejected at the route layer (commitReverse requires
--   a non-null original), but a defence-in-depth CHECK would be
--   unnecessary here because commitReverse generates a fresh
--   newTransferId() and never passes the original id as the new id.
-- =========================================================================

ALTER TABLE transfers
  ADD COLUMN reverses_transfer_id TEXT NULL
  REFERENCES transfers(transfer_id);

-- Used by commitReverse to detect "already reversed" without scanning
-- the whole ledger: COUNT(*) WHERE reverses_transfer_id = ? == 1 means
-- the original has been compensated at least once. (A second reversal
-- of the same original is rejected in the binding, not in SQL.)
CREATE INDEX IF NOT EXISTS idx_transfers_reverses
  ON transfers(reverses_transfer_id)
  WHERE reverses_transfer_id IS NOT NULL;