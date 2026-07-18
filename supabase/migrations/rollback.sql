-- supabase/migrations/rollback.sql
-- ============================================================================
-- DatIQ v1.0 — DESTRUCTIVE rollback
-- ============================================================================
--
-- This script DROPS every table / column / function that the v1.0 migrations
-- create. It is provided for clean test-database teardown only.
--
-- ⚠️  NEVER RUN THIS AGAINST A PRODUCTION DATABASE WITH REAL DATA.
--    There is no undo. Always:
--      1. Take a full backup (`pg_dump`) FIRST
--      2. Confirm you are in the right project
--      3. Run the rollback in a transaction (BEGIN; ... ROLLBACK;)
--         to dry-run, then COMMIT only if the row counts look right
--
-- Order is the reverse of the forward migration (drop dependents first).

-- 0011 — reengagement_log
DROP TABLE IF EXISTS public.reengagement_log CASCADE;

-- 0010 — rate_limit_log
DROP TABLE IF EXISTS public.rate_limit_log CASCADE;

-- 0009 — extraction_cache
DROP TABLE IF EXISTS public.extraction_cache CASCADE;

-- 0008 — summary_feedback
DROP TABLE IF EXISTS public.summary_feedback CASCADE;

-- 0007 — public_reports
DROP TABLE IF EXISTS public.public_reports CASCADE;

-- 0006 — provenance (column on extractions, not a table)
ALTER TABLE IF EXISTS public.extractions DROP COLUMN IF EXISTS provenance;

-- 0005 — analytics_events
DROP TABLE IF EXISTS public.analytics_events CASCADE;

-- 0004 — scheduler
DROP TABLE IF EXISTS public.scheduled_tasks CASCADE;

-- 0003 — app_config
DROP TABLE IF EXISTS public.app_config CASCADE;

-- 0002 — pricing + coupons
DROP FUNCTION IF EXISTS public.redeem_coupon(text, text, integer, text);
DROP TABLE IF EXISTS public.coupon_counters CASCADE;
DROP TABLE IF EXISTS public.coupon_redemptions CASCADE;
DROP TABLE IF EXISTS public.pricing_config CASCADE;

-- 0001 — core + billing
ALTER TABLE IF EXISTS public.extractions DROP COLUMN IF EXISTS enrichments;
ALTER TABLE IF EXISTS public.extractions DROP COLUMN IF EXISTS domain_map;
ALTER TABLE IF EXISTS public.extractions DROP COLUMN IF EXISTS custom_extraction;
DROP TABLE IF EXISTS public.payment_events CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.usage_alerts CASCADE;
DROP TABLE IF EXISTS public.usage_records CASCADE;
-- public.extractions is the base table — do NOT drop it. If you really need
-- to, do it explicitly and AFTER everything above.

NOTIFY pgrst, 'reload schema';
