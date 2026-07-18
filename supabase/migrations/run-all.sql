-- supabase/migrations/run-all.sql
-- ============================================================================
-- DatIQ v1.0 — Production migration orchestrator (single-file variant)
-- ============================================================================
--
-- Paste this file in the Supabase SQL Editor → New query → Run.
-- It is the concatenation of every numbered migration in this directory,
-- in dependency order, with each script idempotent (IF NOT EXISTS / OR REPLACE),
-- so it is safe to re-run on a fresh or partially-migrated database.
--
-- ORDER MATTERS:
--   0001  base extractions + V2 columns + V5/V5c usage/billing tables
--   0002  pricing_config + coupon redemptions + redeem_coupon RPC
--   0003  app_config (AI provider chain)
--   0004  scheduler (scheduled_tasks)
--   0005  analytics (analytics_events)
--   0006  provenance column
--   0007  public_reports (shareable URLs)
--   0008  summary_feedback
--   0009  extraction_cache (optional, for FD2)
--   0010  rate_limit_log (optional, for FD3)
--   0011  reengagement_log (optional, for F49)
--
-- Individual files are also committed for source control. If you prefer to
-- run them one at a time, paste each numbered file separately in order.
--
-- VERIFY: see README.md §3 for the list of tables that should exist after.
-- ROLLBACK: see rollback.sql for a destructive rollback (DESTRUCTIVE).


-- ============================================================
-- 0001_core_tables_and_billing.sql
-- ============================================================
-- ScrapeLite V5 + V5c database migrations
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- All statements are idempotent (safe to run multiple times).

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

-- Final: refresh the PostgREST schema cache so the API picks up the new tables/RPCs immediately.
NOTIFY pgrst, 'reload schema';
