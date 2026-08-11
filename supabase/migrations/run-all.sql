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
--   0019  0019_api_keys.sql (F-INT-1 — public REST API).
--   0020  0020_integration_connections.sql (HubSpot/Notion/Airtable/Slack/Zapier tokens).
--   0021  0021_zapier_events.sql (Zapier event log for polling).
--   0022  0022_workflow_events.sql — v2 n8n workflow event log + runs + subscriptions.
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

-- 0022_workflow_events.sql
-- ============================================================
-- 0022_workflow_events.sql — v2 n8n workflow event log + runs + subscriptions
-- (renumbered from 0018 to 0022 to avoid collision with 0018_ops_monitoring).
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

-- Final: refresh the PostgREST schema cache so the API picks up new tables/RPCs immediately.
NOTIFY pgrst, 'reload schema';
