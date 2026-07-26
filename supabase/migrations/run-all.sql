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
    when 'agency'    then 5
    when 'business'  then 4
    when 'developer' then 3
    when 'pro'       then 3
    when 'select'    then 2
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

-- Final: refresh the PostgREST schema cache so the API picks up new tables/RPCs immediately.
NOTIFY pgrst, 'reload schema';
