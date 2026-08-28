-- supabase/migrations/run-all.sql
-- ============================================================================
-- DatIQ — Production migration orchestrator (single-file variant)
-- ============================================================================
--
-- GENERATED FILE — DO NOT EDIT BY HAND.
-- Regenerate with:  npm run build:sql
-- Verify in CI with: npm run build:sql -- --check
--
-- Paste this file in the Supabase SQL Editor → New query → Run.
-- It is the concatenation of every numbered migration in this directory, in
-- lexical (== dependency) order. Every script is idempotent
-- (IF NOT EXISTS / OR REPLACE), so it is safe to re-run on a fresh or
-- partially-migrated database.
--
-- ORDER MATTERS:
--   0001  ScrapeLite V5 + V5c database migrations
--   0002  Run this in the Supabase SQL Editor (project wvdpfhzolppshnzwprgt).
--   0003  Run this in the Supabase SQL Editor (project wvdpfhzolppshnzwprgt).
--   0004  DatIQ — R19 Scheduler setup (ready-to-paste)
--   0005  scripts/analytics.sql
--   0006  scripts/provenance.sql
--   0007  scripts/public-reports.sql
--   0008  scripts/summary-feedback.sql
--   0009  FD2 (idempotent result cache).
--   0010  FD3 (per-host rate limit log).
--   0011  F49 (re-engagement email dedup log).
--   0012  PR1 (billing identity + server-authoritative entitlements).
--   0013  PR1 step 2 of 3 (backfill user_id).
--   0014  PR1 step 3 of 3 (lock down the billing tables).
--   0015  PR1 (system pause flag + privilege fix).
--   0016  PR2 (invoice drafts, invoices, gapless FY numbering).
--   0017  PR3 (dunning log + admin audit trail).
--   0018  0018_ops_monitoring.sql — operational monitoring for automation + services.
--   0019  0019_api_keys.sql
--   0020  0020_integration_connections.sql
--   0021  0021_zapier_events.sql
--   0022  v2 plan: workflow_events / workflow_runs / workflow_subscriptions.
--   0023  0023_consent.sql
--   0024  0024_analytics_rls.sql
--   0025  0025_gallery_curation.sql
--   0026  Server-authoritative anonymous identity and usage counters.
--   0027  0027_admin_coupon_grants.sql
--   0028  0028_scrape_consent.sql
--   0029  0029_referrals.sql
--   0030  0030_discoverability_audits.sql
--   0031  0031_team_workspaces.sql
--   0032  0032_account_state_and_audit_summary.sql
--   0033  0033_deletion_period_end_gate.sql
--   0034  0034_usage_rls.sql — lock down usage_records and usage_alerts.
--
-- Individual files are also committed for source control. If you prefer to run
-- them one at a time, paste each numbered file separately in the order above.
--
-- VERIFY: see README.md §3 for the list of tables that should exist after.
-- ROLLBACK: see rollback.sql for a destructive rollback (DESTRUCTIVE).


-- ============================================================
-- 0001_core_tables_and_billing.sql
-- ============================================================
-- ScrapeLite V5 + V5c database migrations
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- All statements are idempotent (safe to run multiple times).

-- ── Core: extractions table (created here so 0001 is self-contained on a fresh DB).
-- 0004 also runs `create table if not exists public.extractions (...)` + the per-user
-- RLS policy, but on a brand-new Supabase project that table doesn't exist yet, so
-- the V2 ALTERs below would fail with "relation public.extractions does not exist".
-- This CREATE mirrors the schema 0004 would create; the duplicate 0004 create is a
-- no-op after this runs.
create table if not exists public.extractions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users,
  url               text,
  page_title        text,
  ai_summary        text,
  headings          jsonb,
  links             jsonb,
  custom_extraction jsonb,
  domain_map        jsonb,
  enrichments       jsonb,
  created_at        timestamptz default now()
);

-- ── V2: extractions table columns (safe if already exist) ─────────────────────
alter table public.extractions add column if not exists custom_extraction jsonb;
alter table public.extractions add column if not exists domain_map        jsonb;
alter table public.extractions add column if not exists enrichments       jsonb;

-- ── V5: Usage tracking ────────────────────────────────────────────────────────
create table if not exists public.usage_records (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  month       text not null,
  extractions integer not null default 0,
  enrichments integer not null default 0,
  plan_id     text not null default 'free',
  updated_at  timestamptz not null default now(),
  unique(session_id, month)
);
alter table public.usage_records enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'usage_records' and policyname = 'anon full access'
  ) then
    execute 'create policy "anon full access" on public.usage_records
             for all using (true) with check (true)';
  end if;
end $$;

-- ── V5: Alert preferences ─────────────────────────────────────────────────────
create table if not exists public.usage_alerts (
  id               uuid primary key default gen_random_uuid(),
  session_id       text not null unique,
  email            text not null,
  thresholds       integer[] not null default '{80,95}',
  enabled          boolean not null default true,
  last_notified_at timestamptz
);
alter table public.usage_alerts enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'usage_alerts' and policyname = 'anon full access'
  ) then
    execute 'create policy "anon full access" on public.usage_alerts
             for all using (true) with check (true)';
  end if;
end $$;

-- ── V5c: Payment subscriptions ────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  session_id               text not null unique,
  plan_id                  text,
  status                   text,
  provider                 text,
  provider_subscription_id text,
  provider_customer_id     text,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);
alter table public.subscriptions enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'subscriptions' and policyname = 'anon full access'
  ) then
    execute 'create policy "anon full access" on public.subscriptions
             for all using (true) with check (true)';
  end if;
end $$;

-- ── V5c: Payment event audit log ──────────────────────────────────────────────
create table if not exists public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  session_id        text,
  event_type        text,
  provider          text,
  provider_event_id text,
  plan_id           text,
  amount_cents      integer,
  currency          text,
  status            text,
  created_at        timestamptz default now()
);
alter table public.payment_events enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'payment_events' and policyname = 'anon full access'
  ) then
    execute 'create policy "anon full access" on public.payment_events
             for all using (true) with check (true)';
  end if;
end $$;


-- ============================================================
-- 0002_pricing_and_coupons.sql
-- ============================================================
-- Run this in the Supabase SQL Editor (project wvdpfhzolppshnzwprgt).
-- Adds the tables this branch needs: operator pricing overrides + server-enforced
-- coupon maxUses / one-redemption-per-user. Safe to re-run (IF NOT EXISTS / OR REPLACE).

-- ── Operator pricing/coupon overrides (read by create-checkout via loadPricing) ──
-- RLS on with NO anon policy: only the service key (bypasses RLS) may read/write,
-- because these values set real charge amounts. Empty table → server uses static fallback.
CREATE TABLE IF NOT EXISTS public.pricing_config (
  key text primary key,            -- 'plans' | 'bundles' | 'coupons' | 'global'
  value jsonb not null,
  updated_at timestamptz default now()
);
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

-- ── Coupon redemption tracking — server-enforced maxUses + one-per-user ──────────
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_code text not null,
  session_id  text not null,
  order_ref   text,
  created_at  timestamptz default now(),
  unique (coupon_code, session_id)   -- per-user one-time use
);
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.coupon_counters (
  coupon_code text primary key,
  uses integer not null default 0
);
ALTER TABLE public.coupon_counters ENABLE ROW LEVEL SECURITY;

