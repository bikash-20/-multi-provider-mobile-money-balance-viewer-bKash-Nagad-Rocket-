-- =========================================================================
-- 003_metrics_views.sql — read-only aggregate views for /api/metrics
-- -------------------------------------------------------------------------
-- Pure read-side conveniences; no schema changes. Both views are guarded
-- with IF NOT EXISTS so reruns are no-ops.
-- =========================================================================

CREATE VIEW IF NOT EXISTS v_transfer_throughput AS
SELECT persona_id,
       count(*)        AS total_transfers,
       sum(amount_bdt) AS total_bdt_moved,
       avg(amount_bdt) AS avg_transfer_bdt
FROM transfers
GROUP BY persona_id;

CREATE VIEW IF NOT EXISTS v_advisory_pipeline AS
SELECT persona_id, status, count(*) AS n
FROM advisories
GROUP BY persona_id, status;