-- Atomic redeem: (1) claim the per-user slot via the unique constraint, then
-- (2) conditionally increment the per-coupon counter ONLY while under the cap
-- (UPDATE ... WHERE uses < p_max is row-locked → cap can't be exceeded under
-- concurrency). Returns 'ok' | 'already_redeemed' | 'cap_reached'. p_max<=0 = no cap.
CREATE OR REPLACE FUNCTION public.redeem_coupon(
  p_code text, p_session text, p_max integer, p_order text
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE new_uses integer;
BEGIN
  BEGIN
    INSERT INTO public.coupon_redemptions (coupon_code, session_id, order_ref)
    VALUES (p_code, p_session, p_order);
  EXCEPTION WHEN unique_violation THEN
    RETURN 'already_redeemed';
  END;
  IF p_max IS NULL OR p_max <= 0 THEN
    RETURN 'ok';
  END IF;
  INSERT INTO public.coupon_counters (coupon_code, uses) VALUES (p_code, 0)
    ON CONFLICT (coupon_code) DO NOTHING;
  UPDATE public.coupon_counters SET uses = uses + 1
   WHERE coupon_code = p_code AND uses < p_max
  RETURNING uses INTO new_uses;
  IF new_uses IS NULL THEN
    DELETE FROM public.coupon_redemptions WHERE coupon_code = p_code AND session_id = p_session;
    RETURN 'cap_reached';
  END IF;
  RETURN 'ok';
END; $$;

-- PostgREST may 404 the new table/RPC until its schema cache reloads:
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- 0003_ai_config.sql
-- ============================================================
-- Run this in the Supabase SQL Editor (project wvdpfhzolppshnzwprgt).
-- Adds the table that persists the AI provider fallback config edited from
-- /admin/ai. Safe to re-run (IF NOT EXISTS).
--
-- The stored value is NON-SECRET (provider names, model ids, order, enable flags) —
-- the actual provider API keys live only in Netlify env. Read server-side by
-- netlify/functions/lib/aiProviders.js (loadAiConfig) via the service key; written
-- by netlify/functions/admin-ai-config.js (also service key, admin-token gated).
--
-- RLS is enabled with NO anon policy on purpose: only the service key (which
-- bypasses RLS) may read/write. If the table is empty or Supabase is unconfigured,
-- the server falls back to env (AI_PROVIDER_ORDER / *_MODEL) and built-in defaults
-- (Gemini → Claude → OpenAI), so nothing ever hard-fails.

CREATE TABLE IF NOT EXISTS public.app_config (
  key text primary key,            -- e.g. 'ai'
  value jsonb not null,
  updated_at timestamptz default now()
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
-- (Intentionally no anon policy. Service key bypasses RLS.)

-- Optional seed — the cost-first default chain. Omit to let the server use its
-- built-in defaults until an admin saves from /admin/ai.
-- INSERT INTO public.app_config (key, value) VALUES (
--   'ai',
--   '{"order":["gemini","anthropic","openai"],
--     "models":{"gemini":"gemini-2.5-flash","anthropic":"claude-3-5-haiku-20241022","openai":"gpt-4o-mini"},
--     "enabled":{"gemini":true,"anthropic":true,"openai":true},
--     "maxTokens":1024}'::jsonb
-- ) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();


-- ============================================================
-- 0004_scheduler.sql
-- ============================================================
-- ============================================================================
-- DatIQ — R19 Scheduler setup (ready-to-paste)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Every statement is IDEMPOTENT — safe to run multiple times.
--
-- This file sets up the R19 "scheduler / track changes" feature end-to-end:
--   1. public.extractions   — base table the scheduled runs save into (created
--                             here only if missing; also back-fills V2 columns)
--   2. public.scheduled_tasks — the recurring-schedule store the runner reads
--
-- After running this, set these Netlify env vars (Site → Settings → Environment),
-- then redeploy:
--   SUPABASE_URL          (server, no VITE_ prefix)
--   SUPABASE_SERVICE_KEY  (server — service-role key; the hourly runner uses it
--                          to read/update every user's schedules, bypassing RLS)
--   RESEND_API_KEY        (optional — enables change-alert emails)
--   ALERT_EMAIL_FROM      (optional — e.g. 'DatIQ Alerts <alerts@datiq.app>',
--                          the domain must be verified in Resend)
--
-- The hourly Netlify Scheduled Function (netlify/functions/scheduled-runner.js)
-- auto-registers on deploy. Until the env vars are set it is a harmless no-op;
-- schedules still persist in the browser (localStorage) and "Run now" works.
--
-- NOTE: schedules are saved server-side per AUTHENTICATED user (RLS below), so a
-- schedule only reaches Supabase when its creator is signed in. Guest schedules
-- stay in localStorage and are not executed by the server runner.
--
-- This file is scoped to the scheduler. For the rest of the platform run, in
-- addition: scripts/migrations.sql (usage/subscriptions/payments),
-- scripts/coupon-and-pricing-config.sql, and scripts/ai-config.sql.
-- ============================================================================


-- ── 1. Base table: extractions ──────────────────────────────────────────────
-- Created only if it doesn't already exist. If you set up DatIQ earlier this is
-- a no-op (the ALTERs below still back-fill any missing columns). Matches what
-- netlify/functions/extractions.js reads/writes (RLS keyed on user_id).
create table if not exists public.extractions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users,
  url               text,
  page_title        text,
  ai_summary        text,
  headings          jsonb,
  links             jsonb,
  custom_extraction jsonb,
  domain_map        jsonb,
  enrichments       jsonb,
  created_at        timestamptz default now()
);

-- Back-fill columns on a pre-existing extractions table (all idempotent).
alter table public.extractions add column if not exists user_id           uuid references auth.users;
alter table public.extractions add column if not exists custom_extraction jsonb;
alter table public.extractions add column if not exists domain_map        jsonb;
alter table public.extractions add column if not exists enrichments       jsonb;

alter table public.extractions enable row level security;

-- Per-user isolation: a signed-in user only sees/writes their own rows.
drop policy if exists "users own extractions" on public.extractions;
create policy "users own extractions" on public.extractions
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── 2. R19: scheduled_tasks ──────────────────────────────────────────────────
-- One row per schedule. The whole client schedule object is stored in `data`
-- (jsonb); a few fields are promoted to columns so the runner can query
-- "active + due" efficiently. Written by netlify/functions/schedules.js (per-user,
-- RLS) and read/updated by netlify/functions/scheduled-runner.js (service key).
create table if not exists public.scheduled_tasks (
  id          text primary key,                 -- client-generated, e.g. sch_xxxx
  user_id     uuid references auth.users,
  status      text default 'active',            -- 'active' | 'paused'
  cron        text,                              -- 5-field cron (UTC)
  next_run_at timestamptz,
  data        jsonb not null,                    -- full schedule object
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Helps the hourly runner scan active schedules quickly.
create index if not exists scheduled_tasks_status_idx on public.scheduled_tasks (status);

alter table public.scheduled_tasks enable row level security;

-- Per-user CRUD from the browser. The service-role key (used by the runner)
-- bypasses RLS, so it can execute schedules for every user.
drop policy if exists "users own schedules" on public.scheduled_tasks;
create policy "users own schedules" on public.scheduled_tasks
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Done. Verify:
--   select id, status, cron, next_run_at from public.scheduled_tasks;


-- ============================================================
-- 0005_analytics.sql
-- ============================================================
-- scripts/analytics.sql
-- Q11 — Product analytics instrumentation.
-- Run this in the Supabase SQL Editor to create the analytics_events table.
-- Safe to re-run: every statement is idempotent.
--
-- Storage strategy: append-only event log, no per-row indexing beyond the
-- primary key. The RLS policy is intentionally open (anon + authenticated)
-- because the data we record is non-PII (no email, no user content).

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,                 -- e.g. "extraction_success", "save", "export"
  properties  jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id     text,                          -- nullable: anonymous events allowed
  session_id  text NOT NULL,                 -- always present (usageRepo.getSessionId)
  ts          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_name_idx
  ON public.analytics_events (name, ts DESC);
CREATE INDEX IF NOT EXISTS analytics_events_session_idx
  ON public.analytics_events (session_id, ts DESC);
CREATE INDEX IF NOT EXISTS analytics_events_user_idx
  ON public.analytics_events (user_id, ts DESC);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Public read: any visitor can read aggregate analytics. Insert is anon-friendly
-- so we never lose a tracked event to a missing session token.
DROP POLICY IF EXISTS "anon read access"   ON public.analytics_events;
DROP POLICY IF EXISTS "anon insert access" ON public.analytics_events;
CREATE POLICY "anon read access"
  ON public.analytics_events FOR SELECT
  USING (true);
CREATE POLICY "anon insert access"
  ON public.analytics_events FOR INSERT
  WITH CHECK (true);

-- No UPDATE / DELETE policy — events are append-only.


-- ============================================================
-- 0006_provenance.sql
-- ============================================================
-- scripts/provenance.sql
-- Q9 — Per-field provenance metadata.
-- Adds a `provenance` jsonb column to the extractions table to store the
-- Q9 metadata (source URL, field_count, avg_confidence, last_checked_at,
-- fields{ label: [{ source_url, confidence, last_checked_at, retrieval, ... }] }).
--
-- Safe to re-run: every statement is idempotent. The column is nullable so
-- existing rows are unaffected — provenance is generated on extract and
-- attached to new rows going forward.

ALTER TABLE public.extractions
  ADD COLUMN IF NOT EXISTS provenance jsonb;

-- Useful partial index for the most common admin query: "give me the
-- extractions whose provenance is stale (older than 7 days)".
CREATE INDEX IF NOT EXISTS extractions_provenance_checked_idx
  ON public.extractions ((provenance->>'last_checked_at'))
  WHERE provenance IS NOT NULL;

-- GIN index on the fields map so we can search by field label later.
CREATE INDEX IF NOT EXISTS extractions_provenance_fields_gin
  ON public.extractions USING gin ((provenance->'fields') jsonb_path_ops)
  WHERE provenance IS NOT NULL;


-- ============================================================
-- 0007_public_reports.sql
-- ============================================================
-- scripts/public-reports.sql
-- Q8 — Shareable extraction reports (public, anon-readable).
-- Run this in the Supabase SQL Editor to create the public_reports table.
-- Safe to re-run: every statement is idempotent.
--
-- Storage strategy: one row per shared extraction. The `slug` is the only
-- auth — anyone with the URL can read the row. We deliberately allow
-- anon-friendly insert so anonymous visitors can share too.
--
-- The `data` jsonb is the public projection written by shareService.js —
-- strip PII (no email, no user content beyond the public projection).

CREATE TABLE IF NOT EXISTS public.public_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  url         text,
  intent      text,
  data        jsonb NOT NULL,
  user_id     text,                          -- nullable: anonymous sharing allowed
  session_id  text,                          -- used to attribute the share in analytics
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  is_public   boolean NOT NULL DEFAULT true
);

-- Slug lookup is the hot path — unique index already provides it.
-- Add a couple of secondary indexes for admin / "latest shared" queries.
CREATE INDEX IF NOT EXISTS public_reports_created_at_idx
  ON public.public_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS public_reports_user_idx
  ON public.public_reports (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.public_reports ENABLE ROW LEVEL SECURITY;

-- Public read: any visitor can fetch by slug.
DROP POLICY IF EXISTS "public read"   ON public.public_reports;
DROP POLICY IF EXISTS "anon insert"   ON public.public_reports;
DROP POLICY IF EXISTS "owner update"  ON public.public_reports;
DROP POLICY IF EXISTS "owner delete"  ON public.public_reports;

CREATE POLICY "public read"
  ON public.public_reports FOR SELECT
  USING (is_public = true);

-- Anon-friendly insert: we never reject a share because the user isn't
-- signed in. The client supplies {slug, title, url, intent, data, user_id?}.
CREATE POLICY "anon insert"
  ON public.public_reports FOR INSERT
  WITH CHECK (true);

-- Update + delete: only the original sharer can mutate their row. Anon
-- shares use a session_id match (passed as a header from the client).
CREATE POLICY "owner update"
  ON public.public_reports FOR UPDATE
  USING (
    user_id::text = auth.uid()::text
    OR session_id = current_setting('request.headers', true)::json->>'x-session-id'
  );

CREATE POLICY "owner delete"
  ON public.public_reports FOR DELETE
  USING (
    user_id::text = auth.uid()::text
    OR session_id = current_setting('request.headers', true)::json->>'x-session-id'
  );

-- Touch the updated_at column on every UPDATE so admin queries can sort
-- "most recently re-shared" without needing a separate event log.
CREATE OR REPLACE FUNCTION public.public_reports_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS public_reports_updated_at_trg ON public.public_reports;
CREATE TRIGGER public_reports_updated_at_trg
  BEFORE UPDATE ON public.public_reports
  FOR EACH ROW EXECUTE FUNCTION public.public_reports_touch_updated_at();


-- ============================================================
-- 0008_summary_feedback.sql
-- ============================================================
-- scripts/summary-feedback.sql
-- Q5 — AI Summary feedback loop (thumbs up/down + optional comment).
-- Run in the Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS public.summary_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id text,                          -- soft FK to public.extractions.id
  url         text,
  intent      text,
  rating      smallint NOT NULL CHECK (rating IN (-1, 0, 1)),  -- -1 thumbs-down, +1 thumbs-up
  comment     text,
  user_id     text,
  session_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS summary_feedback_extraction_idx
  ON public.summary_feedback (extraction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS summary_feedback_rating_idx
  ON public.summary_feedback (rating, created_at DESC);

ALTER TABLE public.summary_feedback ENABLE ROW LEVEL SECURITY;

-- Anyone can read aggregate feedback (anon-friendly for analytics dashboards).
-- Only the original submitter (by session_id or user_id) can update/delete.
DROP POLICY IF EXISTS "anon read"          ON public.summary_feedback;
DROP POLICY IF EXISTS "anon insert"        ON public.summary_feedback;
DROP POLICY IF EXISTS "owner update"       ON public.summary_feedback;
DROP POLICY IF EXISTS "owner delete"       ON public.summary_feedback;

CREATE POLICY "anon read"
  ON public.summary_feedback FOR SELECT
  USING (true);

CREATE POLICY "anon insert"
  ON public.summary_feedback FOR INSERT
  WITH CHECK (true);

CREATE POLICY "owner update"
  ON public.summary_feedback FOR UPDATE
  USING (
    user_id::text = auth.uid()::text
    OR session_id = current_setting('request.headers', true)::json->>'x-session-id'
  );

CREATE POLICY "owner delete"
  ON public.summary_feedback FOR DELETE
  USING (
    user_id::text = auth.uid()::text
    OR session_id = current_setting('request.headers', true)::json->>'x-session-id'
  );


-- ============================================================
-- 0009_extraction_cache.sql
-- ============================================================
-- scripts/result-cache.sql — FD2 (idempotent result cache).
-- Run this in the Supabase SQL Editor to create the extraction_cache table.
-- Safe to re-run: every statement is idempotent.
--
-- Cache shape: one row per (url, options_hash) pair. The server checks this
-- table before invoking the scrape provider chain, so repeated extractions
-- of the same URL within the TTL cost zero provider calls.
--
-- Anonymous read access is REQUIRED for the cache to be useful for guest
-- users too. The server uses the service key to write, so writes are not
-- rate-limited by RLS.

CREATE TABLE IF NOT EXISTS public.extraction_cache (
  url          text NOT NULL,
  options_hash text NOT NULL,
  result       jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'ok',
  cached_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  hit_count    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (url, options_hash)
);

-- Cleanup sweep (older entries age out). The Netlify scheduled function
-- could run a daily `DELETE FROM extraction_cache WHERE expires_at < now()`
-- but for v1 we let expired rows accumulate and ignore them on read.
CREATE INDEX IF NOT EXISTS extraction_cache_expires_idx
  ON public.extraction_cache (expires_at);

-- For the most-frequently-cached lookups (the read path).
CREATE INDEX IF NOT EXISTS extraction_cache_url_idx
  ON public.extraction_cache (url);

ALTER TABLE public.extraction_cache ENABLE ROW LEVEL SECURITY;

-- Anonymous read for cache hits (the server doesn't pass a user JWT, it
-- uses the service key which bypasses RLS anyway — but we still allow
-- anon SELECT in case future code wants to read directly).
DROP POLICY IF EXISTS "anon read" ON public.extraction_cache;
CREATE POLICY "anon read"
  ON public.extraction_cache FOR SELECT
  USING (true);

-- Writes are service-key-only (bypasses RLS). No anon write policy.


-- ============================================================
-- 0010_rate_limit_log.sql
-- ============================================================
-- scripts/rate-limit-log.sql — FD3 (per-host rate limit log).
-- Optional Supabase table for cross-warm-container rate enforcement.
-- The primary in-process limiter lives in netlify/functions/lib/rateLimiter.js
-- and works without this table. This table is the durable extension point
-- for shared infra with multiple warm containers (each container has its
-- own in-process bucket; the table aggregates them).
--
-- Run this in the Supabase SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.rate_limit_log (
  id          bigserial PRIMARY KEY,
  host        text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);

-- The compliance + monitoring dashboards query this by host + time.
CREATE INDEX IF NOT EXISTS rate_limit_log_host_at_idx
  ON public.rate_limit_log (host, at DESC);

-- Auto-prune older than 7 days (Supabase pg_cron handles this; manual
-- cleanup via a scheduled function is out of scope for v1).
-- For v1, run manually: DELETE FROM rate_limit_log WHERE at < now() - interval '7 days';

ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;

-- Service key bypasses RLS; no anon policy needed (server-only writes).


-- ============================================================
-- 0011_reengagement_log.sql
-- ============================================================
-- scripts/reengagement-log.sql — F49 (re-engagement email dedup log).
-- Run this in the Supabase SQL Editor. Safe to re-run.
--
-- One row per (user_email, kind, window_key) tuple. The reengagement.js
-- Netlify function writes here so it never emails the same user twice
-- for the same trigger (e.g. the same ISO week for the weekly digest).

CREATE TABLE IF NOT EXISTS public.reengagement_log (
  id          bigserial PRIMARY KEY,
  user_email  text NOT NULL,
  kind        text NOT NULL,          -- 'digest' | 'd7' (future: 'd30')
  window_key  text NOT NULL,          -- 'digest:2026-W29' or 'd7:2026-07-18'
  sent_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_email, kind, window_key)
);

-- Read-by-(email, kind, window) is the hot path; the UNIQUE constraint
-- already provides an index for it. Add an explicit one for the
-- analytics queries (e.g. "how many digests sent in 2026?")
CREATE INDEX IF NOT EXISTS reengagement_log_window_idx
  ON public.reengagement_log (kind, window_key);

ALTER TABLE public.reengagement_log ENABLE ROW LEVEL SECURITY;

-- Service-key bypasses RLS; no anon policy needed.


-- ============================================================
-- 0012_billing_identity.sql
-- ============================================================
-- scripts/billing-identity.sql — PR1 (billing identity + server-authoritative entitlements).
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- WHY THIS EXISTS
-- Billing rows have always been keyed on `session_id` — a random UUID kept in
-- the browser's localStorage (`datiq.sessionId`, see src/lib/usageRepo.js).
-- That means: clearing site data orphans a paying customer's history, two
-- people sharing a browser share a subscription, and nothing can be tied to
-- the signed-in user. Invoices carry names, addresses and amounts, so before
-- any of that exists the billing tables have to hang off `auth.users.id`.
--
-- This migration is deliberately ADDITIVE ONLY — every column is nullable and
-- nothing reads them yet. Behaviour is unchanged until 0013 (backfill) and
-- 0014 (RLS lockdown) land. See the ordering note at the bottom.

-- ── 1. user_id on the session-keyed billing tables ────────────────────────────
-- Nullable on purpose: genuine logged-out purchases keep working and simply
-- carry a null user_id until the buyer signs in and claims the session.
alter table public.subscriptions  add column if not exists user_id uuid references auth.users;
alter table public.payment_events add column if not exists user_id uuid references auth.users;
alter table public.usage_records  add column if not exists user_id uuid references auth.users;

create index if not exists subscriptions_user_idx  on public.subscriptions  (user_id);
create index if not exists payment_events_user_idx on public.payment_events (user_id);
create index if not exists usage_records_user_idx  on public.usage_records  (user_id);

-- ── 2. session → user link table ──────────────────────────────────────────────
-- A link table rather than a bare backfill because one browser session id can
-- legitimately be presented by two different humans (shared machine), and this
-- is money — we want the audit row saying who claimed what and when.
create table if not exists public.billing_identity_links (
  session_id text primary key,
  user_id    uuid not null references auth.users on delete cascade,
  linked_at  timestamptz not null default now(),
  source     text                                  -- 'signin' | 'checkout' | 'admin'
);
create index if not exists billing_identity_links_user_idx
  on public.billing_identity_links (user_id);

alter table public.billing_identity_links enable row level security;
-- RLS on with no policy = service key only. The claim RPC below is SECURITY
-- DEFINER, so the browser never needs direct access to this table.

-- ── 3. entitlements — the resolved answer, one row per user ───────────────────
-- Kept SEPARATE from `subscriptions` on purpose. `subscriptions` is provider-
-- shaped and is clobbered on every purchase by the onConflict:session_id upsert
-- in src/lib/paymentRepo.js. `entitlements` is the single resolved answer to
-- "what may this user do right now" — a primary-key lookup, cheap to cache.
--
-- TWO AXES, NEVER CONFLATED: `plan_id` is what they bought, `status` is where
-- they are in the lifecycle. A suspended Pro user stays plan_id='pro' with
-- status='suspended'. Encoding lifecycle into plan_id (a "suspended" pseudo
-- plan) would be silently DANGEROUS: getEffectivePlanById() in
-- src/lib/pricingOverrides.js falls back to `free` for unknown ids, so a
-- suspended user would be granted the Free tier instead of being denied.
create table if not exists public.entitlements (
  user_id              uuid primary key references auth.users on delete cascade,
  plan_id              text not null default 'free',
  status               text not null default 'active',   -- active|suspended|deactivated|purged
  billing_period       text,                             -- monthly|annual|once
  period_start         timestamptz,
  period_end           timestamptz,
  scheduled_plan_id    text,                             -- pending downgrade target
  scheduled_at         timestamptz,
  bonus_extractions    integer not null default 0,
  bonus_batch_urls     integer not null default 0,
  credit_balance_minor bigint  not null default 0,
  suspended_at         timestamptz,
  deactivated_at       timestamptz,
  purge_after          timestamptz,
  comp_until           timestamptz,                      -- admin grace; suppresses notices
  last_notice_kind     text,                             -- purge interlock reads this
  source               text,                             -- 'payment'|'admin'|'migration'
  version              bigint  not null default 1,       -- bumped on write; drives cache busting
  updated_at           timestamptz not null default now()
);

create index if not exists entitlements_period_end_idx on public.entitlements (period_end)
  where period_end is not null;                          -- the daily lifecycle cron's scan
create index if not exists entitlements_status_idx on public.entitlements (status);

alter table public.entitlements enable row level security;

drop policy if exists "entitlements select own" on public.entitlements;
create policy "entitlements select own" on public.entitlements
  for select to authenticated using (auth.uid() = user_id);

-- No insert/update/delete policy for ANYONE. Every write goes through the
-- service key (checkout, verify-payment, webhook, crons, admin). A user must
-- never be able to write their own entitlement row.
revoke insert, update, delete on public.entitlements from authenticated, anon;

-- ── 4. plan ranking (used by the merge rule) ──────────────────────────────────
create or replace function public.plan_rank(p_plan text)
returns integer language sql immutable as $$
  select case lower(coalesce(p_plan, 'free'))
    when 'agency'    then 6
    when 'business'  then 5
    when 'developer' then 4
    when 'pro'       then 4
    when 'select'    then 3
    when 'go'        then 2
    when 'free'      then 1
    else 0                              -- unknown plan ranks LOWEST, never wins a merge
  end;
$$;

-- ── 5. merge subscriptions → entitlements for one user ────────────────────────
-- Called after a claim. Rule: NEVER DOWNGRADE. Later period_end wins; on a tie
-- (or when both are null, which is the norm today because the one-time-order
-- path never sets current_period_end) the higher plan rank wins. Bonuses sum.
--
-- Deliberate safety choice: rows migrated from `subscriptions` land with
-- source='migration' and period_end=null, which means computeLifecycle() can
-- never suspend them. Existing customers are not retro-suspended by this
-- migration; the lifecycle only starts at their next real payment.
create or replace function public.merge_entitlement_from_subscriptions(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare best record;
begin
  if p_user is null then return; end if;

  select s.plan_id, s.current_period_start, s.current_period_end
    into best
    from public.subscriptions s
   where s.user_id = p_user
     and coalesce(s.status, 'active') <> 'cancelled'
   order by s.current_period_end desc nulls last,
            public.plan_rank(s.plan_id) desc,
            s.updated_at desc nulls last
   limit 1;

  if not found then return; end if;

  insert into public.entitlements (user_id, plan_id, period_start, period_end, source)
  values (p_user, coalesce(best.plan_id, 'free'), best.current_period_start,
          best.current_period_end, 'migration')
  on conflict (user_id) do update
    set plan_id = case
          when public.plan_rank(excluded.plan_id) > public.plan_rank(public.entitlements.plan_id)
          then excluded.plan_id else public.entitlements.plan_id end,
        period_end = greatest(
          coalesce(public.entitlements.period_end, '-infinity'::timestamptz),
          coalesce(excluded.period_end,            '-infinity'::timestamptz)),
        version    = public.entitlements.version + 1,
        updated_at = now()
    where public.entitlements.status = 'active';   -- never resurrect a purged row
end $$;

-- ── 6. claim_billing_session — the browser-callable claim RPC ─────────────────
-- SECURITY DEFINER + auth.uid() read INTERNALLY, so it is safe to call directly
-- from the client with the user's JWT: the caller cannot name a different user.
-- Refuses if the session is already linked to somebody else — that is the
-- anti-theft check (a shared/guessed session id must not transfer a paid plan).
create or replace function public.claim_billing_session(p_session_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); owner uuid;
begin
  if uid is null or p_session_id is null or p_session_id = '' then
    return jsonb_build_object('claimed', false, 'reason', 'no_auth');
  end if;

  select user_id into owner from public.billing_identity_links
   where session_id = p_session_id;

  if owner is not null and owner <> uid then
    return jsonb_build_object('claimed', false, 'reason', 'already_linked');
  end if;

  insert into public.billing_identity_links (session_id, user_id, source)
  values (p_session_id, uid, 'signin')
  on conflict (session_id) do nothing;

  update public.subscriptions  set user_id = uid where session_id = p_session_id and user_id is null;
  update public.payment_events set user_id = uid where session_id = p_session_id and user_id is null;
  update public.usage_records  set user_id = uid where session_id = p_session_id and user_id is null;

  perform public.merge_entitlement_from_subscriptions(uid);

  return jsonb_build_object('claimed', true);
end $$;

revoke execute on function public.claim_billing_session(text) from anon;
grant   execute on function public.claim_billing_session(text) to authenticated;
revoke execute on function public.merge_entitlement_from_subscriptions(uuid) from anon, authenticated;

-- ── Ordering note ─────────────────────────────────────────────────────────────
-- This file is step 1 of 3 and is behaviour-neutral on its own.
--   0012 (this)  nullable columns + link table + entitlements. Deploy alone.
--   ...          ship the dual-write release (claim on sign-in, user_id on all
--                new rows) and let it run for at least one release.
--   0013         backfill user_id from billing_identity_links; report orphans.
--   0014         flip RLS: drop `anon full access` on subscriptions/payment_events.
-- Only after 0014 may any server read entitlements for authorization.

notify pgrst, 'reload schema';


-- ============================================================
-- 0013_billing_backfill.sql
-- ============================================================
-- scripts/billing-backfill.sql — PR1 step 2 of 3 (backfill user_id).
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run (idempotent by
-- construction: every UPDATE is guarded by `user_id is null`).
--
-- RUN THIS ONLY AFTER the dual-write release has been live for at least one
-- release cycle. Before then, billing_identity_links is empty and this file is
-- a no-op — harmless, but pointless.
--
-- What it does: every session that has been claimed by a signed-in user gets
-- its historical billing rows stamped with that user_id. Rows that remain null
-- afterwards are genuine logged-out purchases; they stay session-keyed and are
-- reachable only via the emailed invoice link. We do NOT try to adopt them by
-- matching email addresses — that would be an account-takeover vector.

update public.subscriptions s
   set user_id = l.user_id
  from public.billing_identity_links l
 where l.session_id = s.session_id
   and s.user_id is null;

update public.payment_events p
   set user_id = l.user_id
  from public.billing_identity_links l
 where l.session_id = p.session_id
   and p.user_id is null;

update public.usage_records u
   set user_id = l.user_id
  from public.billing_identity_links l
 where l.session_id = u.session_id
   and u.user_id is null;

-- Rebuild entitlements for every user touched above, applying the never-
-- downgrade merge rule. Cheap: one row per linked user.
do $$
declare r record;
begin
  for r in select distinct user_id from public.billing_identity_links loop
    perform public.merge_entitlement_from_subscriptions(r.user_id);
  end loop;
end $$;

-- ── Orphan report ─────────────────────────────────────────────────────────────
-- Not an error. These are unclaimed guest purchases. Review the count before
-- running 0014 — after the RLS flip they are service-key-only, which is the
-- intended end state, but you want to know how many exist first.
do $$
declare orphan_subs int; orphan_events int;
begin
  select count(*) into orphan_subs   from public.subscriptions  where user_id is null;
  select count(*) into orphan_events from public.payment_events where user_id is null;
  raise notice 'billing backfill: % unclaimed subscription rows, % unclaimed payment_event rows',
    orphan_subs, orphan_events;
end $$;

notify pgrst, 'reload schema';


-- ============================================================
-- 0014_billing_rls.sql
-- ============================================================
-- scripts/billing-rls.sql — PR1 step 3 of 3 (lock down the billing tables).
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- WHAT THIS FIXES
-- 0001_core_tables_and_billing.sql created `subscriptions` and `payment_events`
-- with the policy:
--     create policy "anon full access" ... for all using (true) with check (true)
-- i.e. anyone holding the PUBLIC anon key — which ships in the browser bundle —
-- can read every customer's payment history, and can run
--     update subscriptions set plan_id = 'agency';
-- That was survivable only because entitlements were decided client-side and
-- the server never trusted these tables. The moment a server reads them for
-- authorization it becomes a privilege-escalation path, so this MUST land
-- before any entitlement enforcement ships.
--
-- End state: authenticated users may SELECT their own rows and nothing else.
-- Every write goes through the service key (create-checkout, verify-payment,
-- payment-webhook, the crons, admin). Guest/unclaimed rows (user_id is null)
-- become service-key-only, which is intended — they are reachable through the
-- signed link in the invoice email.

-- ── subscriptions ─────────────────────────────────────────────────────────────
drop policy if exists "anon full access"      on public.subscriptions;
drop policy if exists "subscriptions select own" on public.subscriptions;
create policy "subscriptions select own" on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

revoke all                      on public.subscriptions from anon;
revoke insert, update, delete   on public.subscriptions from authenticated;
grant  select                   on public.subscriptions to authenticated;

-- ── payment_events ────────────────────────────────────────────────────────────
drop policy if exists "anon full access"        on public.payment_events;
drop policy if exists "payment_events select own" on public.payment_events;
create policy "payment_events select own" on public.payment_events
  for select to authenticated using (auth.uid() = user_id);

revoke all                      on public.payment_events from anon;
revoke insert, update, delete   on public.payment_events from authenticated;
grant  select                   on public.payment_events to authenticated;

-- ── Deliberately NOT changed here ─────────────────────────────────────────────
-- `usage_records` and `usage_alerts` keep their `anon full access` policy for
-- now. Locking them breaks guest usage sync from src/lib/usageRepo.js, which
-- writes with the anon key for signed-out visitors. That is a privacy leak but
-- NOT an entitlement-escalation path (nothing authorizes off usage rows), so it
-- is tracked as its own follow-up rather than bundled into this change.
-- Do not "tidy" them into this file without first moving guest usage writes
-- behind a server function.

notify pgrst, 'reload schema';


-- ============================================================
-- 0015_scheduler_hardening.sql
-- ============================================================
-- scripts/scheduler-hardening.sql — PR1 (system pause flag + privilege fix).
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- WHY THIS IS IN PR1 AND NOT PR3
-- Two separate problems, one of which is a live security issue:
--
-- 1. SECURITY. netlify/functions/schedules.js builds its upsert row straight
--    from the client-supplied object, so the browser dictates `status`. Once
--    the lifecycle can pause a lapsed user's schedules, the very next client
--    upsert would silently un-pause them. Worse, today a client can already
--    write whatever it likes into these columns.
--
-- 2. The hourly runner needs the column to exist before it can filter on it.
--
-- THE DESIGN: two independent axes.
--   `status`        = USER intent      ('active' | 'paused')  — client-writable
--   `system_paused` = PLATFORM intent  (lapsed subscription, plan limit)
--
-- Keeping them separate is what makes requirement "a schedule the user had
-- manually paused stays paused after reactivation" fall out for free: resume
-- only clears `system_paused`, and the user's own 'paused' status is untouched.

alter table public.scheduled_tasks
  add column if not exists system_paused boolean not null default false;
alter table public.scheduled_tasks
  add column if not exists system_pause_reason text;   -- 'subscription_suspended' | 'plan_limit'

-- The hourly runner's scan predicate: status='active' AND system_paused=false.
create index if not exists scheduled_tasks_runner_idx
  on public.scheduled_tasks (status, system_paused);

-- ── Column-level privilege lock ───────────────────────────────────────────────
-- RLS cannot protect individual columns, only rows. A column REVOKE can, and it
-- is declarative and testable. schedules.js also strips these fields from the
-- payload (belt and braces) — but this is the part an attacker cannot route
-- around by calling PostgREST directly with a user JWT.
revoke insert (system_paused, system_pause_reason) on public.scheduled_tasks from authenticated, anon;
revoke update (system_paused, system_pause_reason) on public.scheduled_tasks from authenticated, anon;

-- NOTE: `user_id` is deliberately NOT revoked here. It is already protected by
-- the existing per-user RLS policy (auth.uid() = user_id in both USING and
-- WITH CHECK), and revoking UPDATE on it would break the legitimate
-- INSERT ... ON CONFLICT DO UPDATE upsert that schedules.js performs.

notify pgrst, 'reload schema';


-- ============================================================
-- 0016_invoices.sql
-- ============================================================
-- scripts/invoices.sql — PR2 (invoice drafts, invoices, gapless FY numbering).
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- Design notes that are easy to get wrong and expensive to fix later:
--
--  * MONEY IS INTEGER MINOR UNITS everywhere (paise / cents), never float.
--    Matches payment_events.amount_cents and Razorpay's own representation.
--
--  * AMOUNTS ARE SNAPSHOTTED, not recomputed. pricing_config is editable at
--    runtime and cached for only 60s, so re-deriving an old invoice from the
--    current price table would produce a different document. An issued invoice
--    must reproduce byte-for-byte forever.
--
--  * NUMBERING USES A COUNTER TABLE, NOT A SEQUENCE. Postgres sequences are
--    explicitly non-transactional: a rolled-back transaction still consumes the
--    number, leaving a gap. Gaps in a GST invoice series are exactly what an
--    auditor asks about. The row-locked UPDATE below rolls back with its
--    transaction, so the series is gapless by construction.

-- ── Invoice drafts ────────────────────────────────────────────────────────────
-- Written BEFORE the payment order is created, keyed by the provider order id.
-- This is the snapshot that lets verify-payment and the webhook both issue the
-- same invoice without trusting anything the browser sends back.
--
-- Rejected alternative: stuffing the decomposition into Razorpay `notes`. It is
-- capped at 15 keys / 256 chars per value, and — decisively — notes are partly
-- client-supplied (paymentService.js sets them in the browser), which would put
-- the client in charge of the numbers on a legal document.
create table if not exists public.invoice_drafts (
  order_id               text primary key,          -- razorpay order id / stripe session id
  provider               text not null,
  user_id                uuid references auth.users,
  session_id             text,
  email                  text,
  kind                   text not null,             -- 'plan' | 'bundle'
  plan_id                text not null,
  billing_period         text,
  qty                    integer not null default 1,
  currency               text not null,
  gross_minor            bigint not null,
  discount_minor         bigint not null default 0,
  proration_credit_minor bigint not null default 0,
  taxable_minor          bigint not null,
  tax_rate               numeric(6,4) not null default 0,
  tax_treatment          text,                      -- 'intra' | 'inter' | 'none'
  cgst_minor             bigint not null default 0,
  sgst_minor             bigint not null default 0,
  igst_minor             bigint not null default 0,
  tax_minor              bigint not null default 0,
  total_minor            bigint not null,
  coupon_code            text,
  discount_pct           numeric(6,2) not null default 0,
  period_start           timestamptz,
  period_end             timestamptz,
  place_of_supply        text,
  price_snapshot         jsonb not null,            -- the price row actually used
  buyer_snapshot         jsonb,
  supplier_snapshot      jsonb not null,
  lines                  jsonb not null default '[]'::jsonb,
  status                 text not null default 'pending',  -- pending|issued|abandoned
  invoice_id             uuid,
  created_at             timestamptz not null default now()
);
create index if not exists invoice_drafts_status_idx  on public.invoice_drafts (status, created_at);
create index if not exists invoice_drafts_session_idx on public.invoice_drafts (session_id);

alter table public.invoice_drafts enable row level security;
-- RLS on, NO policy: service key only. Drafts hold the price snapshot and are
-- never read by the browser.

-- ── Invoice counters + financial-year helper ──────────────────────────────────
create table if not exists public.invoice_counters (
  series   text   not null,
  fy       text   not null,
  last_seq bigint not null default 0,
  primary key (series, fy)
);
alter table public.invoice_counters enable row level security;   -- service key only

-- Indian financial year: 1 April – 31 March, in IST.
-- The timezone matters. 2027-03-31T23:00Z is 2027-04-01 04:30 IST, i.e. already
-- FY 27-28. Computing this in UTC books an out-of-order number in the wrong year.
create or replace function public.fy_of(ts timestamptz, tz text default 'Asia/Kolkata')
returns text language sql immutable as $$
  select case
    when extract(month from (ts at time zone tz)) >= 4
      then to_char((ts at time zone tz), 'YY') || '-' ||
           to_char(((ts at time zone tz) + interval '1 year'), 'YY')
    else to_char(((ts at time zone tz) - interval '1 year'), 'YY') || '-' ||
         to_char((ts at time zone tz), 'YY')
  end;
$$;

-- Allocate the next number in a (series, fy). Gapless and duplicate-free.
--
-- The UPDATE ... RETURNING takes a ROW LOCK held until COMMIT, so concurrent
-- issuers serialise on that single row and the second one reads the already
-- incremented value. Because the increment is part of the caller's transaction,
-- a rollback un-does it — which is precisely why this is a table and not a
-- sequence.
--
-- Never hold this lock across I/O: allocate, commit, and only then render the
-- PDF and send the email.
create or replace function public.next_invoice_no(p_series text, p_fy text)
returns text language plpgsql as $$
declare n bigint;
begin
  insert into public.invoice_counters (series, fy, last_seq)
  values (p_series, p_fy, 0)
  on conflict (series, fy) do nothing;

  update public.invoice_counters
     set last_seq = last_seq + 1
   where series = p_series and fy = p_fy
  returning last_seq into n;

  return p_series || '/' || p_fy || '/' || lpad(n::text, 6, '0');
end $$;

revoke execute on function public.next_invoice_no(text, text) from anon, authenticated;

-- ── Invoices ──────────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id                     uuid primary key default gen_random_uuid(),
  invoice_no             text not null unique,
  series                 text not null default 'DTQ',   -- DTQ invoices, DTQC credit notes
  fy                     text not null,
  seq                    bigint,
  doc_type               text not null,                 -- 'tax_invoice' | 'payment_receipt' | 'credit_note'
  user_id                uuid references auth.users,
  session_id             text,
  email                  text,

  plan_id                text,
  billing_period         text,
  qty                    integer not null default 1,
  period_start           timestamptz,
  period_end             timestamptz,

  currency               text not null,
  gross_minor            bigint not null,
  discount_minor         bigint not null default 0,
  proration_credit_minor bigint not null default 0,
  taxable_minor          bigint not null,
  tax_rate               numeric(6,4) not null default 0,
  tax_treatment          text,
  cgst_minor             bigint not null default 0,
  sgst_minor             bigint not null default 0,
  igst_minor             bigint not null default 0,
  tax_minor              bigint not null default 0,
  total_minor            bigint not null,
  coupon_code            text,
  place_of_supply        text,

  supplier_snapshot      jsonb not null,   -- legal name, address, GSTIN at issue time
  buyer_snapshot         jsonb,            -- name, address, GSTIN at issue time

  provider               text,
  provider_payment_id    text,
  provider_order_id      text,

  status                 text not null default 'paid',  -- paid|refunded|partially_refunded|void
  refunded_minor         bigint not null default 0,
  credit_note_of         uuid references public.invoices (id),

  pdf_path               text,
  pdf_sha256             text,
  reconstructed          boolean not null default false, -- issued without a draft

  issued_at              timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Idempotency: one invoice per captured payment. This is a CONSTRAINT rather
-- than a read-then-write check because verify-payment (synchronous) and the
-- payment webhook (asynchronous) genuinely race — the existing
-- read-then-write dedup in payment-webhook.js is not safe under concurrency.
create unique index if not exists invoices_provider_payment_uidx
  on public.invoices (provider, provider_payment_id)
  where provider_payment_id is not null;

create index if not exists invoices_user_idx    on public.invoices (user_id, issued_at desc);
create index if not exists invoices_session_idx on public.invoices (session_id, issued_at desc);
create index if not exists invoices_order_idx   on public.invoices (provider_order_id);

alter table public.invoices enable row level security;
drop policy if exists "invoices select own" on public.invoices;
create policy "invoices select own" on public.invoices
  for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.invoices from authenticated, anon;
grant  select on public.invoices to authenticated;

-- ── Invoice lines ─────────────────────────────────────────────────────────────
create table if not exists public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  line_no      integer not null,
  kind         text not null,          -- plan|bundle|discount|proration_credit
  description  text not null,
  hsn_sac      text,                   -- SAC 998314 for SaaS
  qty          integer not null default 1,
  unit_minor   bigint not null default 0,
  amount_minor bigint not null,        -- negative for discount / credit lines
  unique (invoice_id, line_no)
);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

alter table public.invoice_lines enable row level security;
drop policy if exists "invoice_lines select own" on public.invoice_lines;
create policy "invoice_lines select own" on public.invoice_lines
  for select to authenticated using (
    exists (select 1 from public.invoices i
             where i.id = invoice_lines.invoice_id and i.user_id = auth.uid())
  );
revoke insert, update, delete on public.invoice_lines from authenticated, anon;
grant  select on public.invoice_lines to authenticated;

-- ── Immutability ──────────────────────────────────────────────────────────────
-- An issued invoice is a legal document. Only its lifecycle fields may change:
-- status, refunded_minor, the rendered PDF pointer, and user_id when an
-- unclaimed guest invoice is later adopted (NULL → set, never re-pointed).
create or replace function public.invoices_immutable()
returns trigger language plpgsql as $$
begin
  if OLD.user_id is not null and NEW.user_id is distinct from OLD.user_id then
    raise exception 'invoices.user_id is immutable once set (invoice %)', OLD.invoice_no;
  end if;

  if (NEW.invoice_no, NEW.series, NEW.fy, NEW.seq, NEW.doc_type, NEW.currency,
      NEW.gross_minor, NEW.discount_minor, NEW.proration_credit_minor,
      NEW.taxable_minor, NEW.tax_rate, NEW.tax_treatment,
      NEW.cgst_minor, NEW.sgst_minor, NEW.igst_minor, NEW.tax_minor, NEW.total_minor,
      NEW.plan_id, NEW.billing_period, NEW.qty, NEW.place_of_supply,
      NEW.supplier_snapshot, NEW.buyer_snapshot,
      NEW.provider, NEW.provider_payment_id, NEW.provider_order_id,
      NEW.period_start, NEW.period_end, NEW.issued_at, NEW.credit_note_of)
     is distinct from
     (OLD.invoice_no, OLD.series, OLD.fy, OLD.seq, OLD.doc_type, OLD.currency,
      OLD.gross_minor, OLD.discount_minor, OLD.proration_credit_minor,
      OLD.taxable_minor, OLD.tax_rate, OLD.tax_treatment,
      OLD.cgst_minor, OLD.sgst_minor, OLD.igst_minor, OLD.tax_minor, OLD.total_minor,
      OLD.plan_id, OLD.billing_period, OLD.qty, OLD.place_of_supply,
      OLD.supplier_snapshot, OLD.buyer_snapshot,
      OLD.provider, OLD.provider_payment_id, OLD.provider_order_id,
      OLD.period_start, OLD.period_end, OLD.issued_at, OLD.credit_note_of)
  then
    raise exception
      'issued invoice % is immutable; only status, refunded_minor, pdf_path, pdf_sha256 may change',
      OLD.invoice_no;
  end if;

  NEW.updated_at := now();
  return NEW;
end $$;

drop trigger if exists invoices_immutable_trg on public.invoices;
create trigger invoices_immutable_trg
  before update on public.invoices
  for each row execute function public.invoices_immutable();

-- ── Email dedup ───────────────────────────────────────────────────────────────
-- Second line of defence behind issue_invoice's `created` flag, so a retry or a
-- concurrent webhook can never send the customer two copies of one invoice.
create table if not exists public.invoice_emails (
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  kind       text not null,                        -- 'issued' | 'resend' | 'reminder'
  sent_at    timestamptz not null default now(),
  primary key (invoice_id, kind)
);
alter table public.invoice_emails enable row level security;   -- service key only

-- ── issue_invoice — idempotent, gapless, race-safe ────────────────────────────
-- Order of operations matters:
--   1. Look for an existing invoice for this payment FIRST, so a retry consumes
--      no number at all.
--   2. Allocate the number INSIDE this transaction.
--   3. Catch unique_violation: a concurrent caller won the race, so return
--      their row. Our transaction rolls back — including the counter increment
--      — leaving no duplicate and no gap.
-- Returns { created: bool, invoice: {...} }. The caller MUST branch on `created`:
-- only a genuinely new invoice may render a PDF and email the customer.
-- Returning the row alone would make "issued" and "already existed"
-- indistinguishable, and the webhook would email a duplicate every retry.
create or replace function public.issue_invoice(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v      public.invoices;
  v_fy   text;
  v_no   text;
  v_ser  text := coalesce(p->>'series', 'DTQ');
  v_line jsonb;
  v_i    integer := 0;
begin
  if p->>'provider_payment_id' is not null then
    select * into v from public.invoices
     where provider = p->>'provider'
       and provider_payment_id = p->>'provider_payment_id';
    if found then
      return jsonb_build_object('created', false, 'invoice', to_jsonb(v));
    end if;
  end if;

  v_fy := public.fy_of(now());
  v_no := public.next_invoice_no(v_ser, v_fy);

  begin
    insert into public.invoices (
      invoice_no, series, fy,
      seq, doc_type, user_id, session_id, email,
      plan_id, billing_period, qty, period_start, period_end,
      currency, gross_minor, discount_minor, proration_credit_minor,
      taxable_minor, tax_rate, tax_treatment,
      cgst_minor, sgst_minor, igst_minor, tax_minor, total_minor,
      coupon_code, place_of_supply, supplier_snapshot, buyer_snapshot,
      provider, provider_payment_id, provider_order_id,
      status, credit_note_of, reconstructed
    ) values (
      v_no, v_ser, v_fy,
      (select last_seq from public.invoice_counters where series = v_ser and fy = v_fy),
      coalesce(p->>'doc_type', 'payment_receipt'),
      nullif(p->>'user_id','')::uuid, p->>'session_id', p->>'email',
      p->>'plan_id', p->>'billing_period',
      coalesce((p->>'qty')::int, 1),
      nullif(p->>'period_start','')::timestamptz, nullif(p->>'period_end','')::timestamptz,
      p->>'currency',
      coalesce((p->>'gross_minor')::bigint, 0),
      coalesce((p->>'discount_minor')::bigint, 0),
      coalesce((p->>'proration_credit_minor')::bigint, 0),
      coalesce((p->>'taxable_minor')::bigint, 0),
      coalesce((p->>'tax_rate')::numeric, 0),
      p->>'tax_treatment',
      coalesce((p->>'cgst_minor')::bigint, 0),
      coalesce((p->>'sgst_minor')::bigint, 0),
      coalesce((p->>'igst_minor')::bigint, 0),
      coalesce((p->>'tax_minor')::bigint, 0),
      coalesce((p->>'total_minor')::bigint, 0),
      p->>'coupon_code', p->>'place_of_supply',
      coalesce(p->'supplier_snapshot', '{}'::jsonb),
      p->'buyer_snapshot',
      p->>'provider', p->>'provider_payment_id', p->>'provider_order_id',
      coalesce(p->>'status', 'paid'),
      nullif(p->>'credit_note_of','')::uuid,
      coalesce((p->>'reconstructed')::boolean, false)
    ) returning * into v;
  exception when unique_violation then
    -- A concurrent caller won the race. Return THEIR row; our transaction rolls
    -- back, including the counter increment, so there is no duplicate and no gap.
    select * into v from public.invoices
     where provider = p->>'provider'
       and provider_payment_id = p->>'provider_payment_id';
    if found then
      return jsonb_build_object('created', false, 'invoice', to_jsonb(v));
    end if;
    raise;
  end;

  for v_line in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.invoice_lines
      (invoice_id, line_no, kind, description, hsn_sac, qty, unit_minor, amount_minor)
    values (
      v.id, v_i,
      coalesce(v_line->>'kind','plan'),
      coalesce(v_line->>'description',''),
      v_line->>'hsn_sac',
      coalesce((v_line->>'qty')::int, 1),
      coalesce((v_line->>'unit_minor')::bigint, 0),
      coalesce((v_line->>'amount_minor')::bigint, 0)
    );
  end loop;

  return jsonb_build_object('created', true, 'invoice', to_jsonb(v));
end $$;

revoke execute on function public.issue_invoice(jsonb) from anon, authenticated;

notify pgrst, 'reload schema';


-- ============================================================
-- 0017_billing_lifecycle.sql
-- ============================================================
-- scripts/billing-lifecycle.sql — PR3 (dunning log + admin audit trail).
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.

-- ── Notice log ────────────────────────────────────────────────────────────────
-- One row per (user, notice kind, billing cycle). The unique constraint IS the
-- idempotency mechanism, and it is also the index the cron reads.
--
-- TWO DELIBERATE DIFFERENCES FROM reengagement_log (0011), both of which are
-- bugs there that must not be inherited:
--
--  1. KEYED ON user_id, NOT EMAIL. reengagement_log keys on user_email. Emails
--     change; a user who updates theirs would silently receive the entire
--     notice series a second time.
--
--  2. window_key IS ANCHORED ON THE CYCLE, NOT ON TODAY. reengagement.js
--     builds `d7:${today}`, so a permanently-inactive user matches a fresh
--     window every single day and is emailed daily forever. For billing that is
--     catastrophic: a suspended customer would receive "your data will be
--     deleted in 7 days" every morning for two months. Here window_key is the
--     period_end date of the cycle the notice belongs to, e.g.
--     'lapsed:2026-08-14', so each notice fires exactly once per subscription
--     cycle no matter how often the cron runs.
create table if not exists public.billing_notice_log (
  id         bigserial primary key,
  user_id    uuid not null references auth.users on delete cascade,
  kind       text not null,          -- renewal_t7 | renewal_t2 | lapsed_d0 | suspend_d7 |
                                     -- suspend_d21 | deactivate_d30 | delete_d83 |
                                     -- delete_d88 | delete_d90 | downgrade_scheduled
  window_key text not null,          -- 'lapsed:2026-08-14' — the CYCLE, never today
  channel    text not null default 'email',
  sent_at    timestamptz not null default now(),
  unique (user_id, kind, window_key)
);

create index if not exists billing_notice_log_user_idx on public.billing_notice_log (user_id, sent_at desc);

alter table public.billing_notice_log enable row level security;
-- Service key only: the crons write it and nothing in the browser reads it.

-- ── Admin audit trail ─────────────────────────────────────────────────────────
-- Every manual override of the billing lifecycle. An admin can suspend an
-- account, restore one without payment, grant free time, or record money that
-- never went through the gateway — all of which need to be attributable and
-- explained. `reason` is NOT NULL on purpose: the API requires one.
create table if not exists public.billing_audit_log (
  id         bigserial primary key,
  actor      text not null,            -- admin identity from the session token
  action     text not null,            -- suspend | reactivate | comp | offline_payment |
                                       -- plan_change | invoice_resend | invoice_regenerate |
                                       -- refund
  user_id    uuid references auth.users,
  invoice_id uuid references public.invoices (id),
  reason     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists billing_audit_log_user_idx    on public.billing_audit_log (user_id, created_at desc);
create index if not exists billing_audit_log_created_idx on public.billing_audit_log (created_at desc);

alter table public.billing_audit_log enable row level security;   -- service key only

-- ── Cron heartbeat ────────────────────────────────────────────────────────────
-- billing-purge refuses to delete anything unless billing-lifecycle has
-- succeeded recently. Without this, a dunning cron that silently stopped (a bad
-- deploy, a disabled schedule) plus a healthy purge cron would delete data from
-- users who were never warned. That combination is the single worst failure
-- mode in this whole feature, so the interlock gets its own table.
create table if not exists public.billing_cron_runs (
  job          text primary key,       -- 'billing-lifecycle' | 'billing-purge'
  last_success timestamptz,
  last_detail  jsonb not null default '{}'::jsonb
);

alter table public.billing_cron_runs enable row level security;   -- service key only

notify pgrst, 'reload schema';


-- ============================================================
-- 0018_ops_monitoring.sql
-- ============================================================
-- 0018_ops_monitoring.sql — operational monitoring for automation + services.
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- WHAT THIS IS FOR
-- Until now the platform had no way to answer three operational questions:
--
--   1. "Did the cron actually run?"  — the only evidence was billing_cron_runs
--      (0017), which stores ONE row per job holding its LAST SUCCESS. That is
--      exactly right as the purge interlock it was built for, and useless as a
--      monitoring surface: a job that has been failing for six days looks
--      identical to one that has never been deployed, because a failure writes
--      nothing at all. This migration adds an append-only run LOG alongside it.
--      billing_cron_runs is NOT replaced — billing-purge's interlock still
--      reads it, and that interlock must keep its own dedicated, minimal
--      dependency.
--
--   2. "Is the database / auth / platform up, and how fast?" — health_samples
--      is the time series behind uptime percentages and latency benchmarks.
--      Without stored samples an admin screen can only ever show "up right
--      now", which is the least interesting thing to know.
--
--   3. "Who stopped that job, and why?" — ops_audit_log. Same rule as
--      billing_audit_log (0017): `reason` is NOT NULL *and* CHECK-constrained
--      to be non-blank, because an audit row that says only "someone disabled
--      the billing cron" is worse than no row at all — it looks like an answer.
--
-- ALL THREE TABLES ARE SERVICE-KEY ONLY. RLS is enabled with no policy, so a
-- browser JWT reads nothing. These rows describe infrastructure, name internal
-- job ids, and would let any signed-in user infer when the platform is weakest.

-- ── Automation run log ───────────────────────────────────────────────────────
-- One row per execution ATTEMPT of a platform job. Written by
-- netlify/functions/lib/jobControl.js (withJobRun) around every cron handler.
--
-- `status` starts at 'running' and is patched at the end, so a row that is
-- still 'running' long after started_at is itself the signal that a job died
-- mid-flight — the case a last-success-only table can never show.
create table if not exists public.job_runs (
  id          bigserial primary key,
  job         text not null,                     -- 'scheduled-runner' | 'reengagement' |
                                                 -- 'billing-lifecycle' | 'billing-purge' |
                                                 -- 'health-monitor'
  status      text not null default 'running',   -- running | success | error | skipped
  trigger     text not null default 'schedule',  -- schedule | manual
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  detail      jsonb not null default '{}'::jsonb,
  error       text,
  constraint job_runs_status_chk
    check (status in ('running', 'success', 'error', 'skipped')),
  constraint job_runs_trigger_chk
    check (trigger in ('schedule', 'manual'))
);

-- The dashboard's only read pattern: latest N runs for one job.
create index if not exists job_runs_job_started_idx on public.job_runs (job, started_at desc);
-- Retention sweeps and the "anything failing anywhere?" summary.
create index if not exists job_runs_started_idx     on public.job_runs (started_at desc);

alter table public.job_runs enable row level security;   -- service key only

-- ── Service / host health samples ────────────────────────────────────────────
-- One row per component per probe. Written by health-monitor (@hourly) and,
-- opportunistically, by admin-health when an operator loads the dashboard.
--
-- `component` matches an id in src/lib/healthModel.js COMPONENTS so the model
-- that renders a sample is the same one that classified it.
create table if not exists public.health_samples (
  id          bigserial primary key,
  component   text not null,          -- 'supabase-db' | 'supabase-auth' | 'netlify-site' | …
  status      text not null,          -- ok | degraded | down | unknown
  latency_ms  integer,
  observed_at timestamptz not null default now(),
  detail      jsonb not null default '{}'::jsonb,
  constraint health_samples_status_chk
    check (status in ('ok', 'degraded', 'down', 'unknown'))
);

create index if not exists health_samples_component_idx on public.health_samples (component, observed_at desc);
create index if not exists health_samples_observed_idx  on public.health_samples (observed_at desc);

alter table public.health_samples enable row level security;   -- service key only

-- ── Operator audit trail ─────────────────────────────────────────────────────
-- Every manual intervention from /admin/monitoring: disabling a cron, pausing
-- someone's schedule, triggering a run by hand.
--
-- WHY `reason` GETS A CHECK AND NOT JUST NOT NULL: billing_audit_log relies on
-- the handler to reject a blank reason. That works, but it means the guarantee
-- lives in JavaScript. Stopping the billing cron is the kind of action whose
-- explanation is read months later by someone reconstructing an incident, so
-- here the emptiness rule is in the schema where no future handler can forget
-- it. '' and '   ' are both rejected.
create table if not exists public.ops_audit_log (
  id         bigserial primary key,
  actor      text not null,            -- admin identity from the session token
  action     text not null,            -- job_disable | job_enable | job_run |
                                       -- schedule_pause | schedule_resume
  target     text,                     -- job id or schedule id
  reason     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ops_audit_log_reason_chk check (length(btrim(reason)) > 0)
);

create index if not exists ops_audit_log_created_idx on public.ops_audit_log (created_at desc);
create index if not exists ops_audit_log_target_idx  on public.ops_audit_log (target, created_at desc);

alter table public.ops_audit_log enable row level security;   -- service key only

-- ── Retention ────────────────────────────────────────────────────────────────
-- job_runs and health_samples are append-only and grow forever: five jobs plus
-- ~12 components sampled hourly is roughly 150k rows a year, which is small but
-- unbounded. This prunes both to a rolling window.
--
-- ops_audit_log is DELIBERATELY NOT PRUNED. It is the record of who turned the
-- billing cron off, and a retention job that quietly erases that is precisely
-- the thing an audit trail exists to prevent.
--
-- Not scheduled by anything yet — call it from the SQL editor, or add it to a
-- cron once volume justifies it. Returns the number of rows removed.
create or replace function public.prune_ops_history(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz;
  v_runs   integer;
  v_health integer;
begin
  if p_days is null or p_days < 1 then
    raise exception 'prune_ops_history: p_days must be >= 1 (got %)', p_days;
  end if;

  v_cutoff := now() - make_interval(days => p_days);

  -- A row still marked 'running' is never pruned by age alone: it is the only
  -- evidence of a job that died mid-flight, and it must survive long enough for
  -- someone to see it. Once finished_at is set, normal retention applies.
  delete from public.job_runs
   where started_at < v_cutoff
     and status <> 'running';
  get diagnostics v_runs = row_count;

  delete from public.health_samples where observed_at < v_cutoff;
  get diagnostics v_health = row_count;

  return v_runs + v_health;
end;
$$;

revoke all on function public.prune_ops_history(integer) from public, anon, authenticated;

notify pgrst, 'reload schema';


-- ============================================================
-- 0019_api_keys.sql
-- ============================================================
-- 0019_api_keys.sql
-- Public REST API keys (F-INT-1 — API Access, Business/Enterprise plans).
--
-- The public Developer API (docs/DatIQ-Developer-API.md) lets customers hit
-- DatIQ from their own code with a bearer token. This migration creates:
--   * api_keys       — the keys themselves, hashed, with revocation + expiry
--   * api_key_usage  — monthly counter for per-key quota enforcement
--   * increment_api_key_usage() RPC — atomic counter bump
--
-- Security model: only the SHA-256 hash of the key is stored. The plaintext
-- is shown ONCE at creation time and never persisted. A DB leak does not
-- leak usable keys.

create extension if not exists "pgcrypto";

create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  key_hash      text not null unique,
  key_prefix    text not null,                        -- e.g. "dq_live_aB3x…"
  env           text not null check (env in ('live','test')),
  label         text,
  plan_id       text,                                  -- plan at issue time
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists api_keys_user_idx       on public.api_keys (user_id);
create index if not exists api_keys_hash_idx       on public.api_keys (key_hash);
create index if not exists api_keys_active_idx     on public.api_keys (user_id) where revoked_at is null;

alter table public.api_keys enable row level security;
-- A user can manage their own keys. The /api/* functions use the SERVICE
-- key to read/write (RLS bypassed) because the request's auth identity is
-- the key, not a Supabase user JWT.
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'api_keys' and policyname = 'users own api_keys'
  ) then
    execute $POL$
      create policy "users own api_keys" on public.api_keys
        for all to authenticated
        using (auth.uid() = user_id) with check (auth.uid() = user_id)
    $POL$;
  end if;
end $$;

-- ── Monthly quota counter ───────────────────────────────────────────────────
-- One row per (key, month). `month` is 'YYYY-MM'. We don't need a unique
-- constraint on month format because we control writes from the service.
create table if not exists public.api_key_usage (
  key_id  uuid not null references public.api_keys(id) on delete cascade,
  month   text not null,
  count   integer not null default 0,
  primary key (key_id, month)
);

alter table public.api_key_usage enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'api_key_usage' and policyname = 'service manages usage'
  ) then
    execute 'create policy "service manages usage" on public.api_key_usage
             for all to service_role using (true) with check (true)';
  end if;
end $$;

-- ── Atomic increment RPC ────────────────────────────────────────────────────
-- Returns the new count for (key_id, month), creating the row if needed.
-- Used by lib/apiRateLimiter.js to enforce the monthly quota without
-- read-modify-write races.
create or replace function public.increment_api_key_usage(p_key_id uuid, p_month text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.api_key_usage (key_id, month, count)
    values (p_key_id, p_month, 1)
    on conflict (key_id, month)
    do update set count = public.api_key_usage.count + 1
    returning count into new_count;
  return new_count;
end;
$$;

-- Restrict execution to the service role. (An authenticated user calling
-- this directly could inflate another user's counter, even with RLS on
-- api_key_usage, so we lock the function down.)
revoke all on function public.increment_api_key_usage(uuid, text) from public;
grant execute on function public.increment_api_key_usage(uuid, text) to service_role;


-- ============================================================
-- 0020_integration_connections.sql
-- ============================================================
-- 0020_integration_connections.sql
-- Per-user OAuth/PAT storage for third-party integrations (HubSpot, Notion,
-- Airtable, Slack, Zapier). All integrations that need to call an external
-- API on the user's behalf read their token from this table.
--
-- SECURITY: access_token and refresh_token are sensitive. v1 stores them
-- in plaintext (the only reader is the SERVICE key holder, and RLS further
-- restricts per-user visibility). v1.1 should add a pgcrypto envelope.

create table if not exists public.integration_connections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null check (provider in ('hubspot','notion','airtable','slack','zapier','google_sheets')),
  access_token  text,
  refresh_token text,
  scopes        text,
  account_id    text,
  account_label text,
  expires_at    timestamptz,
  config        jsonb,                       -- provider-specific
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists integration_connections_user_idx
  on public.integration_connections (user_id);

alter table public.integration_connections enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'integration_connections' and policyname = 'users own connections'
  ) then
    execute $POL$
      create policy "users own connections" on public.integration_connections
        for all to authenticated
        using (auth.uid() = user_id) with check (auth.uid() = user_id)
    $POL$;
  end if;
end $$;

-- Service role can read/write all rows (the /api/* functions use the
-- SERVICE key to do server-side work on the user's behalf).
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'integration_connections' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.integration_connections
             for all to service_role using (true) with check (true)';
  end if;
end $$;


-- ============================================================
-- 0021_zapier_events.sql
-- ============================================================
-- 0021_zapier_events.sql
-- Event log for the Zapier integration. Triggers (new_extraction,
-- new_enrichment, monitoring_alert) append rows here; Zapier polls them
-- via /api/integrations/zapier/poll.

create table if not exists public.zapier_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_type  text not null check (event_type in ('new_extraction','new_enrichment','monitoring_alert')),
  payload     jsonb not null,
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  unique (user_id, event_type, dedupe_key)
);

create index if not exists zapier_events_user_type_time_idx
  on public.zapier_events (user_id, event_type, created_at desc);

alter table public.zapier_events enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'zapier_events' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.zapier_events
             for all to service_role using (true) with check (true)';
  end if;
end $$;


-- ============================================================
-- 0022_workflow_events.sql
-- ============================================================
-- scripts/workflow-events.sql — v2 plan: workflow_events / workflow_runs / workflow_subscriptions.
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run (every statement is
-- IF NOT EXISTS or guarded).
-- Full context: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §5
--
-- ============================================================================
-- DatIQ — 0018 workflow_events / workflow_runs / workflow_subscriptions
-- ============================================================================
--
-- Three tables that back the n8n + self-hosted-n8n-MCP-server workflow pipeline:
--
--   1. public.workflow_events
--        The queue. One row per automation event. State machine:
--        pending → processing → done | failed | cancelled.
--        Polled every 5 min by netlify/functions/workflow-orchestrator.js
--        and dispatched to self-hosted n8n (Hostinger VPS).
--
--   2. public.workflow_runs
--        Per-attempt log. One row per dispatch attempt of a workflow_event.
--        Lets you answer "what happened on attempt 2 of wfe_xyz?" — without
--        this table, debugging a stuck event means staring at n8n logs.
--
--   3. public.workflow_subscriptions
--        Per-user channel preferences. Powers the "also DM me on Telegram
--        when this changes" idea; today the only implicit subscription is
--        "this user wants email for schedule X" (stored in scheduled_tasks.data).
--
-- RLS posture:
--   • workflow_events        — service key only (no anon policy). Written/read
--                               by Netlify Functions (orchestrator, scheduled-runner)
--                               and the n8n Supabase node (which uses the service key).
--   • workflow_runs          — same. Always joined to an event anyway.
--   • workflow_subscriptions — per-user CRUD for the owning user, service key
--                               for the orchestrator.
--
-- Idempotent (IF NOT EXISTS / OR REPLACE) — safe to re-run.
-- Run after 0011 (last existing migration).
-- ============================================================================


-- ── 1. workflow_events ────────────────────────────────────────────────────
create table if not exists public.workflow_events (
  id              text primary key,                  -- 'wfe_' + nanoid; client-generated
  kind            text not null,                     -- 'schedule.changed' | 'contact.received' |
                                                     -- 'user.lifecycle'  | 'op.alert'
  ref_id          text,                              -- sch_xxx | contact id | user_id (nullable)
  user_id         uuid references auth.users,        -- nullable (guests / system events)
  payload         jsonb not null default '{}'::jsonb,-- full event data, kept as-is for replay
  channels        jsonb not null default '[]'::jsonb,-- [{type:'email'|'slack'|'n8n'|'webhook', target, template}]
  state           text not null default 'pending',   -- pending | processing | done | failed | cancelled
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  started_at      timestamptz,                       -- when state → processing
  finished_at     timestamptz,                       -- when state → done | failed | cancelled
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint workflow_events_state_chk check (
    state in ('pending', 'processing', 'done', 'failed', 'cancelled')
  )
);

-- Indexes for the orchestrator's poll + the diagnostic MCP tools.
create index if not exists workflow_events_state_next_attempt_idx
  on public.workflow_events (state, next_attempt_at);
create index if not exists workflow_events_ref_id_idx
  on public.workflow_events (ref_id);
create index if not exists workflow_events_user_id_idx
  on public.workflow_events (user_id);
create index if not exists workflow_events_kind_idx
  on public.workflow_events (kind);
create index if not exists workflow_events_created_at_idx
  on public.workflow_events (created_at desc);

alter table public.workflow_events enable row level security;
-- No anon policy: service key bypasses RLS; this table is server-side only.


-- ── 2. workflow_runs ──────────────────────────────────────────────────────
create table if not exists public.workflow_runs (
  id              text primary key,                  -- 'wfr_' + nanoid
  event_id        text not null references public.workflow_events(id) on delete cascade,
  attempt_n       integer not null,
  channel         text,                              -- 'n8n' | 'email' | 'slack' | 'webhook' | 'force-dispatch'
  request         jsonb,                             -- the request body sent
  response_status integer,                           -- HTTP status (null if never reached)
  response_body   text,                              -- truncated to 4 KB to keep the table small
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  duration_ms     integer,
  error           text,

  unique (event_id, attempt_n)
);

create index if not exists workflow_runs_event_id_idx
  on public.workflow_runs (event_id, attempt_n desc);

alter table public.workflow_runs enable row level security;
-- No anon policy: server-side only.


-- ── 3. workflow_subscriptions ─────────────────────────────────────────────
create table if not exists public.workflow_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null,                        -- 'schedule' | 'contact' | 'payment' | 'user'
  ref_id      text,                                 -- schedule id, payment id, etc. NULL = applies to all of this kind for the user
  channels    jsonb not null default '[]'::jsonb,  -- [{type:'email'|'slack'|'telegram'|'discord'|'webhook', target, enabled, template?}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (user_id, kind, ref_id)
);

create index if not exists workflow_subscriptions_user_id_idx
  on public.workflow_subscriptions (user_id);

alter table public.workflow_subscriptions enable row level security;

-- Per-user CRUD. The orchestrator uses the service key to read these.
drop policy if exists "users own workflow_subscriptions" on public.workflow_subscriptions;
create policy "users own workflow_subscriptions" on public.workflow_subscriptions
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── 4. updated_at trigger (shared) ────────────────────────────────────────
-- Both workflow_events and workflow_subscriptions have an updated_at column;
-- a tiny trigger keeps it fresh on every UPDATE.
create or replace function public.workflow_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists workflow_events_set_updated_at on public.workflow_events;
create trigger workflow_events_set_updated_at
  before update on public.workflow_events
  for each row execute function public.workflow_set_updated_at();

drop trigger if exists workflow_subscriptions_set_updated_at on public.workflow_subscriptions;
create trigger workflow_subscriptions_set_updated_at
  before update on public.workflow_subscriptions
  for each row execute function public.workflow_set_updated_at();


-- ── Done. Verify: ─────────────────────────────────────────────────────────
--   select count(*) from public.workflow_events;     -- should be 0 on a fresh DB
--   select count(*) from public.workflow_runs;
--   select count(*) from public.workflow_subscriptions;
--   \d public.workflow_events                        -- expect 15 columns + 5 indexes


-- ============================================================
-- 0023_consent.sql
-- ============================================================
-- 0023_consent.sql
-- Analytics-consent records and their audit trail.
--
-- Why this exists at all: a consent choice kept only in localStorage cannot
-- answer the two questions that matter when someone asks. "When did I agree,
-- and to what?" needs a durable, timestamped, policy-versioned record. "Delete
-- my analytics data" needs a key to delete BY. A browser key provides neither
-- the moment it is cleared.
--
-- ── Subject keying ───────────────────────────────────────────────────────
-- Most consent is given BEFORE signup — a visitor lands from search, answers
-- the banner, and only creates an account later, if ever. So the subject is
-- keyed on the anonymous session id (usageRepo.getSessionId), and user_id is
-- back-filled when that session later signs in. Keying on user_id alone would
-- mean no record for the majority of visitors, which is exactly the population
-- a regulator asks about.
--
-- ── Two tables, on purpose ───────────────────────────────────────────────
--   consent_records — current state. One row per subject, upserted.
--   consent_audit   — append-only history. Every change, forever.
-- A single mutable table cannot show that consent was granted in March and
-- withdrawn in August; an audit trail whose rows can be updated is not an
-- audit trail. Same reasoning as ops_audit_log in 0018.
--
-- ── Privacy of the consent record itself ─────────────────────────────────
-- No raw IP is stored. A coarse country (from Netlify's own geo context) is
-- enough to reason about which regime applies, and collecting a full IP to
-- prove someone consented to analytics would be self-defeating.
--
-- RLS is enabled with NO anon policy, deliberately: these rows are written and
-- read only by the service key via /api/consent. Same posture as
-- pricing_config — a client that could write here could forge consent.

create table if not exists public.consent_records (
  id             uuid primary key default gen_random_uuid(),
  -- 'session:<id>' before sign-in, so the natural key is stable and unique
  -- whether or not a user_id is ever attached.
  subject_key    text not null unique,
  session_id     text not null,
  user_id        uuid references auth.users(id) on delete cascade,
  analytics      text not null check (analytics in ('granted','denied')),
  policy_version text not null,
  -- GA4's User Deletion API keys on client_id. Capturing it at consent time is
  -- what makes a later Google-side erasure request possible at all; without it
  -- we could delete our own rows and nothing else.
  ga_client_id   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists consent_records_session_idx
  on public.consent_records (session_id);
create index if not exists consent_records_user_idx
  on public.consent_records (user_id)
  where user_id is not null;

create table if not exists public.consent_audit (
  id             uuid primary key default gen_random_uuid(),
  subject_key    text not null,
  session_id     text,
  -- Plain uuid, NO foreign key — two reasons, both load-bearing:
  --   1. `on delete set null` would UPDATE this row when a user is deleted,
  --      which the append-only trigger below rejects, making account deletion
  --      fail outright.
  --   2. An audit row records that consent happened. It should survive the
  --      subject's deletion, not be silently rewritten by it.
  -- consent_records keeps the real FK (on delete cascade), so the *current
  -- state* still disappears with the account.
  user_id        uuid,
  analytics      text not null check (analytics in ('granted','denied')),
  policy_version text not null,
  source         text not null check (source in ('banner','privacy_page','withdrawal','link')),
  user_agent     text,
  -- Coarse ISO country only. NEVER an IP address — see the header note.
  country        text,
  ts             timestamptz not null default now()
);

create index if not exists consent_audit_subject_time_idx
  on public.consent_audit (subject_key, ts desc);

alter table public.consent_records enable row level security;
alter table public.consent_audit   enable row level security;

-- Service-role only. There is intentionally no anon or authenticated policy:
-- every read and write goes through netlify/functions/consent.js, which
-- resolves user_id from the JWT rather than trusting the request body.
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'consent_records' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.consent_records
             for all to service_role using (true) with check (true)';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'consent_audit' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.consent_audit
             for all to service_role using (true) with check (true)';
  end if;
end $$;

-- consent_audit is append-only at the database level, not merely by convention.
-- A trigger is the only thing that makes "append-only" survive a future
-- handler bug or an operator with the service key doing a well-meant cleanup.
create or replace function public.consent_audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'consent_audit is append-only: % is not permitted', tg_op;
end $$;

drop trigger if exists consent_audit_no_change on public.consent_audit;
create trigger consent_audit_no_change
  before update or delete on public.consent_audit
  for each row execute function public.consent_audit_immutable();


-- ============================================================
-- 0024_analytics_rls.sql
-- ============================================================
-- 0024_analytics_rls.sql
-- Close the world-readable analytics event log.
--
-- ── What was wrong ───────────────────────────────────────────────────────
-- 0005_analytics.sql shipped these two policies:
--
--   create policy "anon read access"   on public.analytics_events
--     for select using (true);
--   create policy "anon insert access" on public.analytics_events
--     for insert with check (true);
--
-- justified in its own header as "the data we record is non-PII (no email, no
-- user content)". That was not accurate: every row carries session_id, a
-- nullable user_id, and a free-form jsonb `properties` blob that call sites
-- fill with whatever they like. `for select using (true)` means ANY holder of
-- the anon key — which is published in the browser bundle by design — could
-- read the entire behavioural history of every visitor and every signed-in
-- user. That is a data exposure, not a schema detail.
--
-- It also made the consent work undeliverable. 0023 adds a "withdraw and
-- erase" promise; a table anyone can read is a table from which nothing can
-- meaningfully be erased.
--
-- ── What changes ─────────────────────────────────────────────────────────
-- Both anon policies are dropped. Writes move to netlify/functions/analytics.js
-- which uses the service key (service_role bypasses RLS), reached from the
-- browser via POST /api/analytics. Reads have no caller today — computeFunnel()
-- in analyticsService.js is exercised only by its own tests — so nothing breaks.
-- Any future admin analytics screen must read through a verifyAdminToken()-gated
-- function, the same rule that already governs admin-revenue.js.
--
-- Deliberately NOT done here: adding a permissive authenticated-insert policy
-- as a "safety net". A net that lets the browser write directly is the hole
-- this migration exists to close.

drop policy if exists "anon read access"   on public.analytics_events;
drop policy if exists "anon insert access" on public.analytics_events;

alter table public.analytics_events enable row level security;

-- Explicit service-role grant. service_role already bypasses RLS, so this is
-- documentation-as-code: it states who the intended writer is, and makes the
-- absence of any other policy obviously deliberate rather than an oversight
-- that a future migration might "fix" by re-opening the table.
do $$ begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'analytics_events' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.analytics_events
             for all to service_role using (true) with check (true)';
  end if;
end $$;

-- Consent withdrawal (POST /api/consent/withdraw) deletes by session_id and by
-- user_id. The session index already exists from 0005; this makes the user_id
-- path a lookup rather than a sequential scan over the whole log.
create index if not exists analytics_events_user_not_null_idx
  on public.analytics_events (user_id)
  where user_id is not null;


-- ============================================================
-- 0025_gallery_curation.sql
-- ============================================================
-- 0025_gallery_curation.sql
-- Persona tagging + a human-verified promotion step for the public gallery
-- (/gallery, public_reports — see 0007_public_reports.sql).
--
-- ── Why ──────────────────────────────────────────────────────────────────
-- Today anything in public_reports is anon-insertable (0007's "anon insert"
-- policy is `with check (true)` by design — we never reject a share because
-- the visitor isn't signed in) and shows up in /gallery immediately. That's
-- correct for "share my one extraction with a colleague," but it means
-- /gallery itself is just a feed of whatever anonymous visitors happened to
-- share, not a curated showcase — there is no way to say "these N reports
-- are good examples of what a sales / SEO / recruiter persona can do here."
--
-- This migration adds that as pure metadata on top of the existing table.
-- It does NOT touch is_public or any existing RLS policy: curating a report
-- is a promotion within already-public rows, not a new publish path, and a
-- report a user shared and later deletes is still governed by the existing
-- owner-delete policy regardless of whether it was ever curated.
--
-- The verification step itself is enforced by netlify/functions/admin-gallery.js
-- (verifyAdminToken()-gated, same pattern as admin-revenue.js / admin-monitoring.js)
-- — this migration only adds the columns that record that a human reviewed
-- the row before curated flipped to true. It cannot itself prove a human
-- looked; that's the admin function's job, not the schema's.

alter table public.public_reports
  add column if not exists persona     text,
  add column if not exists curated     boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text;

-- Kept nullable and constrained rather than an enum: the 7 ids live in
-- src/lib/personaConfig.js (application code, not the DB), and a CHECK that
-- mirrors them catches a typo in the admin UI without requiring a migration
-- every time a persona is renamed — update this list alongside personaConfig.js.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'public_reports_persona_check'
  ) then
    alter table public.public_reports
      add constraint public_reports_persona_check
      check (persona is null or persona in (
        'sales', 'competitive-intel', 'seo', 'market-research',
        'recruiter', 'founder-vc', 'agency'
      ));
  end if;
end $$;

-- /gallery's persona filter reads "curated rows for persona X" — this is
-- its hot path, so it gets its own partial index rather than relying on the
-- existing created_at index to filter after the fact.
create index if not exists public_reports_curated_persona_idx
  on public.public_reports (persona, created_at desc)
  where curated = true;


-- ============================================================
-- 0026_guest_identity_usage.sql
-- ============================================================
-- Server-authoritative anonymous identity and usage counters.
-- Raw guest identifiers are never stored; the server stores only a SHA-256 hash.

create table if not exists public.guest_identities (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  single_count  integer not null default 0 check (single_count >= 0),
  batch_count   integer not null default 0 check (batch_count >= 0),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists guest_identities_last_seen_idx on public.guest_identities (last_seen_at);
alter table public.guest_identities enable row level security;

create or replace function public.consume_guest_credit(
  p_token_hash text,
  p_kind text default 'single',
  p_single_limit integer default 10,
  p_batch_limit integer default 5
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare row_guest public.guest_identities; current_count integer; max_count integer;
begin
  if p_token_hash is null or length(trim(p_token_hash)) < 32 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_guest_identity', 'remaining', 0);
  end if;
  insert into public.guest_identities (token_hash) values (p_token_hash) on conflict (token_hash) do nothing;
  select * into row_guest from public.guest_identities where token_hash = p_token_hash for update;
  if p_kind = 'batch' then
    current_count := row_guest.batch_count; max_count := greatest(coalesce(p_batch_limit, 5), 1);
  else
    current_count := row_guest.single_count; max_count := greatest(coalesce(p_single_limit, 10), 1);
  end if;
  if current_count >= max_count then
    update public.guest_identities set last_seen_at = now(), updated_at = now() where id = row_guest.id;
    return jsonb_build_object('allowed', false, 'reason', p_kind || '_limit_reached', 'remaining', 0, 'kind', p_kind);
  end if;
  if p_kind = 'batch' then
    update public.guest_identities set batch_count = batch_count + 1, last_seen_at = now(), updated_at = now() where id = row_guest.id;
    current_count := row_guest.batch_count + 1;
  else
    update public.guest_identities set single_count = single_count + 1, last_seen_at = now(), updated_at = now() where id = row_guest.id;
    current_count := row_guest.single_count + 1;
  end if;
  return jsonb_build_object('allowed', true, 'remaining', greatest(max_count - current_count, 0), 'kind', p_kind);
end;
$$;

revoke all on public.guest_identities from anon, authenticated;
revoke all on function public.consume_guest_credit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_guest_credit(text, text, integer, integer) to service_role;
notify pgrst, 'reload schema';


-- ============================================================
-- 0027_admin_coupon_grants.sql
-- ============================================================
-- 0027_admin_coupon_grants.sql
-- User-specific, one-time, non-recurring complimentary plan grants.
-- These rows are deliberately separate from pricing_config.coupons and
-- coupon_redemptions: an admin grant is not a paid checkout discount.

create table if not exists public.admin_coupon_assignments (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users on delete cascade,
  code                     text not null,
  plan_id                  text not null check (plan_id in ('free', 'go', 'select', 'pro', 'business', 'agency')),
  validity_months          integer not null check (validity_months between 1 and 24),
  claim_expires_at         timestamptz,
  status                   text not null default 'assigned'
                           check (status in ('assigned', 'redeemed', 'revoked', 'expired')),
  assigned_by              text not null,
  reason                   text not null,
  assigned_at              timestamptz not null default now(),
  redeemed_at              timestamptz,
  redemption_period_start  timestamptz,
  redemption_period_end    timestamptz,
  revoked_at               timestamptz,
  created_at               timestamptz not null default now()
);

create unique index if not exists admin_coupon_assignments_code_uq
  on public.admin_coupon_assignments (upper(code));
create index if not exists admin_coupon_assignments_user_idx
  on public.admin_coupon_assignments (user_id, assigned_at desc);
create index if not exists admin_coupon_assignments_status_idx
  on public.admin_coupon_assignments (status, claim_expires_at);

alter table public.admin_coupon_assignments enable row level security;
-- Service-key-only: the admin function and the user redemption function are
-- the only writers/readers. No browser can enumerate another user's grants.

create or replace function public.create_admin_coupon_assignment(
  p_user_id uuid,
  p_code text,
  p_plan_id text,
  p_validity_months integer,
  p_claim_expires_at timestamptz,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare created public.admin_coupon_assignments;
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;
  if p_code is null or trim(p_code) = '' then raise exception 'code_required'; end if;
  if p_plan_id not in ('free', 'go', 'select', 'pro', 'business', 'agency') then
    raise exception 'unknown_plan';
  end if;
  if p_validity_months is null or p_validity_months < 1 or p_validity_months > 24 then
    raise exception 'invalid_validity_months';
  end if;
  if p_reason is null or trim(p_reason) = '' then raise exception 'reason_required'; end if;

  insert into public.admin_coupon_assignments (
    user_id, code, plan_id, validity_months, claim_expires_at,
    assigned_by, reason
  ) values (
    p_user_id, upper(trim(p_code)), p_plan_id, p_validity_months,
    p_claim_expires_at, coalesce(nullif(trim(p_actor), ''), 'admin'), trim(p_reason)
  ) returning * into created;

  insert into public.billing_audit_log (actor, action, user_id, reason, detail)
  values (
    coalesce(nullif(trim(p_actor), ''), 'admin'),
    'admin_coupon_assign',
    p_user_id,
    trim(p_reason),
    jsonb_build_object(
      'assignment_id', created.id,
      'code', created.code,
      'plan_id', created.plan_id,
      'validity_months', created.validity_months,
      'claim_expires_at', created.claim_expires_at
    )
  );

  return to_jsonb(created);
exception
  when unique_violation then
    raise exception 'coupon_code_already_exists';
end;
$$;

create or replace function public.redeem_admin_coupon(
  p_user_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_row public.admin_coupon_assignments;
  current_ent public.entitlements;
  starts_at timestamptz := now();
  ends_at timestamptz;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'error', 'Authentication required.');
  end if;
  if p_code is null or trim(p_code) = '' then
    return jsonb_build_object('ok', false, 'code', 'CODE_REQUIRED', 'error', 'Enter a grant coupon code.');
  end if;

  select * into grant_row
    from public.admin_coupon_assignments
   where user_id = p_user_id
     and upper(code) = upper(trim(p_code))
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_GRANT', 'error', 'This coupon is not assigned to your account.');
  end if;

  if grant_row.status <> 'assigned' then
    return jsonb_build_object(
      'ok', false,
      'code', case when grant_row.status = 'expired' then 'GRANT_EXPIRED' else 'GRANT_ALREADY_USED' end,
      'error', case when grant_row.status = 'expired' then 'This grant coupon has expired.' else 'This grant coupon has already been used or revoked.' end
    );
  end if;

  if grant_row.claim_expires_at is not null and grant_row.claim_expires_at <= now() then
    update public.admin_coupon_assignments
       set status = 'expired'
     where id = grant_row.id;
    return jsonb_build_object('ok', false, 'code', 'GRANT_EXPIRED', 'error', 'This grant coupon has expired.');
  end if;

  select * into current_ent
    from public.entitlements
   where user_id = p_user_id
   for update;

  -- Never replace an active paid or existing plan entitlement. The user can
  -- redeem after that access ends; the assignment remains unused.
  if current_ent.user_id is not null
     and current_ent.plan_id <> 'free'
     and current_ent.status not in ('deactivated', 'purged')
     and (current_ent.period_end is null or current_ent.period_end > now()) then
    return jsonb_build_object(
      'ok', false,
      'code', 'ACTIVE_ENTITLEMENT',
      'error', 'Your current plan is still active. Apply this grant after it ends.',
      'plan_id', current_ent.plan_id,
      'period_end', current_ent.period_end
    );
  end if;

  ends_at := starts_at + make_interval(months => grant_row.validity_months);

  insert into public.entitlements (
    user_id, plan_id, status, billing_period, period_start, period_end,
    scheduled_plan_id, scheduled_at, comp_until, last_notice_kind,
    source, version, updated_at
  ) values (
    p_user_id, grant_row.plan_id, 'active', 'once', starts_at, ends_at,
    null, null, null, null, 'admin_coupon', 1, now()
  )
  on conflict (user_id) do update set
    plan_id = excluded.plan_id,
    status = 'active',
    billing_period = 'once',
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    scheduled_plan_id = null,
    scheduled_at = null,
    comp_until = null,
    last_notice_kind = null,
    source = 'admin_coupon',
    version = public.entitlements.version + 1,
    updated_at = now();

  update public.admin_coupon_assignments
     set status = 'redeemed',
         redeemed_at = now(),
         redemption_period_start = starts_at,
         redemption_period_end = ends_at
   where id = grant_row.id;

  insert into public.billing_audit_log (actor, action, user_id, reason, detail)
  values (
    'user:' || p_user_id::text,
    'admin_coupon_redeem',
    p_user_id,
    grant_row.reason,
    jsonb_build_object(
      'assignment_id', grant_row.id,
      'code', grant_row.code,
      'plan_id', grant_row.plan_id,
      'period_start', starts_at,
      'period_end', ends_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', grant_row.code,
    'plan_id', grant_row.plan_id,
    'period_start', starts_at,
    'period_end', ends_at,
    'validity_months', grant_row.validity_months
  );
end;
$$;

revoke all on public.admin_coupon_assignments from anon, authenticated;
revoke execute on function public.create_admin_coupon_assignment(uuid, text, text, integer, timestamptz, text, text) from anon, authenticated;
revoke execute on function public.redeem_admin_coupon(uuid, text) from anon, authenticated;

notify pgrst, 'reload schema';


-- ============================================================
-- 0028_scrape_consent.sql
-- ============================================================
-- 0028_scrape_consent.sql
-- Per-host scraping attestations ("I have permission to scrape this site").
--
-- ── What this is, and what it is NOT ─────────────────────────────────────
-- DatIQ honours robots.txt by default (netlify/functions/lib/complianceEngine.js).
-- When a host disallows us, the refusal stands unless the person asking has
-- told us, on the record, that they have permission for that host. This table
-- is that record. It is an OVERRIDE, not a bypass: the robots.txt check still
-- runs and still decides, and this only answers the follow-up question "is
-- there an attestation for this user and this host?".
--
-- ── Signed-in only, deliberately ─────────────────────────────────────────
-- user_id is NOT NULL, unlike 0023_consent.sql, which keys on an anonymous
-- session precisely so pre-signup visitors are covered. The opposite is right
-- here. An attestation moves responsibility for a scrape onto the person
-- making it, and a guest identity — a cookie that survives until it is
-- cleared — is nobody to move it to. A guest can re-attest infinitely and
-- cannot be held to it. Anonymous callers are refused and asked to sign in.
--
-- ── Two tables, same reasoning as 0023 ───────────────────────────────────
--   scrape_consent_records — current state. One row per (user, host).
--   scrape_consent_audit   — append-only history, trigger-enforced.
-- A mutable single table cannot show that permission was claimed in March and
-- withdrawn in August, and an audit trail whose rows can be edited is not an
-- audit trail.
--
-- RLS is enabled with NO anon and NO authenticated policy, deliberately: these
-- rows are written and read only by the service key, via
-- netlify/functions/scrape-consent.js, which resolves the user from the JWT.
-- A client that could write here could forge its own authorisation to scrape.

create table if not exists public.scrape_consent_records (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- Normalised by the handler: lowercased, leading "www." stripped, so
  -- www.example.com and example.com are ONE grant. It deliberately does not
  -- extend to other subdomains — permission for a company's careers site is
  -- not permission for its API host.
  host           text not null,
  policy_version text not null,
  granted_at     timestamptz not null default now(),
  -- A self-certification should not outlive the circumstances it was made in.
  -- 180 days, then it must be renewed.
  expires_at     timestamptz not null default (now() + interval '180 days'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, host)
);

create index if not exists scrape_consent_records_lookup_idx
  on public.scrape_consent_records (user_id, host);

create table if not exists public.scrape_consent_audit (
  id             uuid primary key default gen_random_uuid(),
  -- Plain uuid, NO foreign key — the same two load-bearing reasons spelled out
  -- in 0023_consent.sql: an `on delete set null` would UPDATE this row when a
  -- user is deleted, which the append-only trigger below rejects, making
  -- account deletion fail outright; and an audit row records that an
  -- attestation was made, so it should survive its subject rather than be
  -- silently rewritten. scrape_consent_records keeps the real FK, so the
  -- CURRENT state still disappears with the account.
  user_id        uuid not null,
  host           text not null,
  action         text not null check (action in ('granted', 'withdrawn', 'expired')),
  policy_version text not null,
  source         text not null check (source in ('extract_refusal', 'settings', 'withdrawal')),
  user_agent     text,
  -- Coarse ISO country only, from Netlify's geo context. NEVER an IP address —
  -- same posture as consent_audit in 0023.
  country        text,
  ts             timestamptz not null default now()
);

create index if not exists scrape_consent_audit_user_time_idx
  on public.scrape_consent_audit (user_id, ts desc);

alter table public.scrape_consent_records enable row level security;
alter table public.scrape_consent_audit   enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'scrape_consent_records' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.scrape_consent_records
             for all to service_role using (true) with check (true)';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'scrape_consent_audit' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.scrape_consent_audit
             for all to service_role using (true) with check (true)';
  end if;
end $$;

-- Append-only at the DATABASE level, not merely by convention. A trigger is the
-- only thing that makes that survive a future handler bug or an operator with
-- the service key doing a well-meant cleanup.
create or replace function public.scrape_consent_audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'scrape_consent_audit is append-only: % is not permitted', tg_op;
end $$;

drop trigger if exists scrape_consent_audit_no_change on public.scrape_consent_audit;
create trigger scrape_consent_audit_no_change
  before update or delete on public.scrape_consent_audit
  for each row execute function public.scrape_consent_audit_immutable();


-- ============================================================
-- 0029_referrals.sql
-- ============================================================
-- 0029_referrals.sql
-- Referral codes and redemptions ("invite a friend, you both get 25").
--
-- ── Why this exists ──────────────────────────────────────────────────────
-- The referral feature shipped as a UI shell over localStorage, and every part
-- of it that mattered was broken:
--
--   1. Codes were derived by an LCG whose multiply overflowed
--      Number.MAX_SAFE_INTEGER, zeroing the low bits, so `% 32` was always 0
--      and EVERY user got the same code, "AAAAAAAA". Attribution was
--      impossible even in principle.
--   2. The redeemed bonus was written to `datiq.referralBonus`, which nothing
--      reads except the banner's own label. The quota reads
--      `subscription.bonusExtractions`. So the banner said "you have 25 bonus
--      extractions" on the same screen that refused to extract.
--   3. Redemption happened entirely in the INVITEE's browser, so the referrer
--      — the person the reward is supposed to motivate — was never credited,
--      despite the copy promising both sides get 25.
--   4. The self-referral check compared against the code in the same
--      localStorage, so any second browser farmed it without limit.
--
-- Codes and rewards are therefore server-issued and server-granted. A referral
-- grants real paid quota; it cannot live in a store the beneficiary can write.
--
-- ── Signed-in only ───────────────────────────────────────────────────────
-- Both columns are NOT NULL uuids referencing auth.users. Same reasoning as
-- 0028_scrape_consent.sql: an anonymous identity can be cleared and re-made
-- without limit, so it is not something a reward can be attributed to. The
-- advertised flow already says "when they sign up with your link".
--
-- RLS is enabled with NO anon and NO authenticated policy: these rows are read
-- and written only by the service key via netlify/functions/referral.js, which
-- resolves the user from the JWT. A client that could write here could grant
-- itself unlimited extractions.

create table if not exists public.referral_codes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);

-- Lookup by code is the redemption hot path.
create index if not exists referral_codes_code_idx on public.referral_codes (code);

create table if not exists public.referral_redemptions (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  referrer_user_id  uuid not null references auth.users(id) on delete cascade,
  -- UNIQUE, not just indexed: one redemption per invitee ACCOUNT, ever. This is
  -- the constraint that makes the reward finite — without it a new browser
  -- profile is a new 25 extractions, forever.
  invitee_user_id   uuid not null unique references auth.users(id) on delete cascade,
  bonus_granted     integer not null,
  created_at        timestamptz not null default now(),
  -- Belt and braces alongside the handler's own check: the database itself
  -- refuses a self-referral, so a future handler bug cannot reintroduce it.
  constraint referral_no_self check (referrer_user_id <> invitee_user_id)
);

create index if not exists referral_redemptions_referrer_idx
  on public.referral_redemptions (referrer_user_id, created_at desc);

alter table public.referral_codes       enable row level security;
alter table public.referral_redemptions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'referral_codes' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.referral_codes
             for all to service_role using (true) with check (true)';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'referral_redemptions' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.referral_redemptions
             for all to service_role using (true) with check (true)';
  end if;
end $$;

-- ── Code issuance ────────────────────────────────────────────────────────
-- Idempotent: returns the caller's existing code, or mints one.
--
-- The alphabet excludes 0/O/1/I because these codes get read aloud and typed
-- by hand. Uniqueness comes from the UNIQUE constraint plus a retry loop, NOT
-- from hoping a hash does not collide — which is exactly what the broken
-- client-side derivation assumed.
create or replace function public.issue_referral_code(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_existing text;
  i          integer;
  attempt    integer := 0;
begin
  if p_user_id is null then
    raise exception 'issue_referral_code requires a user id';
  end if;

  select code into v_existing from public.referral_codes where user_id = p_user_id;
  if v_existing is not null then
    return v_existing;
  end if;

  loop
    attempt := attempt + 1;
    v_code := '';
    for i in 1..8 loop
      -- floor(random()*32) is uniform over 0..31; length() keeps it honest if
      -- the alphabet is ever edited.
      v_code := v_code || substr(v_alphabet, floor(random() * length(v_alphabet))::int + 1, 1);
    end loop;

    begin
      insert into public.referral_codes (user_id, code) values (p_user_id, v_code);
      return v_code;
    exception
      when unique_violation then
        -- Either the code collided, or this user raced another request and
        -- already has one. Re-read before retrying: if the row now exists the
        -- race is resolved, not an error.
        select code into v_existing from public.referral_codes where user_id = p_user_id;
        if v_existing is not null then
          return v_existing;
        end if;
        if attempt >= 12 then
          raise exception 'could not allocate a unique referral code after % attempts', attempt;
        end if;
    end;
  end loop;
end $$;

-- ── Redemption ───────────────────────────────────────────────────────────
-- Atomic, and credits BOTH sides in the same transaction. Returns a jsonb
-- verdict rather than raising, so the handler can report a reason without
-- distinguishing exception classes:
--
--   {"ok": true,  "bonus": 25, "referrer": "<uuid>"}
--   {"ok": false, "reason": "invalid"}   — no such code
--   {"ok": false, "reason": "self"}      — your own code
--   {"ok": false, "reason": "already"}   — this account already redeemed one
--
-- Note it upserts into `entitlements`: a brand-new invitee may have no row yet,
-- and the reward must not depend on one existing. `version` is bumped so the
-- 60s client entitlement cache busts rather than serving a stale limit.
create or replace function public.redeem_referral_code(
  p_invitee_id uuid, p_code text, p_bonus integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_referrer uuid;
  v_clean    text;
begin
  if p_invitee_id is null or p_code is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  v_clean := upper(btrim(p_code));

  select user_id into v_referrer from public.referral_codes where code = v_clean;
  if v_referrer is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_referrer = p_invitee_id then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;

  -- The unique constraint on invitee_user_id is the real guard; catching it is
  -- what makes a double-submit idempotent rather than a 500.
  begin
    insert into public.referral_redemptions (code, referrer_user_id, invitee_user_id, bonus_granted)
    values (v_clean, v_referrer, p_invitee_id, p_bonus);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end;

  insert into public.entitlements (user_id, bonus_extractions)
  values (p_invitee_id, p_bonus)
  on conflict (user_id) do update
    set bonus_extractions = public.entitlements.bonus_extractions + p_bonus,
        version           = public.entitlements.version + 1,
        updated_at        = now();

  insert into public.entitlements (user_id, bonus_extractions)
  values (v_referrer, p_bonus)
  on conflict (user_id) do update
    set bonus_extractions = public.entitlements.bonus_extractions + p_bonus,
        version           = public.entitlements.version + 1,
        updated_at        = now();

  return jsonb_build_object('ok', true, 'bonus', p_bonus, 'referrer', v_referrer);
end $$;


-- ============================================================
-- 0030_discoverability_audits.sql
-- ============================================================
-- 0030_discoverability_audits.sql
-- The Discoverability module: SEO / AEO / GEO audit engine.
--
-- ── WHAT THIS STORES, AND WHY IT IS SHAPED THIS WAY ───────────────────────
-- An audit produces four kinds of thing with different lifetimes and different
-- access patterns, and flattening them into one row would make three of the
-- four useless:
--
--   audits + audit_results   the job and its headline numbers. Read constantly
--                            (dashboards, trends), small, never mutated.
--   audit_signals            one row per signal per audit. This is what makes a
--                            score EXPLAINABLE — a stated non-functional
--                            requirement — and what lets "show me twelve months
--                            of core_web_vitals for this page" be a query
--                            rather than twelve JSON parses.
--   audit_issues             findings. Immutable evidence of what was true then.
--   audit_recommendations    the only MUTABLE child: accepted / dismissed /
--                            done. It is a work queue, not a record.
--
-- ── DEVIATIONS FROM THE PRD SCHEMA, DELIBERATE ────────────────────────────
-- The PRD specifies `workspaces` and `users` tables and its own
-- /api/v1/auth/login. DatIQ already has Supabase auth and an entitlements
-- model. Building a second identity system beside the real one is how an app
-- ends up with two answers to "who is this?", and the wrong one gating access.
-- So:
--
--   PRD workspaces  →  auth.users.id, with a nullable workspace_id column
--                      reserved on every table for when team workspaces ship.
--   PRD users       →  auth.users
--   PRD issues      →  audit_issues        (name-collision safety)
--   PRD recommendations → audit_recommendations
--
-- ── RLS ───────────────────────────────────────────────────────────────────
-- Owners read their own rows. WRITES ARE SERVICE-KEY ONLY, on every table
-- without exception. An audit score is not user-supplied data: a client that
-- could write audit_results could award itself a 100 and publish it, and the
-- benchmark and trend features would be quoting numbers nobody measured.

-- ── Bonus audit credits ────────────────────────────────────────────────────
-- Mirrors entitlements.bonus_extractions. Additive, defaulted, so existing rows
-- need no backfill and the column is safe to add ahead of any top-up bundle
-- that grants it.
alter table public.entitlements
  add column if not exists bonus_audits integer not null default 0;

-- ── Targets ────────────────────────────────────────────────────────────────
-- A stable identity for "this page", so audits of the same URL over time form
-- one history. Normalisation happens in the application (see urlIdentity.js);
-- this table just enforces one row per (owner, canonical URL).
create table if not exists public.audit_targets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  -- Reserved for team workspaces. Nullable today, so the column can be
  -- back-filled without a second migration when workspaces ship.
  workspace_id      uuid,
  canonical_url     text not null,
  host              text not null,
  page_type_default text,
  label             text,
  tags              text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One target per owner per URL. This is what makes re-auditing accumulate a
-- history instead of scattering across duplicate targets.
create unique index if not exists audit_targets_owner_url_idx
  on public.audit_targets (user_id, canonical_url);
create index if not exists audit_targets_host_idx on public.audit_targets (user_id, host);

-- ── Audits ─────────────────────────────────────────────────────────────────
create table if not exists public.audits (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  workspace_id      uuid,
  target_id         uuid not null references public.audit_targets(id) on delete cascade,
  target_url        text not null,
  device_profile    text not null default 'mobile'
                      check (device_profile in ('mobile','desktop')),
  audit_profile     text not null default 'balanced'
                      check (audit_profile in ('balanced','seo','aeo','geo')),
  page_type_hint    text,
  page_type         text,
  status            text not null default 'queued'
                      check (status in ('queued','running','completed','failed')),
  -- Self-reference: the audit this run is being compared against.
  baseline_audit_id uuid references public.audits(id) on delete set null,
  prompt_set_id     uuid,
  -- Callers send this to make audit creation safely retryable. A dropped
  -- response must not spend a second audit credit on the same request.
  idempotency_key   text,
  source            text not null default 'api'
                      check (source in ('api','ui','schedule','benchmark','rerun')),
  tags              text[] not null default '{}',
  error             text,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists audits_owner_status_idx
  on public.audits (user_id, status, created_at desc);
create index if not exists audits_target_idx
  on public.audits (target_id, created_at desc);
-- Partial: only non-null keys participate, so audits created without one (the
-- interactive UI path) do not collide with each other on a null.
create unique index if not exists audits_idempotency_idx
  on public.audits (user_id, idempotency_key) where idempotency_key is not null;

-- ── Results ────────────────────────────────────────────────────────────────
-- One row per audit, keyed BY the audit: a result cannot outlive its job and
-- there can never be two.
create table if not exists public.audit_results (
  audit_id                     uuid primary key references public.audits(id) on delete cascade,
  user_id                      uuid not null references auth.users(id) on delete cascade,
  final_score                  numeric(5,2),
  seo_score                    numeric(5,2),
  aeo_score                    numeric(5,2),
  geo_score                    numeric(5,2),
  headline_framework           text,
  answer_clarity_score         numeric(5,2),
  entity_authority_score       numeric(5,2),
  structural_hierarchy_score   numeric(5,2),
  technical_accessibility_score numeric(5,2),
  pre_penalty_score            numeric(5,2),
  penalty_multiplier           numeric(6,4) not null default 1,
  -- What share of the intended evidence this audit actually gathered. Stored,
  -- not derived: a 92 built on 40% coverage is not a 92, and a trend line has
  -- to be able to show that one of its points was thin.
  coverage                     numeric(5,2),
  estimated_total_lift         numeric(6,2),
  issue_count                  integer not null default 0,
  critical_count               integer not null default 0,
  facts_json                   jsonb not null default '{}'::jsonb,
  evidence_json                jsonb not null default '{}'::jsonb,
  engine_json                  jsonb not null default '{}'::jsonb,
  created_at                   timestamptz not null default now()
);

-- Portfolio sorting: "show me my worst pages".
create index if not exists audit_results_score_idx on public.audit_results (user_id, final_score);
create index if not exists audit_results_facts_gin on public.audit_results using gin (facts_json);

-- ── Signals ────────────────────────────────────────────────────────────────
create table if not exists public.audit_signals (
  id               uuid primary key default gen_random_uuid(),
  audit_id         uuid not null references public.audits(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  pillar           text not null,
  signal_code      text not null,
  -- NULL is a first-class value here, not missing data. It means the signal was
  -- not measured or does not apply, and its weight was redistributed. A NOT
  -- NULL default of 0 would silently convert every unmeasured signal into a
  -- failure the moment anyone queried this table directly.
  normalized_score numeric(5,2),
  weight           numeric(6,4) not null,
  measured         boolean not null default true,
  unknown_reason   text,
  raw_value        jsonb,
  evidence_json    jsonb,
  created_at       timestamptz not null default now()
);

create unique index if not exists audit_signals_unique_idx
  on public.audit_signals (audit_id, signal_code);
-- The trend query: one signal's history for one target.
create index if not exists audit_signals_code_idx on public.audit_signals (user_id, signal_code, created_at desc);
create index if not exists audit_signals_evidence_gin on public.audit_signals using gin (evidence_json);

-- ── Issues ─────────────────────────────────────────────────────────────────
create table if not exists public.audit_issues (
  id              uuid primary key default gen_random_uuid(),
  audit_id        uuid not null references public.audits(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  code            text not null,
  pillar          text not null,
  severity        text not null check (severity in ('critical','high','medium','low')),
  framework_scope text[] not null default '{}',
  title           text not null,
  evidence        text,
  details_json    jsonb,
  created_at      timestamptz not null default now()
);

create unique index if not exists audit_issues_unique_idx on public.audit_issues (audit_id, code);
create index if not exists audit_issues_severity_idx on public.audit_issues (user_id, severity, created_at desc);

-- ── Recommendations ────────────────────────────────────────────────────────
-- The one mutable child. Everything else records what was true at audit time;
-- this is a work queue a human moves through.
create table if not exists public.audit_recommendations (
  id                    uuid primary key default gen_random_uuid(),
  audit_id              uuid not null references public.audits(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  code                  text not null,
  issue_id              uuid references public.audit_issues(id) on delete set null,
  pillar                text not null,
  frameworks            text[] not null default '{}',
  priority              text not null check (priority in ('high','medium','low')),
  priority_score        numeric(5,2),
  impact_score          numeric(5,2),
  effort_score          numeric(5,2),
  confidence_score      numeric(5,2),
  estimated_lift        numeric(6,2),
  owner_role            text,
  title                 text not null,
  rationale             text,
  evidence              text,
  implementation_asset_json jsonb,
  status                text not null default 'open'
                          check (status in ('open','accepted','dismissed','done')),
  -- Required by the handler when status becomes 'dismissed'. A dismissal with
  -- no reason is indistinguishable from a mis-click three months later, and the
  -- acceptance-rate metric becomes unreadable.
  dismiss_reason        text,
  status_changed_at     timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists audit_recommendations_unique_idx
  on public.audit_recommendations (audit_id, code);
create index if not exists audit_recommendations_queue_idx
  on public.audit_recommendations (audit_id, priority, status);
create index if not exists audit_recommendations_open_idx
  on public.audit_recommendations (user_id, status, priority_score desc);

-- ── Prompt sets and sampling runs ──────────────────────────────────────────
create table if not exists public.audit_prompt_sets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  name         text not null,
  description  text,
  prompts_json jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists audit_prompt_sets_owner_idx on public.audit_prompt_sets (user_id, created_at desc);

create table if not exists public.audit_prompt_runs (
  id                  uuid primary key default gen_random_uuid(),
  audit_id            uuid not null references public.audits(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  prompt_set_id       uuid references public.audit_prompt_sets(id) on delete set null,
  engine_name         text not null,
  -- FALSE means the sample came from a language model's recall rather than a
  -- live answer engine with web retrieval. They are different measurements and
  -- the UI must be able to say which it is showing.
  live                boolean not null default false,
  prompt              text not null,
  mention_detected    boolean,
  citation_detected   boolean,
  cited_domains_json  jsonb,
  sentiment_score     numeric(4,3),
  -- An EXCERPT, capped by the application at 300 characters. Answer-engine
  -- output is volatile and can be policy-sensitive; the guidance is to keep
  -- normalised evidence and a short excerpt, never a full transcript.
  raw_response_excerpt text,
  created_at          timestamptz not null default now()
);

create index if not exists audit_prompt_runs_audit_idx on public.audit_prompt_runs (audit_id, engine_name);

-- ── Benchmarks ─────────────────────────────────────────────────────────────
create table if not exists public.audit_benchmarks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  name         text not null,
  description  text,
  -- The URL that is "us" in a competitive set, so the comparison view knows
  -- which column to anchor on.
  primary_url  text,
  audit_profile text not null default 'balanced'
                  check (audit_profile in ('balanced','seo','aeo','geo')),
  status       text not null default 'pending'
                 check (status in ('pending','running','completed','failed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists audit_benchmarks_owner_idx on public.audit_benchmarks (user_id, created_at desc);

create table if not exists public.audit_benchmark_members (
  id           uuid primary key default gen_random_uuid(),
  benchmark_id uuid not null references public.audit_benchmarks(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  url          text not null,
  label        text,
  -- Set once the member's audit completes. Null while the set is still running.
  audit_id     uuid references public.audits(id) on delete set null,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);

create unique index if not exists audit_benchmark_members_unique_idx
  on public.audit_benchmark_members (benchmark_id, url);

-- ── Scheduled monitoring ───────────────────────────────────────────────────
-- Deliberately NOT folded into public.scheduled_tasks. That table is the
-- extraction scheduler, read hourly by scheduled-runner.js with its own row
-- shape and its own system_paused semantics; adding a discriminator column
-- would put two unrelated job kinds behind one cron's assumptions.
create table if not exists public.audit_schedules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  workspace_id   uuid,
  target_id      uuid not null references public.audit_targets(id) on delete cascade,
  name           text,
  cadence        text not null default 'weekly'
                   check (cadence in ('daily','weekly','monthly')),
  device_profile text not null default 'mobile'
                   check (device_profile in ('mobile','desktop')),
  audit_profile  text not null default 'balanced'
                   check (audit_profile in ('balanced','seo','aeo','geo')),
  -- The user's intent.
  status         text not null default 'active' check (status in ('active','paused')),
  -- The platform's, protected by the column REVOKE below. Same split as
  -- scheduled_tasks: a schedule an operator paused must not be resumable by
  -- the user, and one the USER paused must stay paused when the platform
  -- resumes everything it stopped.
  system_paused        boolean not null default false,
  system_pause_reason  text,
  alert_email    text,
  -- Only notify when the score moves by at least this much, so a weekly
  -- monitor does not email about 0.3-point noise.
  alert_threshold numeric(5,2) not null default 3,
  last_run_at    timestamptz,
  last_audit_id  uuid references public.audits(id) on delete set null,
  next_run_at    timestamptz,
  run_until      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists audit_schedules_due_idx
  on public.audit_schedules (status, system_paused, next_run_at);

-- ── Webhooks ───────────────────────────────────────────────────────────────
create table if not exists public.audit_webhooks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,
  target_url       text not null,
  -- Encrypted at rest by lib/integrationSecrets.js, never stored in plaintext
  -- and never returned by any endpoint. The signing secret is shown to the user
  -- exactly once, at creation.
  secret_encrypted text,
  events           text[] not null default '{audit.completed}',
  active           boolean not null default true,
  last_status      integer,
  last_delivered_at timestamptz,
  failure_count    integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists audit_webhooks_owner_idx on public.audit_webhooks (user_id, active);

-- ── Audit trail ────────────────────────────────────────────────────────────
-- Who created, re-ran, exported or deleted what. Never pruned by
-- prune_audit_history(): a retention job that erases the record of a deletion
-- is exactly what an audit trail exists to prevent.
create table if not exists public.audit_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  workspace_id  uuid,
  audit_id      uuid references public.audits(id) on delete set null,
  event_type    text not null,
  payload_json  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_events_owner_idx on public.audit_events (user_id, created_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Owners READ their own rows; only the service key WRITES. A client that could
-- write audit_results could award itself a 100 and publish it, and every
-- benchmark and trend built on top would be quoting a number nobody measured.
--
-- audit_recommendations is the single exception: a user changes their own
-- recommendation status. Even there the UPDATE is routed through the handler,
-- which is what enforces "a dismissal carries a reason".
do $$
declare
  t text;
begin
  foreach t in array array[
    'audit_targets','audits','audit_results','audit_signals','audit_issues',
    'audit_recommendations','audit_prompt_sets','audit_prompt_runs',
    'audit_benchmarks','audit_benchmark_members','audit_schedules',
    'audit_webhooks','audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    if not exists (select 1 from pg_policies where tablename = t and policyname = 'owner reads') then
      execute format(
        'create policy "owner reads" on public.%I for select to authenticated using (auth.uid() = user_id)', t);
    end if;

    if not exists (select 1 from pg_policies where tablename = t and policyname = 'service writes') then
      execute format(
        'create policy "service writes" on public.%I for all to service_role using (true) with check (true)', t);
    end if;
  end loop;
end $$;

-- The user's own work queue. Scoped to their rows, and to status changes only
-- in practice because nothing else in the row is theirs to edit.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'audit_recommendations' and policyname = 'owner updates status'
  ) then
    execute 'create policy "owner updates status" on public.audit_recommendations
             for update to authenticated
             using (auth.uid() = user_id) with check (auth.uid() = user_id)';
  end if;
end $$;

-- ── Column-level privilege lock ────────────────────────────────────────────
-- RLS protects ROWS, never individual columns. A column REVOKE protects
-- columns, and it is the part a caller cannot route around by going straight to
-- PostgREST with a user JWT. Same protection scheduled_tasks got in 0015;
-- without it "paused by the operator" is a suggestion.
--
-- INSERT is revoked alongside UPDATE, and from `anon` as well as
-- `authenticated`: a row created with system_pause_reason already set would
-- forge an operator decision just as effectively as editing one.
revoke insert (system_paused, system_pause_reason) on public.audit_schedules from authenticated, anon;
revoke update (system_paused, system_pause_reason) on public.audit_schedules from authenticated, anon;

-- ── Triggers ───────────────────────────────────────────────────────────────
create or replace function public.audit_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists audit_targets_touch on public.audit_targets;
create trigger audit_targets_touch before update on public.audit_targets
  for each row execute function public.audit_touch_updated_at();

drop trigger if exists audit_recommendations_touch on public.audit_recommendations;
create trigger audit_recommendations_touch before update on public.audit_recommendations
  for each row execute function public.audit_touch_updated_at();

drop trigger if exists audit_schedules_touch on public.audit_schedules;
create trigger audit_schedules_touch before update on public.audit_schedules
  for each row execute function public.audit_touch_updated_at();

drop trigger if exists audit_benchmarks_touch on public.audit_benchmarks;
create trigger audit_benchmarks_touch before update on public.audit_benchmarks
  for each row execute function public.audit_touch_updated_at();

-- Stamp status_changed_at only when the status ACTUALLY changes. Setting it on
-- every update would make "accepted 3 days ago" wrong the moment anything else
-- on the row was touched, and recommendation-acceptance latency is a headline
-- product metric.
create or replace function public.audit_recommendation_status_changed()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at = now();
  end if;
  return new;
end $$;

drop trigger if exists audit_recommendations_status on public.audit_recommendations;
create trigger audit_recommendations_status before update on public.audit_recommendations
  for each row execute function public.audit_recommendation_status_changed();

-- ── Functions ──────────────────────────────────────────────────────────────

-- Get-or-create the target for a URL. Idempotent by construction: the unique
-- index on (user_id, canonical_url) is what makes re-auditing accumulate one
-- history rather than scattering across duplicate targets under concurrency.
create or replace function public.upsert_audit_target(
  p_user_id uuid, p_url text, p_host text, p_label text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.audit_targets (user_id, canonical_url, host, label)
  values (p_user_id, p_url, p_host, p_label)
  on conflict (user_id, canonical_url) do update
    set updated_at = now(),
        label = coalesce(excluded.label, public.audit_targets.label)
  returning id into v_id;
  return v_id;
end $$;

-- Score history for one target, newest first. Powers the trend chart and the
-- delta view without shipping every audit's full payload to the browser.
create or replace function public.audit_target_trend(
  p_target_id uuid, p_limit integer default 30
) returns table (
  audit_id uuid, created_at timestamptz, final_score numeric,
  seo_score numeric, aeo_score numeric, geo_score numeric,
  answer_clarity_score numeric, entity_authority_score numeric,
  structural_hierarchy_score numeric, technical_accessibility_score numeric,
  coverage numeric, issue_count integer, critical_count integer
)
language sql stable security definer set search_path = public as $$
  select a.id, a.created_at, r.final_score, r.seo_score, r.aeo_score, r.geo_score,
         r.answer_clarity_score, r.entity_authority_score,
         r.structural_hierarchy_score, r.technical_accessibility_score,
         r.coverage, r.issue_count, r.critical_count
    from public.audits a
    join public.audit_results r on r.audit_id = a.id
   where a.target_id = p_target_id and a.status = 'completed'
   order by a.created_at desc
   limit greatest(1, least(coalesce(p_limit, 30), 365));
$$;

-- Retention. audit_events is EXCLUDED on purpose — see its table comment.
-- Completed audits are deleted whole; the cascades take their children.
create or replace function public.prune_audit_history(p_days integer default 365)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  delete from public.audits
   where created_at < now() - make_interval(days => greatest(30, coalesce(p_days, 365)))
     and status in ('completed','failed')
     -- Never prune an audit another audit is still measured against, or a
     -- benchmark still points at: doing so turns a working comparison into a
     -- dangling reference and silently erases the baseline a trend is drawn from.
     and id not in (select baseline_audit_id from public.audits where baseline_audit_id is not null)
     and id not in (select audit_id from public.audit_benchmark_members where audit_id is not null)
     and id not in (select last_audit_id from public.audit_schedules where last_audit_id is not null);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

comment on table public.audit_events is
  'Audit trail for the Discoverability module. NEVER pruned by prune_audit_history() — a retention job that erases the record of a deletion is what an audit trail exists to prevent.';
comment on column public.audit_signals.normalized_score is
  'NULL means the signal was not measured or does not apply, and its weight was redistributed across the signals that were. NULL is NOT zero.';
comment on column public.audit_prompt_runs.live is
  'FALSE means the sample came from a language model''s recall, not a live answer engine with web retrieval. Different measurements; the UI must say which.';


-- ============================================================
-- 0031_team_workspaces.sql
-- ============================================================
-- 0031_team_workspaces.sql
-- Real multi-user workspaces: /workspace today is a single-owner dashboard —
-- nobody can be invited into it, despite pricingConfig.js already selling
-- "5 client workspaces" on Agency and a paid "Extra Workspace" add-on. This
-- migration builds the primitive those claims assume exists.
--
-- ── WHY ONE SHARED TABLE, NOT A DISCOVERABILITY-SPECIFIC ONE ───────────────
-- 0030_discoverability_audits.sql already reserved a nullable `workspace_id`
-- on all six of its tables, with the comment: "PRD workspaces -> auth.users.id,
-- with a nullable workspace_id column reserved on every table for when team
-- workspaces ship." That sentence anticipated exactly this migration. A
-- second, module-specific workspaces table would be the mistake that comment
-- was written to avoid — so this is the ONE table every reserved column
-- eventually points at. Backfilling audit_targets / audits / audit_schedules /
-- etc. with real workspace_id values is a follow-up migration, not this one;
-- this one only has to make the id they'll point at real.
--
-- ── TWO-LEVEL MODEL, MATCHING WHAT'S ALREADY SOLD ───────────────────────────
-- pricingConfig.js has two independent numbers per plan: `workspaces` (how many
-- separate workspaces a user may OWN — 1 on every plan except Agency's 5) and
-- `team_seats` (how many members belong to ONE of their workspaces — 1 on most
-- plans, 3 on Business, 5 on Agency). entitlementModel.js's `workspace.create`
-- and `workspace.team_seats` capabilities already model exactly this split;
-- this migration is the storage those two checks were written ahead of.
--
-- ── SEAT COUNTING INCLUDES THE OWNER ────────────────────────────────────────
-- A workspace's owner gets a `workspace_members` row too (role='owner'),
-- inserted atomically with the workspace itself in create_workspace(). So
-- "team_seats: 3" on Business means 3 people total in a workspace, owner
-- included — the simpler, more common SaaS convention, and it keeps seat
-- math a single `count(*)` with no "+1 for the owner" special case scattered
-- through the app.
--
-- ── WHY THE SEAT CAP IS NOT ENFORCED IN SQL ─────────────────────────────────
-- team_seats and workspaces live in pricingConfig.js, not in a database row —
-- there is no plan table to join against here. So, same split as
-- 0029_referrals.sql (JS decides eligibility from plan data, SQL enforces
-- state integrity): the caller (netlify/functions/lib/workspaces.js) checks
-- entitlementModel.can("workspace.team_seats"/"workspace.create") BEFORE
-- calling these functions. That is advisory, not airtight — two simultaneous
-- invites can race past a cap by one seat. Workspace membership changes are a
-- low-frequency admin action, not a public redemption surface, so this is an
-- accepted trade-off, not an oversight; if it ever needs to be airtight, a
-- cached seat-cap column on `workspaces`, refreshed on plan change, is the
-- follow-up.
--
-- ── RLS ──────────────────────────────────────────────────────────────────
-- Same posture as referrals and scrape-consent: SERVICE KEY ONLY on every
-- table, no anon or authenticated policy at all. Architecture rule already
-- requires the browser to reach Supabase only through apiClient.js ->
-- Netlify Functions, so a direct-read RLS policy would be unused capability
-- with a security cost, not a convenience.

create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspaces_owner_idx on public.workspaces (owner_id);

create table if not exists public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on public.workspace_members (user_id);
create index if not exists workspace_members_workspace_idx on public.workspace_members (workspace_id);

create table if not exists public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Stored lowercased/trimmed by the issuing function. Acceptance requires the
  -- accepting user's OWN JWT email to match this — the same reasoning as
  -- 0029_referrals.sql's signed-in-only rule: a token that anyone signed in
  -- could redeem is not an invite, it is a shareable coupon for a seat.
  email        text not null,
  -- 64 hex chars from two concatenated gen_random_uuid()s rather than
  -- gen_random_bytes(), so this needs no pgcrypto extension — gen_random_uuid()
  -- is already relied on as the default for every uuid primary key in this
  -- schema, so it is known to be available everywhere these migrations run.
  token        text not null unique,
  role         text not null default 'member' check (role in ('admin', 'member')),
  invited_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '14 days'),
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id),
  revoked_at   timestamptz
);

create index if not exists workspace_invites_workspace_idx on public.workspace_invites (workspace_id);
create index if not exists workspace_invites_token_idx on public.workspace_invites (token);

-- At most one PENDING invite per (workspace, email) — re-inviting the same
-- address just needs to reuse or replace that row, not pile up duplicates a
-- human then has to sort out.
create unique index if not exists workspace_invites_pending_unique
  on public.workspace_invites (workspace_id, email)
  where accepted_at is null and revoked_at is null;

alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'workspaces' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.workspaces
             for all to service_role using (true) with check (true)';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'workspace_members' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.workspace_members
             for all to service_role using (true) with check (true)';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'workspace_invites' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.workspace_invites
             for all to service_role using (true) with check (true)';
  end if;
end $$;

-- ── Create ───────────────────────────────────────────────────────────────
-- Atomic: the workspace and its owner's membership row are created together,
-- so there is never a moment where a workspace exists with zero members (a
-- seat count of 0 would make "how many seats does this workspace use"
-- ambiguous for every caller downstream).
create or replace function public.create_workspace(p_owner_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if p_owner_id is null then
    raise exception 'create_workspace requires an owner id';
  end if;
  if v_name = '' then
    v_name := 'My workspace';
  end if;

  insert into public.workspaces (owner_id, name) values (p_owner_id, v_name)
    returning id into v_id;
  insert into public.workspace_members (workspace_id, user_id, role)
    values (v_id, p_owner_id, 'owner');

  return v_id;
end $$;

-- ── Invite ───────────────────────────────────────────────────────────────
-- Verdicts: {"ok":true,"token":...,"expiresAt":...}
--           {"ok":false,"reason":"not_authorized"|"already_member"|"already_invited"|"invalid"}
--
-- The role check is enforced here, not just in the JS handler — belt and
-- braces, same as referral_no_self being a CHECK constraint AND a handler
-- check, so a future handler bug cannot let a plain member mint invites.
create or replace function public.create_workspace_invite(
  p_workspace_id uuid, p_email text, p_role text, p_invited_by uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor_role text;
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_role       text := coalesce(p_role, 'member');
  v_token      text;
  v_expires    timestamptz := now() + interval '14 days';
begin
  if p_workspace_id is null or p_invited_by is null or v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_role not in ('admin', 'member') then
    v_role := 'member';
  end if;

  select role into v_actor_role
    from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_invited_by;
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;

  if exists (
    select 1 from public.workspace_members wm
      join auth.users u on u.id = wm.user_id
     where wm.workspace_id = p_workspace_id and lower(u.email) = v_email
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_member');
  end if;

  if exists (
    select 1 from public.workspace_invites
     where workspace_id = p_workspace_id and email = v_email
       and accepted_at is null and revoked_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_invited');
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.workspace_invites
    (workspace_id, email, token, role, invited_by, expires_at)
  values
    (p_workspace_id, v_email, v_token, v_role, p_invited_by, v_expires);

  return jsonb_build_object('ok', true, 'token', v_token, 'expiresAt', v_expires);
end $$;

-- ── Accept ───────────────────────────────────────────────────────────────
-- Verdicts: {"ok":true,"workspaceId":...}
--           {"ok":false,"reason":"invalid"|"revoked"|"expired"|"already_accepted"|"email_mismatch"}
--
-- Idempotent by design (on conflict do nothing on the membership insert): a
-- double-submit from a slow network retry lands the user in the workspace
-- once, not an error the second time.
create or replace function public.accept_workspace_invite(
  p_token text, p_user_id uuid, p_user_email text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_invite record;
  v_email  text := lower(btrim(coalesce(p_user_email, '')));
begin
  if p_token is null or p_user_id is null or v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_invite from public.workspace_invites where token = p_token;
  if v_invite is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_invite.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_invite.accepted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_accepted');
  end if;
  if v_invite.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_invite.email <> v_email then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch');
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
    values (v_invite.workspace_id, p_user_id, v_invite.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invites
     set accepted_at = now(), accepted_by = p_user_id
   where id = v_invite.id;

  return jsonb_build_object('ok', true, 'workspaceId', v_invite.workspace_id);
end $$;

-- ── Remove / leave ───────────────────────────────────────────────────────
-- Verdicts: {"ok":true} / {"ok":false,"reason":"not_authorized"|"owner_cannot_leave"|"cannot_remove_owner"}
--
-- Rules: the owner can remove any admin or member but cannot remove
-- themselves (leaving would orphan the workspace's billing identity — the
-- owner's plan is what funds every seat in it); an admin may remove a
-- member but not another admin or the owner; anyone may remove themselves
-- except the owner.
create or replace function public.remove_workspace_member(
  p_workspace_id uuid, p_actor_id uuid, p_target_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor_role  text;
  v_target_role text;
begin
  select role into v_actor_role
    from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_actor_id;
  select role into v_target_role
    from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_target_user_id;

  if v_target_role is null then
    return jsonb_build_object('ok', true); -- already not a member; idempotent
  end if;

  if p_actor_id = p_target_user_id then
    if v_actor_role = 'owner' then
      return jsonb_build_object('ok', false, 'reason', 'owner_cannot_leave');
    end if;
  else
    if v_target_role = 'owner' then
      return jsonb_build_object('ok', false, 'reason', 'cannot_remove_owner');
    end if;
    if v_actor_role = 'owner' then
      -- may remove anyone non-owner
    elsif v_actor_role = 'admin' and v_target_role = 'member' then
      -- may remove a plain member
    else
      return jsonb_build_object('ok', false, 'reason', 'not_authorized');
    end if;
  end if;

  delete from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_target_user_id;

  return jsonb_build_object('ok', true);
end $$;


-- ============================================================
-- 0032_account_state_and_audit_summary.sql
-- ============================================================
-- 0032_account_state_and_audit_summary.sql
-- Three additive changes, no new tables:
--   1. entitlements     — a user-chosen FREEZE and a deletion request
--   2. workspace_members— per-member pause
--   3. audit_results    — a cached AI executive summary
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 WHY FREEZE IS NOT `entitlements.status = 'suspended'`
-- ═══════════════════════════════════════════════════════════════════════════
-- `status` (0012_billing_identity.sql) is the BILLING LIFECYCLE:
-- active | suspended | deactivated | purged. Reaching `suspended` starts the
-- dunning schedule in billing-lifecycle.js and begins the day-90 countdown that
-- billing-purge.js reads. It means "this account has lapsed".
--
-- A user-chosen freeze means something entirely different: "keep charging me,
-- keep my data, just stop anyone consuming units for a while". Reusing
-- `suspended` for it would enrol a paying customer in a dunning sequence and
-- start a deletion clock on data they explicitly asked to keep. That is not a
-- near-miss; it is the worst possible outcome of the feature.
--
-- So freeze is a SEPARATE AXIS, exactly like scheduled_tasks.system_paused vs
-- scheduled_tasks.status (0015_scheduler_hardening.sql): one column records the
-- USER's intent, another the PLATFORM's, and neither can be mistaken for the
-- other. `can()` in entitlementModel.js checks frozen_at immediately after the
-- lifecycle gate and denies every unit-consuming capability while allowing the
-- EXPORT_CAPS carve-out that already exists — which is precisely the
-- "view-only until unfrozen" behaviour the feature asks for.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 WHY DELETION IS A REQUEST WITH A GRACE PERIOD, NOT A DELETE
-- ═══════════════════════════════════════════════════════════════════════════
-- `deletion_requested_at` + `deletion_purge_after` record INTENT. Nothing here
-- deletes anything, and no function in this migration can.
--
-- The actual deletion is billing-purge.js, which already exists, already has
-- five independent interlocks, already ships disarmed behind PURGE_ENABLED,
-- already has a dry-run mode and already caps its own blast radius. Writing a
-- second destructive path — one reachable from a button in the UI — would mean
-- the careful one and the careless one both existed, and a mis-click on the
-- careless one is unrecoverable.
--
-- 30 days, not 90: this is a deliberate act by the account owner, not a lapse
-- they may not have noticed. But it is still recoverable, because "that wasn't
-- me" and "I changed my mind" both happen, and neither is served by an
-- immediate irreversible delete.
--
-- Requesting deletion ALSO freezes, so nothing accrues during the window.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- No new tables, so no new policies. The columns inherit the RLS already on
-- entitlements, workspace_members and audit_results — service key only, the
-- same posture as 0029/0030/0031. Every write goes through a Netlify function.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Account state
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.entitlements
  add column if not exists frozen_at             timestamptz,
  add column if not exists frozen_by             uuid,
  add column if not exists frozen_reason         text,
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_purge_after  timestamptz;

comment on column public.entitlements.frozen_at is
  'User-chosen freeze. SEPARATE from `status`: billing continues, no dunning, no purge clock. Read by entitlementModel.can().';
comment on column public.entitlements.deletion_purge_after is
  'When billing-purge.js may act. Recording intent only — nothing in migration 0032 deletes anything.';

-- Lets billing-purge.js find due accounts without a full scan.
create index if not exists entitlements_deletion_due_idx
  on public.entitlements (deletion_purge_after)
  where deletion_purge_after is not null;

-- Freeze or unfreeze. Idempotent: re-freezing an already-frozen account does
-- not move frozen_at, so "frozen since" stays truthful.
create or replace function public.set_account_frozen(
  p_user_id uuid, p_frozen boolean, p_reason text default null, p_actor uuid default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return 'invalid'; end if;

  if p_frozen then
    update public.entitlements
       set frozen_at     = coalesce(frozen_at, now()),
           frozen_by     = coalesce(p_actor, p_user_id),
           frozen_reason = coalesce(p_reason, frozen_reason),
           version       = version + 1,
           updated_at    = now()
     where user_id = p_user_id;
  else
    -- ⚠️ An account awaiting deletion may NOT simply be unfrozen. The freeze is
    -- part of that state; lifting it alone would leave an account consuming
    -- units while a purge date sits on it. Cancelling the deletion is what
    -- unfreezes, and that is a different, deliberate call.
    if exists (select 1 from public.entitlements
                where user_id = p_user_id and deletion_requested_at is not null) then
      return 'deletion_pending';
    end if;
    update public.entitlements
       set frozen_at = null, frozen_by = null, frozen_reason = null,
           version = version + 1, updated_at = now()
     where user_id = p_user_id;
  end if;

  if not found then return 'not_found'; end if;
  return 'ok';
end; $$;

-- Record a deletion request. Freezes immediately; deletes nothing, ever.
create or replace function public.request_account_deletion(
  p_user_id uuid, p_grace_days integer default 30
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_after timestamptz;
begin
  if p_user_id is null then return null; end if;
  -- Clamped: a 0-day grace period is an immediate irreversible delete wearing
  -- this function's name, and the whole point of the grace period is that no
  -- caller can opt out of it.
  v_after := now() + make_interval(days => greatest(1, least(coalesce(p_grace_days, 30), 90)));

  update public.entitlements
     set deletion_requested_at = coalesce(deletion_requested_at, now()),
         deletion_purge_after  = coalesce(deletion_purge_after, v_after),
         frozen_at             = coalesce(frozen_at, now()),
         frozen_reason         = coalesce(frozen_reason, 'deletion_requested'),
         version               = version + 1,
         updated_at            = now()
   where user_id = p_user_id;

  if not found then return null; end if;
  select deletion_purge_after into v_after from public.entitlements where user_id = p_user_id;
  return v_after;
end; $$;

-- Cancel a pending deletion, and unfreeze with it.
create or replace function public.cancel_account_deletion(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  update public.entitlements
     set deletion_requested_at = null,
         deletion_purge_after  = null,
         frozen_at             = case when frozen_reason = 'deletion_requested' then null else frozen_at end,
         frozen_by             = case when frozen_reason = 'deletion_requested' then null else frozen_by end,
         frozen_reason         = case when frozen_reason = 'deletion_requested' then null else frozen_reason end,
         version               = version + 1,
         updated_at            = now()
   where user_id = p_user_id and deletion_requested_at is not null;
  if not found then return 'not_pending'; end if;
  return 'ok';
end; $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Per-member pause
-- ═══════════════════════════════════════════════════════════════════════════
-- The same idea as an account freeze, scoped to one seat: a paused member keeps
-- read and export access and loses everything that consumes account units. It
-- is NOT a removal — the seat is still theirs, still counted, and the history
-- attributed to them is untouched.
alter table public.workspace_members
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by uuid;

comment on column public.workspace_members.paused_at is
  'Per-seat pause. Read alongside entitlements.frozen_at by the extract/audit gates. Still occupies a seat.';

create or replace function public.set_workspace_member_paused(
  p_workspace_id uuid, p_actor uuid, p_target_user uuid, p_paused boolean
) returns text language plpgsql security definer set search_path = public as $$
declare v_actor_role text; v_target_role text;
begin
  select role into v_actor_role from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_actor;
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    return 'forbidden';
  end if;

  select role into v_target_role from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_target_user;
  if v_target_role is null then return 'not_found'; end if;

  -- ⚠️ The owner can never be paused, by anybody, including themselves. An
  -- owner who has paused themselves cannot unpause themselves — the workspace
  -- would need support to recover. Same reasoning as owner_cannot_leave in
  -- 0031: the one role that cannot be locked out is the one that owns the way
  -- back in.
  if v_target_role = 'owner' then return 'cannot_pause_owner'; end if;

  -- An admin may not pause another admin, mirroring the removal rule in 0031.
  if v_actor_role = 'admin' and v_target_role = 'admin' and p_actor <> p_target_user then
    return 'forbidden';
  end if;

  update public.workspace_members
     set paused_at = case when p_paused then coalesce(paused_at, now()) else null end,
         paused_by = case when p_paused then p_actor else null end
   where workspace_id = p_workspace_id and user_id = p_target_user;

  return 'ok';
end; $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Audit executive summary
-- ═══════════════════════════════════════════════════════════════════════════
-- Generated ONCE, on first report view, and cached here so it travels with the
-- audit into every export rather than being regenerated per format (which would
-- give the PDF and the markdown different summaries of the same run).
--
-- ⚠️ Deliberately NOT generated inside the audit pipeline. AUDIT_BUDGET_MS
-- defaults to 8000ms against Netlify's 10s function timeout, and the 504 that
-- shipped in August came from exactly this: per-call timeouts that composed
-- additively with no notion of the platform's limit. An extra model call in
-- that path would re-create it.
--
-- `summary_model` is stored because the summary is prose a customer may
-- forward; six months later "which model wrote this" is a question with an
-- answer, not a shrug.
alter table public.audit_results
  add column if not exists summary_md           text,
  add column if not exists summary_model        text,
  add column if not exists summary_generated_at timestamptz;

comment on column public.audit_results.summary_md is
  'AI executive summary, generated lazily on first report view and cached. Optional: a missing summary degrades the report header to deterministic facts.';


-- ============================================================
-- 0033_deletion_period_end_gate.sql
-- ============================================================
-- 0033_deletion_period_end_gate.sql
-- Extends request_account_deletion (0032) so an account on an active PAID
-- plan is never purged before the period they already paid for actually
-- ends.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════════════
-- 0032 always set `deletion_purge_after = now() + grace_days` (30 by
-- default), regardless of plan. That is correct for a free account, but for
-- someone on an active paid plan it could purge them mid-period — deleting an
-- account (and the data they were paying to keep) before the service they
-- already bought was even over.
--
-- v1.0 has no real recurring/auto-renewing billing (one-time Razorpay Orders
-- only — see docs/RECURRING-BILLING-DEFERRAL.md), so there is no "cancel your
-- subscription first" step to build here: nothing auto-renews, so there is
-- nothing to cancel. The only thing that can be computed today is "when does
-- the period they already paid for end", and that is `entitlements.period_end`
-- — set once at purchase, unaffected by anything in this migration.
--
-- The rule: for `plan_id <> 'free' and status = 'active'`, the purge date is
-- `GREATEST(period_end, now() + grace_days)` — whichever is LATER. That means:
--   * an account with months left on its plan is not purged early — the
--     account stays active until period_end, THEN the grace clock (already
--     elapsed by then) lets billing-purge.js act on the very next sweep;
--   * an account whose period is about to end (or already has) still gets
--     the full grace_days window, exactly as a free account would, so nobody
--     loses the "I changed my mind" recovery period just because their plan
--     happened to be expiring anyway.
-- Free-plan and non-active accounts are UNCHANGED — flat `now() + grace_days`,
-- same as 0032.
--
-- account-state.js's GET response now also returns planId/periodEnd (already
-- sitting in `entitlements`, nothing new to compute) so DangerZone.jsx can
-- show the applicable message before the user ever clicks confirm, and the
-- confirmation screen restates the actual computed date.
--
-- billing-purge.js is UNCHANGED by this migration — it already only acts once
-- `deletion_purge_after` is in the past, so a later date computed here is
-- automatically respected with no cron change needed.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.request_account_deletion(
  p_user_id uuid, p_grace_days integer default 30
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_after      timestamptz;
  v_grace_end  timestamptz;
  v_plan_id    text;
  v_status     text;
  v_period_end timestamptz;
begin
  if p_user_id is null then return null; end if;

  select plan_id, status, period_end
    into v_plan_id, v_status, v_period_end
    from public.entitlements
   where user_id = p_user_id;

  if not found then return null; end if;

  -- Clamped: a 0-day grace period is an immediate irreversible delete wearing
  -- this function's name, and the whole point of the grace period is that no
  -- caller can opt out of it.
  v_grace_end := now() + make_interval(days => greatest(1, least(coalesce(p_grace_days, 30), 90)));

  v_after := case
    when v_plan_id is not null and v_plan_id <> 'free' and v_status = 'active' and v_period_end is not null
      then greatest(v_period_end, v_grace_end)
    else v_grace_end
  end;

  update public.entitlements
     set deletion_requested_at = coalesce(deletion_requested_at, now()),
         deletion_purge_after  = coalesce(deletion_purge_after, v_after),
         frozen_at             = coalesce(frozen_at, now()),
         frozen_reason         = coalesce(frozen_reason, 'deletion_requested'),
         version               = version + 1,
         updated_at            = now()
   where user_id = p_user_id;

  select deletion_purge_after into v_after from public.entitlements where user_id = p_user_id;
  return v_after;
end; $$;


-- ============================================================
-- 0034_usage_rls.sql
-- ============================================================
-- 0034_usage_rls.sql — lock down usage_records and usage_alerts.
--
-- 0014_billing_rls.sql locked subscriptions/payment_events but deliberately
-- left these two tables on their original `anon full access` policy from
-- 0001_core_tables_and_billing.sql, with a comment explaining exactly why:
-- locking them would break guest usage sync, which wrote directly to
-- Supabase with the anon key from src/lib/usageRepo.js, and that write path
-- needed to move behind a server function FIRST.
--
-- netlify/functions/usage-sync.js is that function (service key only).
-- usageRepo.js now calls it instead of the Supabase client directly. This
-- migration is the second half: with no browser code left holding the anon
-- key to talk to these tables, the anon-full-access policy can finally go.
--
-- ── WHY THIS ISN'T THE subscriptions/payment_events PATTERN ─────────────────
-- Those two lock to `auth.uid() = user_id` — an authenticated SELECT-own
-- policy. `usage_records` DOES carry a `user_id` column too (0012_billing_
-- identity.sql backfills it from session_id via stamp_user_id_from_session),
-- but `usage_alerts` never got one — both tables are primarily keyed on
-- `session_id`, a client-generated identifier that exists for guests too,
-- who have no `auth.uid()` to match against.
--
-- Rather than give the two tables asymmetric policies (one authenticated-
-- readable, one not), both go straight to service-key-only, same as the
-- 0029/0030/0031 pattern (referrals, discoverability, workspaces): every
-- read and write goes through a Netlify function (usage-sync.js), never a
-- direct anon or authenticated Supabase query. usage-sync.js already serves
-- every read this app makes, guest or signed-in, so no client code loses
-- anything it could do a moment ago.
--
-- End state: no anon or authenticated policy on either table at all. Every
-- access goes through usage-sync.js (browser reads/writes for the current
-- session) or admin-revenue.js (server-side aggregation, already uses the
-- service key and was never affected by this gap).

drop policy if exists "anon full access" on public.usage_records;
drop policy if exists "anon full access" on public.usage_alerts;

revoke all on public.usage_records from anon;
revoke all on public.usage_records from authenticated;
revoke all on public.usage_alerts  from anon;
revoke all on public.usage_alerts  from authenticated;

notify pgrst, 'reload schema';

-- Final: refresh the PostgREST schema cache so the API picks up new tables/RPCs immediately.
NOTIFY pgrst, 'reload schema';
