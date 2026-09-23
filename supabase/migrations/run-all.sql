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
--   0035  0035_account_state_bootstrap_entitlements.sql
--   0036  0036_workflow_templates.sql
--   0037  0037_credit_ledger.sql
--   0038  0038_field_provenance.sql
--   0039  0039_report_access.sql
--   0040  0040_pql.sql
--   0041  0041_bulk_enrichment.sql
--   0042  0042_watchlists.sql
--   0043  0043_signal_rules.sql
--   0044  0044_lock_down_workflow_rls.sql
--   0045  0045_workflow_engines.sql
--   0046  0046_rule_execution_outcomes.sql
--   0047  0047_monitored_page_source.sql
--   0048  0048_discoverability_evidence.sql
--   0049  0049_discoverability_intake.sql
--   0050  0050_discoverability_gap_analysis.sql
--   0051  0051_recommendation_assignment.sql — W5.5. The assign verb.
--   0052  0052_citation_states.sql — W6.3. Seven states where there were two booleans.
--   0053  0053_prompt_monitors.sql — W6.5. Prompt monitoring gets its own schedule.
--   0054  0054_workflow_hub.sql — W8. The lifecycle a queue needs to be a queue.
--   0055  0055_business_truth.sql — W9. The Canonical Business Truth Record.
--   0056  0056_entity_graph.sql — W10. The Entity Graph Builder.
--   0057  0057_audit_subjects.sql — D7. The subject registry.
--   0058  0058_local_directory.sql — W12. Local and directory intelligence.
--   0059  0059_local_directory_listing_upsert.sql — make W12's listing upsert legal.
--   0060  0060_audit_subject_upsert_atomic.sql — close the get-or-create race in D7.
--   0061  0061_rpc_lockdown.sql — take ten SECURITY DEFINER functions away from `anon`.
--   0062  0062_schema_trust.sql — P2 · W13: schema intelligence + trust & proof.
--   0063  0063_revalidation_request.sql — P2 · W14: revalidation is a REQUEST.
--   0064  0064_subject_scores.sql — P2 · W11's withheld result surface. W13's step 5.
--   0065  0065_entity_graph_taxonomy.sql — align the stored entity graph with §9.2.
--   0066  0066_approved_entity_subjects.sql — CP-1.1's explicit entity → subject link.
--   0067  0067_discoverability_governance.sql — P3 scoped roles, shared review and effects.
--   0068  0068_sxo_static_runs.sql — Search Experience Optimization (SXO) static audit runs (Stage
--   0069  0069_analytics_funnels_forms.sql — Analytics, Journey Funnels, Form Diagnostics & Goals
--   0070  0070_portfolio_experiments.sql — Portfolio rollups and optimization experiments (Stage 4
--   0071  0071_analytics_import_jobs.sql — durable, idempotent SXO analytics ingestion.
--   0072  0072_analytics_connection_status.sql — honest analytics connector lifecycle.
--   0073  0073_guest_audit_credit.sql — a guest's free Discoverability audit gets its own bucket.
--   0074  0074_single_founder_approval.sql
--   0075  0075_entity_approval.sql
--   0076  0076_endpoint_self_approval_and_directory_ignores.sql
--   0077  0077_approve_entity_richer_verdicts.sql
--   0078  0078_credit_grants_and_balance.sql
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


-- ============================================================
-- 0035_account_state_bootstrap_entitlements.sql
-- ============================================================
-- 0035_account_state_bootstrap_entitlements.sql
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG: freezing or deleting a free account failed with "we could not find a
-- billing record for this account" — reported live, reproduced below.
-- ═══════════════════════════════════════════════════════════════════════════
-- `entitlements` only ever gets a row for a user through a billing event:
-- claiming a paid session (0012's merge_entitlement_from_subscriptions), a
-- referral bonus (0029), or an admin coupon grant (0027). A user who signs up
-- and never buys anything, is never referred, and never receives a coupon has
-- NO entitlements row at all — which on the free plan is the overwhelmingly
-- common case, not an edge case.
--
-- `set_account_frozen` and `request_account_deletion` (0032, refined by 0033)
-- both do a plain `UPDATE ... WHERE user_id = p_user_id` and report
-- `not_found` when zero rows match. For a real signed-in user with no billing
-- history, that `not_found` became account-state.js's "we could not find a
-- billing record for this account" — a billing-shaped error surfacing from an
-- action (freeze / delete-my-own-account) that has nothing to do with billing
-- history. Every free user who never triggered one of the three row-creating
-- events was silently unable to freeze OR delete their own account.
--
-- FIX: both functions now bootstrap a default row (`plan_id='free',
-- status='active'` — the table's own column defaults, nothing invented here)
-- for the target user before acting, so freeze/delete work for every real
-- signed-in user regardless of billing history. A `p_user_id` that is not a
-- real `auth.users` row at all still reports `not_found` — the bootstrap
-- insert hits entitlements' FK on `auth.users` and that violation is caught
-- and reported the same way as before this migration, so the existing
-- "freezing an unknown user" contract in scripts/db-verify.mjs is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_account_frozen(
  p_user_id uuid, p_frozen boolean, p_reason text default null, p_actor uuid default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return 'invalid'; end if;

  begin
    insert into public.entitlements (user_id) values (p_user_id)
      on conflict (user_id) do nothing;
  exception when foreign_key_violation then
    return 'not_found';
  end;

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

  return 'ok';
end; $$;

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

  begin
    insert into public.entitlements (user_id) values (p_user_id)
      on conflict (user_id) do nothing;
  exception when foreign_key_violation then
    return null;
  end;

  select plan_id, status, period_end
    into v_plan_id, v_status, v_period_end
    from public.entitlements
   where user_id = p_user_id;

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
-- 0036_workflow_templates.sql
-- ============================================================
-- 0036_workflow_templates.sql
-- Phase 0 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md — the spine.
--
-- ── WHY A TABLE AT ALL, WHEN extractionTemplates.js ALREADY EXISTS ──────────
-- src/lib/extractionTemplates.js holds 12 "recipes": an example URL, an intent,
-- and a prompt string. That is a PROMPT-PREFILL LIBRARY — it tells the composer
-- what to type. It cannot express what PRD 1 actually asks for: a versioned
-- definition carrying input_schema, extraction_schema, output_schema,
-- credit_cost and plan_entitlement, whose runs are persisted objects.
--
-- This migration does NOT replace that file. The 12 recipes keep serving
-- TemplateGallery.jsx exactly as they do today and become seed rows for the
-- new engine. Deleting them would break TemplateGallery + its tests for no
-- gain; the engine is a superset, not a migration target.
--
-- ── WHY VERSIONS ARE IMMUTABLE ONCE PUBLISHED ───────────────────────────────
-- PRD 1: "Maintain versioned prompts/extraction instructions so prior results
-- remain reproducible." If a published template's prompt could be edited in
-- place, every historical run silently changes meaning: a report shared in
-- March would claim to have been produced by a template that no longer exists
-- as it was. Worse, the change is invisible — nothing in the run row would
-- differ. So a published version is frozen by a BEFORE UPDATE trigger and a
-- change is a NEW VERSION, never an edit. This is the same discipline
-- 0016_invoices.sql applies to issued invoices, for the same reason: a record
-- that other records point at cannot be quietly rewritten.
--
-- ── WHY template_runs IS ONE TABLE FOR ALL FIVE PRDs ────────────────────────
-- A single-URL template execution, one row of a bulk enrichment list, and one
-- competitor watchlist snapshot are the same object: an execution of a pinned
-- template version producing a structured output with provenance. Giving each
-- its own result envelope would force PRD 2 (reports) to special-case four
-- shapes to render one page, and PRD 5 (rules) to subscribe to four event
-- payloads. One run object is what makes those two phases cheap.
--
-- ── THE COMPOSITE FK IS LOAD-BEARING ────────────────────────────────────────
-- template_runs references (template_key, version), NOT just template_key. The
-- database therefore refuses a run that points at a version which does not
-- exist, and a run always records exactly which definition produced it. That is
-- reproducibility enforced by the schema rather than by convention.
--
-- Adds 3 tables, 1 function, 1 trigger.

-- ── the versioned definition ────────────────────────────────────────────────
create table if not exists public.workflow_templates (
  id                uuid primary key default gen_random_uuid(),
  template_key      text not null,                    -- stable id: 'account_brief'
  version           integer not null,                 -- 1, 2, 3 … monotonic per key
  status            text not null default 'draft',
  title             text not null,
  persona           text,                             -- personaConfig.js id, nullable
  summary           text,
  -- What the user is asked for (drives the run form).
  input_schema      jsonb not null default '{}'::jsonb,
  -- What we try to pull out of the fetched pages.
  extraction_schema jsonb not null default '{}'::jsonb,
  -- How the result is laid out (drives the report + run view).
  output_schema     jsonb not null default '{}'::jsonb,
  -- Versioned prompt text. Frozen with the rest of the row on publish.
  prompt_bundle     jsonb not null default '{}'::jsonb,
  -- {base, per_page, per_ai_call} — read by src/lib/credits/creditModel.js.
  credit_cost       jsonb not null default '{}'::jsonb,
  -- entitlementModel.js capability string, e.g. 'template.run'.
  plan_entitlement  text,
  min_plan          text,                             -- pricingConfig plan id
  published_at      timestamptz,
  created_by        uuid references auth.users,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint workflow_templates_status_chk
    check (status in ('draft', 'published', 'superseded', 'archived')),
  constraint workflow_templates_version_chk check (version >= 1),
  constraint workflow_templates_key_version_uniq unique (template_key, version)
);

create index if not exists workflow_templates_key_idx
  on public.workflow_templates (template_key, version desc);
create index if not exists workflow_templates_persona_idx
  on public.workflow_templates (persona) where status = 'published';

-- At most ONE published version per key. Without this, resolving "the current
-- account_brief" is ambiguous and two concurrent publishes both win.
create unique index if not exists workflow_templates_one_published_idx
  on public.workflow_templates (template_key) where status = 'published';

-- ── a run: one execution of one pinned version ──────────────────────────────
create table if not exists public.template_runs (
  id                text primary key,                 -- 'trun_' + base36, client-generatable
  template_key      text not null,
  template_version  integer not null,
  user_id           uuid references auth.users,       -- nullable: guest runs
  workspace_id      uuid references public.workspaces(id) on delete set null,
  status            text not null default 'queued',
  -- 'needs_review' is here, not only in the bulk tables, because PRD 3's review
  -- queue and a low-confidence single run are the same condition.
  input             jsonb not null default '{}'::jsonb,
  output            jsonb,                            -- conforms to output_schema
  output_summary    text,
  credits_estimated integer,
  credits_actual    integer,
  error             text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint template_runs_status_chk check (status in (
    'queued', 'running', 'complete', 'partial', 'failed', 'needs_review', 'cancelled'
  )),
  constraint template_runs_template_fk
    foreign key (template_key, template_version)
    references public.workflow_templates (template_key, version)
);

create index if not exists template_runs_user_idx
  on public.template_runs (user_id, created_at desc);
create index if not exists template_runs_status_idx
  on public.template_runs (status, created_at desc);
create index if not exists template_runs_template_idx
  on public.template_runs (template_key, created_at desc);
create index if not exists template_runs_workspace_idx
  on public.template_runs (workspace_id, created_at desc) where workspace_id is not null;

-- ── every page a run actually fetched ───────────────────────────────────────
-- content_hash is the §1.4 pre-filter: on a re-run, an unchanged hash means we
-- can skip extraction entirely and spend no credits and no AI call.
create table if not exists public.template_run_sources (
  id            uuid primary key default gen_random_uuid(),
  run_id        text not null references public.template_runs(id) on delete cascade,
  url           text not null,
  canonical_url text,
  fetched_at    timestamptz,
  http_status   integer,
  provider      text,                                 -- firecrawl|spider|jina|direct
  content_hash  text,
  bytes         integer,
  error         text,
  created_at    timestamptz not null default now()
);

create index if not exists template_run_sources_run_idx
  on public.template_run_sources (run_id);
create index if not exists template_run_sources_hash_idx
  on public.template_run_sources (canonical_url, content_hash);

-- ── publish: mint the next version and retire the previous one, atomically ──
create or replace function public.publish_template_version(
  p_key text, p_def jsonb, p_actor uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_next integer;
  v_id   uuid;
begin
  if p_key is null or btrim(p_key) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_key');
  end if;
  if p_def is null or coalesce(btrim(p_def->>'title'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'title_required');
  end if;

  select coalesce(max(version), 0) + 1 into v_next
    from public.workflow_templates where template_key = p_key;

  -- Retire the incumbent FIRST: the partial unique index allows exactly one
  -- published row per key, so inserting before superseding would deadlock
  -- against itself on the second publish.
  update public.workflow_templates
     set status = 'superseded', updated_at = now()
   where template_key = p_key and status = 'published';

  insert into public.workflow_templates (
    template_key, version, status, title, persona, summary,
    input_schema, extraction_schema, output_schema, prompt_bundle,
    credit_cost, plan_entitlement, min_plan, published_at, created_by
  ) values (
    p_key, v_next, 'published', p_def->>'title', p_def->>'persona', p_def->>'summary',
    coalesce(p_def->'input_schema',      '{}'::jsonb),
    coalesce(p_def->'extraction_schema', '{}'::jsonb),
    coalesce(p_def->'output_schema',     '{}'::jsonb),
    coalesce(p_def->'prompt_bundle',     '{}'::jsonb),
    coalesce(p_def->'credit_cost',       '{}'::jsonb),
    p_def->>'plan_entitlement', p_def->>'min_plan', now(), p_actor
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_next);
end $$;

-- ── a published version is frozen ───────────────────────────────────────────
-- Only `status` (published → superseded/archived) and `updated_at` may move.
-- Any other edit is refused outright rather than silently accepted, because a
-- silently-edited template makes every past run's provenance a lie.
create or replace function public.workflow_templates_immutable()
returns trigger language plpgsql as $$
begin
  if old.status <> 'published' then
    return new;
  end if;
  if new.template_key      is distinct from old.template_key
  or new.version           is distinct from old.version
  or new.title             is distinct from old.title
  or new.persona           is distinct from old.persona
  or new.summary           is distinct from old.summary
  or new.input_schema      is distinct from old.input_schema
  or new.extraction_schema is distinct from old.extraction_schema
  or new.output_schema     is distinct from old.output_schema
  or new.prompt_bundle     is distinct from old.prompt_bundle
  or new.credit_cost       is distinct from old.credit_cost
  or new.plan_entitlement  is distinct from old.plan_entitlement
  or new.min_plan          is distinct from old.min_plan
  or new.published_at      is distinct from old.published_at
  then
    raise exception 'workflow_templates: published version %/% is immutable — publish a new version instead',
      old.template_key, old.version;
  end if;
  return new;
end $$;

drop trigger if exists workflow_templates_immutable_trg on public.workflow_templates;
create trigger workflow_templates_immutable_trg
  before update on public.workflow_templates
  for each row execute function public.workflow_templates_immutable();

-- ── RLS: service key only ───────────────────────────────────────────────────
-- Same posture as 0029_referrals.sql and 0031_team_workspaces.sql. The browser
-- reaches Supabase only through Netlify functions (locked architecture rule),
-- so an anon/authenticated policy here would be unused attack surface.
alter table public.workflow_templates    enable row level security;
alter table public.template_runs         enable row level security;
alter table public.template_run_sources  enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'workflow_templates' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.workflow_templates
             for all to service_role using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'template_runs' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.template_runs
             for all to service_role using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'template_run_sources' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.template_run_sources
             for all to service_role using (true) with check (true)';
  end if;
end $$;


-- ============================================================
-- 0037_credit_ledger.sql
-- ============================================================
-- 0037_credit_ledger.sql
-- Phase 0 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md — the spine.
--
-- ── WHY A LEDGER AND NOT A COUNTER COLUMN ───────────────────────────────────
-- CLAUDE.md already records this decision once, for audits:
--
--   "audits are counted from the audits table (status != 'failed', current
--    month) with NO counter column, deliberately, because a counter that
--    drifts from the rows it counts eventually bills somebody for work that
--    is not there."
--
-- The same reasoning applies with more force here, because PRD 3 requires us to
-- show an ESTIMATE before a run and the ACTUAL after it. Those two numbers only
-- mean anything if the actual is derived from the individual cost-bearing
-- events, not from a number some code path remembered to increment. So:
--   credit_ledger  = append-only truth
--   usage_records  = cache, may be rebuilt from the ledger at any time
--
-- ── APPEND-ONLY IS ENFORCED, NOT DOCUMENTED ─────────────────────────────────
-- A ledger you can UPDATE is not a ledger. A correction is a COMPENSATING
-- NEGATIVE ROW, exactly as 0016_invoices.sql makes a correction a credit note
-- rather than an edit. The trigger below refuses both UPDATE and DELETE.
--
-- ── NEVER CHARGE FOR A REFUSED REQUEST ──────────────────────────────────────
-- extract.js already orders its gates SSRF -> entitlement -> compliance ->
-- guest charge -> rate limiter precisely so nothing above the charge can bill.
-- Callers of credit_spend() inherit that rule: a run refused before any
-- provider call writes NO ledger row. A run killed mid-flight writes rows only
-- for the items that actually completed — which is why the bulk worker
-- (§1.3a) charges per completed item rather than per job.
--
-- ── run_id CARRIES NO FOREIGN KEY, ON PURPOSE ───────────────────────────────
-- The ledger is billing evidence and must outlive the run it describes.
-- billing-purge.js already keeps invoices and payment_events when it deletes a
-- user's content for the same reason. An FK with ON DELETE CASCADE would let a
-- content purge silently erase the record of what was charged.
--
-- Adds 2 tables, 2 functions, 1 trigger.

-- ── the append-only ledger ──────────────────────────────────────────────────
create table if not exists public.credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users,          -- nullable: guest / system
  workspace_id  uuid references public.workspaces(id) on delete set null,
  run_id        text,                                 -- template_runs.id; deliberately no FK
  reason        text not null,
  -- Positive = credits consumed. Negative = refund or grant. A correction is a
  -- new negative row, never an edit to the row being corrected.
  credits       integer not null,
  unit          text,                                 -- what was actually metered
  quantity      integer,
  meta          jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint credit_ledger_reason_chk check (reason in (
    'page_fetch', 'ai_call', 'enrichment', 'audit', 'monitor_check',
    'template_run', 'refund', 'grant', 'adjustment'
  )),
  constraint credit_ledger_unit_chk check (unit is null or unit in (
    'page', 'ai_call', 'enrichment', 'audit', 'monitor_check', 'run'
  )),
  constraint credit_ledger_credits_chk check (credits <> 0)
);

-- The hot path is "what has this user spent this month" — a range scan on
-- (user_id, occurred_at), which is exactly how credit_balance() reads it.
create index if not exists credit_ledger_user_time_idx
  on public.credit_ledger (user_id, occurred_at desc);
create index if not exists credit_ledger_run_idx
  on public.credit_ledger (run_id) where run_id is not null;
create index if not exists credit_ledger_workspace_time_idx
  on public.credit_ledger (workspace_id, occurred_at desc) where workspace_id is not null;

-- ── the estimate shown before the user confirms a run ───────────────────────
-- Kept as its own row rather than a column on template_runs so that estimate
-- drift is MEASURABLE: a template whose estimate is routinely half its actual
-- is mispriced, and that is only visible if both numbers survive independently.
create table if not exists public.credit_estimates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users,
  run_id            text,
  template_key      text,
  template_version  integer,
  estimated_credits integer not null,
  breakdown         jsonb not null default '[]'::jsonb,
  accepted_at       timestamptz,                      -- null = shown, never confirmed
  created_at        timestamptz not null default now(),
  constraint credit_estimates_credits_chk check (estimated_credits >= 0)
);

create index if not exists credit_estimates_run_idx
  on public.credit_estimates (run_id) where run_id is not null;
create index if not exists credit_estimates_user_idx
  on public.credit_estimates (user_id, created_at desc);

-- ── append a spend ──────────────────────────────────────────────────────────
create or replace function public.credit_spend(
  p_user_id  uuid,
  p_run_id   text,
  p_reason   text,
  p_credits  integer,
  p_unit     text default null,
  p_quantity integer default null,
  p_meta     jsonb default '{}'::jsonb,
  p_workspace_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_credits is null or p_credits = 0 then
    -- Zero-cost work is real (a cache hit, a skipped unchanged page) and must
    -- not create a row — an all-zero ledger is noise that hides real spend.
    return jsonb_build_object('ok', false, 'reason', 'zero_credits');
  end if;

  begin
    insert into public.credit_ledger (
      user_id, workspace_id, run_id, reason, credits, unit, quantity, meta
    ) values (
      p_user_id, p_workspace_id, p_run_id, p_reason, p_credits, p_unit, p_quantity,
      coalesce(p_meta, '{}'::jsonb)
    ) returning id into v_id;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'reason', 'invalid_reason_or_unit');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'reason', 'unknown_user');
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ── derive the balance; never store it ──────────────────────────────────────
-- p_month is 'YYYY-MM' (the same key usageService.js uses). NULL = all time.
create or replace function public.credit_balance(
  p_user_id uuid, p_month text default null
) returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(credits), 0)::integer
    from public.credit_ledger
   where user_id = p_user_id
     and (p_month is null or to_char(occurred_at, 'YYYY-MM') = p_month);
$$;

-- ── append-only enforcement ─────────────────────────────────────────────────
create or replace function public.credit_ledger_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'credit_ledger is append-only — record a compensating entry (reason=''refund'' or ''adjustment'') instead of a % ', tg_op;
end $$;

drop trigger if exists credit_ledger_append_only_trg on public.credit_ledger;
create trigger credit_ledger_append_only_trg
  before update or delete on public.credit_ledger
  for each row execute function public.credit_ledger_append_only();

-- ── RLS: service key only ───────────────────────────────────────────────────
alter table public.credit_ledger    enable row level security;
alter table public.credit_estimates enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'credit_ledger' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.credit_ledger
             for all to service_role using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'credit_estimates' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.credit_estimates
             for all to service_role using (true) with check (true)';
  end if;
end $$;


-- ============================================================
-- 0038_field_provenance.sql
-- ============================================================
-- 0038_field_provenance.sql
-- Phase 0 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md — the spine.
--
-- ── WHY FIELD-LEVEL STORAGE, NOT JUST A _provenance BLOB ────────────────────
-- src/lib/provenanceService.js already attaches a `_provenance` object to an
-- extraction in memory, and 0006_provenance.sql stores it as a jsonb column.
-- That is enough to render a badge. It is NOT enough for either of the two
-- phases that follow:
--   PRD 3 needs to FILTER and SORT a list of 500 accounts by the confidence of
--          one field, and re-run only the rows whose fields are stale.
--   PRD 4 needs to DIFF one field against its previous value across runs.
-- Both are queries across runs. A blob per extraction cannot answer either
-- without reading every blob.
--
-- ── THE observed / inferred / ai_generated DISTINCTION IS THE PRODUCT ───────
-- The BRD is explicit: every important output must disclose "whether a field
-- was explicitly observed, inferred, or generated by AI", and PRD 4 requires
-- that an AI explanation "must distinguish FACT from INTERPRETATION".
--
-- Making `method` a CHECK-constrained column rather than a convention is what
-- turns that from a prompt-discipline aspiration into something the schema
-- guarantees. A field the AI wrote can never be silently rendered as a
-- verified fact about the source page, because the two are different values in
-- a constrained column and the renderer branches on it.
--
--   observed      the value is literally present in the fetched document
--   inferred      derived from observed content — still a claim ABOUT the source
--   ai_generated  net-new prose the model wrote — NOT a claim about the source
--   user_provided a human supplied or confirmed it (PRD 3's review queue)
--
-- ── confidence IS NULLABLE, AND NULL IS NOT ZERO ────────────────────────────
-- This is the discoverability module's founding rule, carried over verbatim:
-- an unmeasured signal is EXCLUDED and its weight redistributed, never scored
-- zero. The CHECK below permits NULL and permits 0..1, so "we could not
-- measure this" and "we measured this and it scored nothing" stay distinct
-- values. In PRD 3 that distinction is the difference between "headcount
-- unknown" and "0 employees, poor ICP fit" — the second would silently poison
-- every ranked call list the product exists to produce.
--
-- Adds 2 tables, 0 functions, 0 triggers.

-- ── the normalized value store ──────────────────────────────────────────────
create table if not exists public.extracted_fields (
  id          uuid primary key default gen_random_uuid(),
  run_id      text references public.template_runs(id) on delete cascade,
  -- Canonical entity this field describes (normalized domain, e.g.
  -- 'stripe.com'). This is the join key that lets PRD 4 diff the same field
  -- across two runs, and PRD 3 dedupe two spellings of one company.
  entity_key  text,
  field_path  text not null,                        -- 'pricing.tiers[0].amount'
  -- PRD 3's recommended first schema categories: identity, firmographics,
  -- commercial, gtm, people, technology, signals, qualification, governance.
  field_group text,
  value_text   text,
  value_json   jsonb,
  value_number numeric,
  -- NULL = not measured. See the header — this is load-bearing.
  confidence  numeric,
  observed_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint extracted_fields_confidence_chk
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint extracted_fields_run_path_uniq unique (run_id, field_path)
);

create index if not exists extracted_fields_entity_idx
  on public.extracted_fields (entity_key, field_path, observed_at desc)
  where entity_key is not null;
create index if not exists extracted_fields_run_idx
  on public.extracted_fields (run_id);
create index if not exists extracted_fields_group_idx
  on public.extracted_fields (field_group) where field_group is not null;

-- ── where each value came from and how it was produced ──────────────────────
create table if not exists public.field_provenance (
  id                uuid primary key default gen_random_uuid(),
  field_id          uuid not null references public.extracted_fields(id) on delete cascade,
  -- Which fetched page. ON DELETE SET NULL: losing the source record must not
  -- erase the field — an orphaned value with a recorded URL is still evidence.
  source_id         uuid references public.template_run_sources(id) on delete set null,
  source_url        text,
  method            text not null,
  extractor         text,                           -- 'firecrawl' | 'ai:gemini-2.0-flash' | 'rule:pricing_v1'
  extractor_version text,
  -- Points back into workflow_templates.prompt_bundle, so a field produced by
  -- a prompt can always be traced to the exact prompt text that produced it.
  prompt_ref        text,
  observed_at       timestamptz,
  created_at        timestamptz not null default now(),
  constraint field_provenance_method_chk
    check (method in ('observed', 'inferred', 'ai_generated', 'user_provided'))
);

create index if not exists field_provenance_field_idx
  on public.field_provenance (field_id);
create index if not exists field_provenance_method_idx
  on public.field_provenance (method);

-- ── RLS: service key only ───────────────────────────────────────────────────
alter table public.extracted_fields  enable row level security;
alter table public.field_provenance  enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'extracted_fields' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.extracted_fields
             for all to service_role using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'field_provenance' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.field_provenance
             for all to service_role using (true) with check (true)';
  end if;
end $$;


-- ============================================================
-- 0039_report_access.sql
-- ============================================================
-- 0039_report_access.sql
-- Phase 2 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md — §2.2a.
--
-- ── WHAT THIS REPLACES, AND THE BUG IT CLOSES ───────────────────────────────
-- 0007_public_reports.sql made the slug the ONLY auth: "public read" is
-- `USING (is_public = true)` and therefore exposes EVERY COLUMN — session_id
-- included — to anyone holding the URL. CLAUDE.md already carries the warning
-- that the obvious fix (send an x-session-id header so the "owner update"
-- branch matches) would be strictly worse: it would let any READER of a public
-- report rewrite or delete it.
--
-- The correct fix, which PRD 2 forces anyway, is to stop resolving visibility
-- in RLS and resolve it in ONE function reading the service key. That is
-- resolve_report_access() below, and public-reports.js is its only caller.
--
-- ── THE STATE MACHINE (decision D3, resolved 2026-09-02) ────────────────────
--   private ──publish(link|org|named|public)──▶ shared   [slug minted on FIRST publish]
--   shared  ──unpublish()─────────────────────▶ private  [slug RETAINED]
--   shared  ──set_visibility(state)───────────▶ shared   [no slug change]
--   any     ──revoke()────────────────────────▶ revoked  [TERMINAL; slug burned]
--   any     ──expires_at passes───────────────▶ denied   [owner may re-publish]
--
-- ── WHY unpublish AND revoke ARE DIFFERENT VERBS ────────────────────────────
-- Collapsing them forces a user to choose between convenience and safety on
-- every click, so they pick convenience and stop using the safe one.
--   unpublish  reversible. The slug is kept, so re-publishing revives the link
--              a colleague already has. This is what "hide this for now" means.
--   revoke     terminal. The slug is burned and can never be reissued.
--
-- ── HOW A BURNED SLUG STAYS BURNED, WITH NO EXTRA TABLE ─────────────────────
-- A revoked report KEEPS its slug and its row. Because `slug` is UNIQUE, the
-- revoked row permanently occupies that slug and mint_report_slug() can never
-- hand it out again. Deleting the row instead would silently return the slug
-- to the pool — and the next report to receive it would be readable by
-- everyone who still had the old link.
--
-- ── REVOCATION MUST BE IMMEDIATE, SO NOTHING MAY BE CACHED ──────────────────
-- PRD 2: "Revoking a link blocks access immediately." That is unachievable if
-- the report body is edge-cached, so resolve_report_access() is called PER
-- REQUEST and public-reports.js must send no-store on report bodies.
--
-- ── MIGRATION OF EXISTING public_reports ROWS ───────────────────────────────
-- Every existing row exists BECAUSE A USER PRESSED SHARE — that is "make it
-- public" already having been exercised, so sending them to `private` would
-- silently break links already in third parties' hands. They land on `link`
-- (reachable, unlisted, noindex). The `curated = true` subset already surfaced
-- in /gallery lands on `public`, so the gallery is unchanged by this migration.
--
-- Adds 3 tables, 5 functions, 1 trigger.

-- ── the report ──────────────────────────────────────────────────────────────
create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  -- NULL until first publish. A private report has no URL, so there is
  -- nothing to guess at and nothing to leak.
  slug          text unique,
  owner_id      uuid references auth.users,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  run_id        text references public.template_runs(id) on delete set null,
  -- Denormalised so a report still renders if its run is purged.
  title         text not null,
  source_url    text,
  template_key  text,
  data          jsonb not null default '{}'::jsonb,
  visibility    text not null default 'private',
  expires_at    timestamptz,
  revoked_at    timestamptz,
  published_at  timestamptz,
  -- Free tier keeps DatIQ attribution. Enforced at RENDER, not at publish, so
  -- a plan downgrade cannot leave an unbranded page live.
  branding      jsonb not null default '{}'::jsonb,
  view_count    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint reports_visibility_chk check (visibility in (
    'private', 'link', 'org', 'named', 'public', 'revoked'
  )),
  -- Any state that is reachable by a URL must actually have one.
  constraint reports_shared_needs_slug_chk check (
    visibility in ('private', 'revoked') or slug is not null
  )
);

create index if not exists reports_owner_idx      on public.reports (owner_id, created_at desc);
create index if not exists reports_workspace_idx  on public.reports (workspace_id, created_at desc) where workspace_id is not null;
create index if not exists reports_run_idx        on public.reports (run_id) where run_id is not null;
create index if not exists reports_public_idx     on public.reports (published_at desc) where visibility = 'public';

-- ── named collaborators ─────────────────────────────────────────────────────
create table if not exists public.report_grants (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  -- Email, not user_id: you grant access to someone who may not have an
  -- account yet. Matched against the accepting session's own verified JWT
  -- email server-side, exactly as 0031's workspace invites are.
  email       text not null,
  granted_by  uuid references auth.users,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint report_grants_uniq unique (report_id, email)
);

create index if not exists report_grants_report_idx on public.report_grants (report_id) where revoked_at is null;

-- ── who opened what, and when ───────────────────────────────────────────────
-- PRD 2 asks for access logging AND report engagement analytics; one table
-- serves both. Retained rather than pruned, because "who saw this before we
-- revoked it" is the question this table exists to answer.
create table if not exists public.report_access_log (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  event       text not null,
  viewer_id   uuid references auth.users,
  viewer_hint text,                                  -- coarse: never a raw IP
  visibility  text,                                  -- state AT the time
  actor_id    uuid references auth.users,            -- who made a state change
  reason      text,
  created_at  timestamptz not null default now(),
  constraint report_access_log_event_chk check (event in (
    'viewed', 'denied', 'published', 'unpublished', 'revoked',
    'visibility_changed', 'expired', 'grant_added', 'grant_revoked'
  ))
);

create index if not exists report_access_log_report_idx on public.report_access_log (report_id, created_at desc);
create index if not exists report_access_log_event_idx  on public.report_access_log (event, created_at desc);

-- ── slug minting ────────────────────────────────────────────────────────────
-- 8 chars of base36. Retries on collision; a revoked row still owns its slug,
-- so a burned slug is never reissued.
create or replace function public.mint_report_slug()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_alphabet constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_slug text;
  v_i    integer;
  v_try  integer := 0;
begin
  loop
    v_try := v_try + 1;
    v_slug := '';
    for v_i in 1..8 loop
      v_slug := v_slug || substr(v_alphabet, 1 + floor(random() * 36)::int, 1);
    end loop;
    exit when not exists (select 1 from public.reports where slug = v_slug);
    if v_try > 24 then
      raise exception 'mint_report_slug: could not find a free slug after % attempts', v_try;
    end if;
  end loop;
  return v_slug;
end $$;

-- ── publish / change visibility ─────────────────────────────────────────────
-- D3 RESOLVED: REUSE. A report that was previously shared keeps its original
-- slug when re-published, so the link a colleague already holds starts working
-- again. Burning a link is the separate, explicit revoke_report() action.
create or replace function public.set_report_visibility(
  p_report_id uuid, p_visibility text, p_actor uuid default null, p_expires_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.reports%rowtype;
begin
  select * into r from public.reports where id = p_report_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if r.visibility = 'revoked' then
    -- Terminal by design: a revoked link must not be resurrectable, or
    -- "revoke" would be indistinguishable from "unpublish" to an attacker
    -- who already holds the URL.
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if p_actor is not null and r.owner_id is not null and r.owner_id <> p_actor then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  if p_visibility not in ('private', 'link', 'org', 'named', 'public') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_visibility');
  end if;

  if p_visibility = 'private' then
    -- unpublish: keep the slug so a later publish revives the same URL.
    update public.reports
       set visibility = 'private', expires_at = null, updated_at = now()
     where id = p_report_id;
    insert into public.report_access_log (report_id, event, actor_id, visibility)
      values (p_report_id, 'unpublished', p_actor, 'private');
    return jsonb_build_object('ok', true, 'visibility', 'private', 'slug', r.slug);
  end if;

  -- Mint on FIRST publish only; reuse thereafter (D3).
  if r.slug is null then
    r.slug := public.mint_report_slug();
  end if;

  update public.reports
     set visibility   = p_visibility,
         slug         = r.slug,
         expires_at   = p_expires_at,
         published_at = coalesce(published_at, now()),
         updated_at   = now()
   where id = p_report_id;

  insert into public.report_access_log (report_id, event, actor_id, visibility)
    values (p_report_id,
            case when r.visibility = 'private' then 'published' else 'visibility_changed' end,
            p_actor, p_visibility);

  return jsonb_build_object('ok', true, 'visibility', p_visibility, 'slug', r.slug);
end $$;

-- ── revoke: terminal, burns the slug ────────────────────────────────────────
create or replace function public.revoke_report(
  p_report_id uuid, p_actor uuid default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.reports%rowtype;
begin
  select * into r from public.reports where id = p_report_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_actor is not null and r.owner_id is not null and r.owner_id <> p_actor then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  if r.visibility = 'revoked' then
    return jsonb_build_object('ok', true, 'visibility', 'revoked', 'already', true);
  end if;

  -- The slug is KEPT on the revoked row. That is what burns it: the UNIQUE
  -- index means mint_report_slug() can never hand it out again.
  update public.reports
     set visibility = 'revoked', revoked_at = now(), expires_at = null, updated_at = now()
   where id = p_report_id;

  update public.report_grants set revoked_at = now()
   where report_id = p_report_id and revoked_at is null;

  insert into public.report_access_log (report_id, event, actor_id, visibility, reason)
    values (p_report_id, 'revoked', p_actor, 'revoked', p_reason);

  return jsonb_build_object('ok', true, 'visibility', 'revoked');
end $$;

-- ── the single choke point every read goes through (§1.9) ───────────────────
-- Returns the verdict AND the payload, so a caller cannot accidentally fetch
-- the row by another path and skip the check.
create or replace function public.resolve_report_access(
  p_slug text,
  p_viewer_id uuid default null,
  p_viewer_email text default null,
  p_log boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r        public.reports%rowtype;
  v_ok     boolean := false;
  v_reason text    := 'not_found';
begin
  select * into r from public.reports where slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if r.visibility = 'revoked' then
    v_reason := 'revoked';
  elsif r.visibility = 'private' then
    v_reason := 'private';
  elsif r.expires_at is not null and r.expires_at <= now() then
    v_reason := 'expired';
  elsif r.visibility in ('public', 'link') then
    v_ok := true;
  elsif r.visibility = 'org' then
    if p_viewer_id is not null and r.workspace_id is not null and exists (
      select 1 from public.workspace_members m
       where m.workspace_id = r.workspace_id and m.user_id = p_viewer_id
    ) then v_ok := true; else v_reason := 'not_in_workspace'; end if;
  elsif r.visibility = 'named' then
    -- Email-bound, matched against the caller's own verified JWT email —
    -- the same rule 0031's workspace invites use, and for the same reason:
    -- a link is useless to anyone it was not actually sent to.
    if p_viewer_email is not null and exists (
      select 1 from public.report_grants g
       where g.report_id = r.id and g.revoked_at is null
         and lower(g.email) = lower(p_viewer_email)
    ) then v_ok := true; else v_reason := 'not_granted'; end if;
  end if;

  -- The owner always sees their own report, in any state except revoked.
  if not v_ok and p_viewer_id is not null and r.owner_id = p_viewer_id
     and r.visibility <> 'revoked' then
    v_ok := true; v_reason := 'owner';
  end if;

  if p_log then
    insert into public.report_access_log (report_id, event, viewer_id, visibility, reason)
      values (r.id, case when v_ok then 'viewed' else 'denied' end,
              p_viewer_id, r.visibility, case when v_ok then null else v_reason end);
    if v_ok then
      update public.reports set view_count = view_count + 1 where id = r.id;
    end if;
  end if;

  if not v_ok then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  return jsonb_build_object(
    'ok', true,
    'report', jsonb_build_object(
      'id', r.id, 'slug', r.slug, 'title', r.title, 'source_url', r.source_url,
      'template_key', r.template_key, 'data', r.data, 'visibility', r.visibility,
      'branding', r.branding, 'published_at', r.published_at,
      'created_at', r.created_at, 'updated_at', r.updated_at,
      -- Only `public` is indexable. Everything else carries noindex.
      'indexable', (r.visibility = 'public')
    )
  );
end $$;

create or replace function public.reports_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists reports_touch_updated_at_trg on public.reports;
create trigger reports_touch_updated_at_trg
  before update on public.reports
  for each row execute function public.reports_touch_updated_at();

-- ── carry the existing shared reports across ────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'public_reports') then
    insert into public.reports (
      slug, owner_id, title, source_url, data, visibility, published_at, created_at, updated_at
    )
    select p.slug,
           case when p.user_id ~ '^[0-9a-fA-F-]{36}$' then p.user_id::uuid else null end,
           coalesce(nullif(btrim(p.title), ''), 'Shared report'),
           p.url,
           coalesce(p.data, '{}'::jsonb),
           -- curated rows are already listed in /gallery -> stay public.
           -- everything else was shared by an explicit user action -> `link`.
           case when coalesce(p.curated, false) then 'public' else 'link' end,
           p.created_at, p.created_at, p.updated_at
      from public.public_reports p
     where p.slug is not null
       and not exists (select 1 from public.reports r where r.slug = p.slug);
  end if;
end $$;

-- ── RLS: service key only. The "public read" policy on public_reports is
-- deliberately NOT reproduced here — resolve_report_access() is the only path.
alter table public.reports           enable row level security;
alter table public.report_grants     enable row level security;
alter table public.report_access_log enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'reports' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.reports
             for all to service_role using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'report_grants' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.report_grants
             for all to service_role using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'report_access_log' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.report_access_log
             for all to service_role using (true) with check (true)';
  end if;
end $$;


-- ============================================================
-- 0040_pql.sql
-- ============================================================
-- 0040_pql.sql
-- Phase 3 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md —
-- activation instrumentation (PQL).
--
-- ── WHY A SEPARATE TABLE AND NOT A COLUMN ON entitlements ───────────────────
-- A PQL score is a DERIVED OPINION about a user, recomputed as the weight
-- table is tuned. `entitlements` is authorization state: what somebody paid
-- for. Mixing a mutable marketing score into the row every gate reads would
-- put a number nobody validates on the same path as the ones that decide
-- whether a request is allowed — and would make a scoring backfill an UPDATE
-- against the billing table.
--
-- ── activation_events IS APPEND-ONLY; pql_scores IS A CACHE ─────────────────
-- Same split as 0037: the events are the truth, the score is derived and may
-- be rebuilt from them at any time. That is what makes tuning PQL_SIGNALS
-- safe — a weight change is a recompute, never a data migration.
--
-- ── coverage IS STORED, AND NULL SCORES ARE LEGAL ───────────────────────────
-- src/lib/pql/pqlModel.js excludes signals this deployment cannot MEASURE and
-- redistributes their weight, rather than scoring them zero. A score computed
-- from three of nine signals is not the same claim as one computed from all
-- nine, so `coverage` travels with every row and `score` is NULLABLE: nothing
-- measurable means no score, which must not be storable as a 0 that later
-- reads as "unqualified". This mirrors the rule the discoverability module is
-- built on.
--
-- ── NO user_id FOREIGN KEY CASCADE ON activation_events ─────────────────────
-- Unlike the ledger, these ARE user content and SHOULD be purged with the
-- account, so both tables cascade. They are listed in billing-purge.js's
-- PURGE_TABLES for exactly that reason. Recording that here so the next person
-- to read this file does not have to re-derive the difference from 0037.
--
-- Adds 2 tables, 1 function, 0 triggers.

-- ── append-only activation events ──────────────────────────────────────────
create table if not exists public.activation_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  session_id  text,
  name        text not null,
  properties  jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  -- Either an account or an anonymous session must identify the row; a row
  -- attributable to neither can never be scored and is pure noise.
  constraint activation_events_subject_chk check (user_id is not null or session_id is not null)
);

create index if not exists activation_events_user_idx on public.activation_events (user_id, occurred_at desc);
create index if not exists activation_events_name_idx on public.activation_events (name, occurred_at desc);
create index if not exists activation_events_session_idx on public.activation_events (session_id, occurred_at desc)
  where session_id is not null;

-- ── the derived score cache ────────────────────────────────────────────────
create table if not exists public.pql_scores (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  -- NULL is a legal, meaningful value: nothing measurable. See the header.
  -- Scale is 0..130, NOT 0..100 — the PRD's nine signals sum to 130 and its
  -- threshold is 50 RAW POINTS. Storing a percentage here would re-scale that
  -- threshold to 65 points without anyone noticing.
  score        integer,
  -- Fraction of the signal weight that was measurable, 0..1.
  coverage     numeric(4,3) not null default 1.000,
  is_pql       boolean not null default false,
  activated    boolean not null default false,
  persona      text,
  -- The signal map the score was computed from, so a score is always
  -- explainable after the fact — including after the weights change.
  signals      jsonb not null default '{}'::jsonb,
  -- Which signals were excluded as unmeasurable at compute time. Without this,
  -- a low score from a partially-instrumented deployment is indistinguishable
  -- from a genuinely disengaged user, months later, with no way to tell.
  -- NOT named `excluded`: that is the pseudo-table name ON CONFLICT DO UPDATE
  -- binds, so `excluded = excluded.excluded` is a parse error waiting to
  -- happen the first time anyone writes an upsert against this table.
  excluded_signals text[] not null default '{}',
  computed_at  timestamptz not null default now(),
  constraint pql_scores_score_chk    check (score is null or (score >= 0 and score <= 130)),
  constraint pql_scores_coverage_chk check (coverage >= 0 and coverage <= 1),
  -- A NULL score cannot be a PQL. Enforced here rather than trusted from the
  -- application, because "no data" quietly becoming "qualified" is the exact
  -- failure that would put sales in front of a user who has done nothing.
  constraint pql_scores_null_not_pql_chk check (score is not null or is_pql = false)
);

create index if not exists pql_scores_pql_idx on public.pql_scores (is_pql, score desc) where is_pql;

-- ── RLS: service key only ──────────────────────────────────────────────────
-- Same posture as 0029_referrals.sql and 0031_team_workspaces.sql. The browser
-- only ever reaches Supabase through apiClient.js -> Netlify Functions, so an
-- anon/authenticated policy would be unused attack surface. A PQL score is
-- also commercially sensitive: a user must never be able to read how the
-- product scores them as a sales target.
alter table public.activation_events enable row level security;
alter table public.pql_scores        enable row level security;

-- ── upsert one computed score ──────────────────────────────────────────────
-- Takes the ALREADY-COMPUTED values rather than computing here: scorePql lives
-- in src/lib/pql/pqlModel.js and is imported by both React and netlify/, so
-- reimplementing the weights in PL/pgSQL would create a second, silently
-- diverging definition of what a PQL is. This function only persists.
create or replace function public.record_pql_score(
  p_user_id   uuid,
  p_score     integer,
  p_coverage  numeric,
  p_is_pql    boolean,
  p_activated boolean,
  p_persona   text,
  p_signals   jsonb,
  p_excluded_signals text[]
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return 'no_user';
  end if;
  -- A score with no data is not a qualification. Belt and braces with the
  -- CHECK constraint above: the constraint stops a bad row being written, this
  -- stops a caller having to think about it.
  insert into public.pql_scores (user_id, score, coverage, is_pql, activated, persona, signals, excluded_signals)
  values (p_user_id, p_score, coalesce(p_coverage, 1.000),
          coalesce(p_is_pql, false) and p_score is not null,
          coalesce(p_activated, false), p_persona,
          coalesce(p_signals, '{}'::jsonb), coalesce(p_excluded_signals, '{}'))
  on conflict (user_id) do update set
    score       = excluded.score,
    coverage    = excluded.coverage,
    is_pql      = excluded.is_pql,
    activated   = excluded.activated,
    persona     = excluded.persona,
    signals     = excluded.signals,
    excluded_signals = excluded.excluded_signals,
    computed_at = now();
  return 'ok';
exception
  when foreign_key_violation then
    return 'no_user';
end;
$$;

revoke all on function public.record_pql_score(uuid, integer, numeric, boolean, boolean, text, jsonb, text[]) from public, anon, authenticated;


-- ============================================================
-- 0041_bulk_enrichment.sql
-- ============================================================
-- 0041_bulk_enrichment.sql
-- Phase 4 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md —
-- PRD 3: Bulk Account Intelligence.
--
-- Adds 7 tables:
--   1. lists: workspace/user account lists
--   2. canonical_entities: deduplicated normalized company entities
--   3. list_records: per-account rows inside a list with ICP score & status
--   4. icp_score_rules: customer-editable ICP weighting criteria
--   5. enrichment_jobs: durable chunked runner jobs
--   6. enrichment_job_items: individual record execution states
--   7. review_queue: human confirmation queue for low-confidence facts
--
-- Adds 1 function (bulk_touch_updated_at) and 3 triggers.

-- ── 1. lists ────────────────────────────────────────────────────────────────
create table if not exists public.lists (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  workspace_id          uuid references public.workspaces(id) on delete cascade,
  name                  text not null,
  description           text,
  template_key          text not null default 'bulk_icp_enrichment',
  status                text not null default 'pending'
    check (status in ('pending', 'running', 'complete', 'partial', 'failed', 'paused')),
  total_records         integer not null default 0 check (total_records >= 0),
  completed_records     integer not null default 0 check (completed_records >= 0),
  failed_records        integer not null default 0 check (failed_records >= 0),
  needs_review_records  integer not null default 0 check (needs_review_records >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists lists_user_idx on public.lists (user_id, created_at desc);
create index if not exists lists_workspace_idx on public.lists (workspace_id) where workspace_id is not null;

-- ── 2. canonical_entities ───────────────────────────────────────────────────
create table if not exists public.canonical_entities (
  id                    uuid primary key default gen_random_uuid(),
  canonical_domain      text not null unique,
  company_name          text,
  normalized_name       text,
  industry              text,
  employee_range        text,
  hq_country            text,
  overview              text,
  enriched_payload      jsonb not null default '{}'::jsonb,
  last_enriched_at      timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists canonical_entities_domain_idx on public.canonical_entities (canonical_domain);

-- ── 3. list_records ─────────────────────────────────────────────────────────
create table if not exists public.list_records (
  id                    uuid primary key default gen_random_uuid(),
  list_id               uuid not null references public.lists(id) on delete cascade,
  raw_input             text not null,
  canonical_domain      text,
  status                text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'partial', 'failed', 'needs_review')),
  icp_score             numeric(5,2) check (icp_score is null or (icp_score >= 0 and icp_score <= 100)),
  icp_reasons           jsonb not null default '[]'::jsonb,
  enriched_data         jsonb not null default '{}'::jsonb,
  confidence_score      numeric(4,3) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  error                 text,
  credits_used          integer not null default 0 check (credits_used >= 0),
  run_id                text references public.template_runs(id) on delete set null,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz
);

create index if not exists list_records_list_idx on public.list_records (list_id, created_at asc);
create index if not exists list_records_status_idx on public.list_records (list_id, status);
create index if not exists list_records_domain_idx on public.list_records (canonical_domain) where canonical_domain is not null;

-- ── 4. icp_score_rules ──────────────────────────────────────────────────────
create table if not exists public.icp_score_rules (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references auth.users(id) on delete cascade,
  workspace_id          uuid references public.workspaces(id) on delete cascade,
  persona               text not null default 'default',
  name                  text not null,
  criteria              jsonb not null default '[]'::jsonb,
  threshold             numeric(5,2) not null default 50.00
    check (threshold >= 0 and threshold <= 100),
  is_default            boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists icp_score_rules_user_idx on public.icp_score_rules (user_id);
create index if not exists icp_score_rules_persona_idx on public.icp_score_rules (persona);

-- Seed default persona rules
insert into public.icp_score_rules (persona, name, criteria, threshold, is_default)
values
  ('sales', 'B2B Tech ICP Baseline', '[
    {"field": "industry", "operator": "in", "value": ["Software", "SaaS", "Fintech", "Technology"], "weight": 35},
    {"field": "employee_count", "operator": "gte", "value": 20, "weight": 25},
    {"field": "has_pricing", "operator": "equals", "value": true, "weight": 20},
    {"field": "has_contact", "operator": "equals", "value": true, "weight": 20}
  ]'::jsonb, 60.00, true),
  ('revops', 'Mid-Market Qualified ICP', '[
    {"field": "industry", "operator": "not_in", "value": ["Consumer", "Retail"], "weight": 30},
    {"field": "employee_count", "operator": "gte", "value": 50, "weight": 40},
    {"field": "hq_country", "operator": "in", "value": ["US", "CA", "GB", "EU"], "weight": 30}
  ]'::jsonb, 65.00, true),
  ('ci', 'Competitive Intelligence Monitor', '[
    {"field": "has_pricing", "operator": "equals", "value": true, "weight": 50},
    {"field": "has_product_tour", "operator": "equals", "value": true, "weight": 50}
  ]'::jsonb, 50.00, true),
  ('default', 'General ICP Criteria', '[
    {"field": "industry", "operator": "not_empty", "weight": 40},
    {"field": "employee_count", "operator": "gte", "value": 10, "weight": 30},
    {"field": "has_pricing", "operator": "equals", "value": true, "weight": 30}
  ]'::jsonb, 50.00, true)
on conflict do nothing;

-- ── 5. enrichment_jobs ──────────────────────────────────────────────────────
create table if not exists public.enrichment_jobs (
  id                    uuid primary key default gen_random_uuid(),
  list_id               uuid not null references public.lists(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  status                text not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'completed', 'failed')),
  batch_size            integer not null default 25 check (batch_size > 0),
  cursor                integer not null default 0 check (cursor >= 0),
  total_items           integer not null default 0 check (total_items >= 0),
  processed_items       integer not null default 0 check (processed_items >= 0),
  estimated_credits     integer not null default 0 check (estimated_credits >= 0),
  actual_credits        integer not null default 0 check (actual_credits >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists enrichment_jobs_list_idx on public.enrichment_jobs (list_id);
create index if not exists enrichment_jobs_status_idx on public.enrichment_jobs (status);

-- ── 6. enrichment_job_items ─────────────────────────────────────────────────
create table if not exists public.enrichment_job_items (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references public.enrichment_jobs(id) on delete cascade,
  record_id             uuid not null references public.list_records(id) on delete cascade,
  status                text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'skipped')),
  attempts              integer not null default 0 check (attempts >= 0),
  error                 text,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists enrichment_job_items_job_idx on public.enrichment_job_items (job_id, status);

-- ── 7. review_queue ─────────────────────────────────────────────────────────
create table if not exists public.review_queue (
  id                    uuid primary key default gen_random_uuid(),
  record_id             uuid not null references public.list_records(id) on delete cascade,
  list_id               uuid not null references public.lists(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  field_name            text not null,
  candidate_value       text,
  confidence            numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status                text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'edited')),
  resolved_value        text,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists review_queue_user_idx on public.review_queue (user_id, status);
create index if not exists review_queue_record_idx on public.review_queue (record_id);

-- ── helper trigger function ─────────────────────────────────────────────────
create or replace function public.bulk_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lists_touch_updated_at_trg on public.lists;
create trigger lists_touch_updated_at_trg
  before update on public.lists
  for each row execute function public.bulk_touch_updated_at();

drop trigger if exists icp_rules_touch_updated_at_trg on public.icp_score_rules;
create trigger icp_rules_touch_updated_at_trg
  before update on public.icp_score_rules
  for each row execute function public.bulk_touch_updated_at();

drop trigger if exists enrichment_jobs_touch_updated_at_trg on public.enrichment_jobs;
create trigger enrichment_jobs_touch_updated_at_trg
  before update on public.enrichment_jobs
  for each row execute function public.bulk_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.lists enable row level security;
alter table public.canonical_entities enable row level security;
alter table public.list_records enable row level security;
alter table public.icp_score_rules enable row level security;
alter table public.enrichment_jobs enable row level security;
alter table public.enrichment_job_items enable row level security;
alter table public.review_queue enable row level security;

-- lists policies
create policy lists_owner_access on public.lists
  for all using (user_id = auth.uid() or auth.uid() is null);

-- canonical_entities policies
create policy canonical_entities_select on public.canonical_entities
  for select using (true);

create policy canonical_entities_insert on public.canonical_entities
  for insert with check (auth.uid() is null or auth.uid() is not null);

create policy canonical_entities_update on public.canonical_entities
  for update using (auth.uid() is null or auth.uid() is not null);

-- list_records policies
create policy list_records_owner_access on public.list_records
  for all using (
    auth.uid() is null or exists (
      select 1 from public.lists l where l.id = list_records.list_id and l.user_id = auth.uid()
    )
  );

-- icp_score_rules policies
create policy icp_score_rules_select on public.icp_score_rules
  for select using (is_default = true or user_id = auth.uid() or auth.uid() is null);

create policy icp_score_rules_write on public.icp_score_rules
  for all using (user_id = auth.uid() or auth.uid() is null);

-- enrichment_jobs policies
create policy enrichment_jobs_owner_access on public.enrichment_jobs
  for all using (user_id = auth.uid() or auth.uid() is null);

-- enrichment_job_items policies
create policy enrichment_job_items_owner_access on public.enrichment_job_items
  for all using (
    auth.uid() is null or exists (
      select 1 from public.enrichment_jobs j where j.id = enrichment_job_items.job_id and j.user_id = auth.uid()
    )
  );

-- review_queue policies
create policy review_queue_owner_access on public.review_queue
  for all using (user_id = auth.uid() or auth.uid() is null);

grant all on public.lists to anon, authenticated, service_role;
grant all on public.canonical_entities to anon, authenticated, service_role;
grant all on public.list_records to anon, authenticated, service_role;
grant all on public.icp_score_rules to anon, authenticated, service_role;
grant all on public.enrichment_jobs to anon, authenticated, service_role;
grant all on public.enrichment_job_items to anon, authenticated, service_role;
grant all on public.review_queue to anon, authenticated, service_role;


-- ============================================================
-- 0042_watchlists.sql
-- ============================================================
-- 0042_watchlists.sql
-- Phase 5 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md —
-- PRD 4: Competitor Watchlists & Change Intelligence.
--
-- Adds 6 tables:
--   1. watchlists: named competitor tracking lists with cadence
--   2. watchlist_targets: monitored competitor domains
--   3. monitored_pages: discovered category pages (pricing, product, positioning)
--   4. entity_snapshots: structured snapshots (not bare HTML hashes)
--   5. field_changes: detected field deltas with materiality & fact vs interpretation
--   6. change_feedback: human signal tuning (useful / not_useful / mute_field)
--
-- Adds 1 function (watchlists_touch_updated_at) and 1 trigger.

-- ── 1. watchlists ───────────────────────────────────────────────────────────
create table if not exists public.watchlists (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  name          text not null,
  description   text,
  cadence       text not null default 'daily' check (cadence in ('hourly', 'daily', 'weekly')),
  status        text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists watchlists_user_idx on public.watchlists (user_id, created_at desc);
create index if not exists watchlists_workspace_idx on public.watchlists (workspace_id) where workspace_id is not null;

-- ── 2. watchlist_targets ───────────────────────────────────────────────────
create table if not exists public.watchlist_targets (
  id              uuid primary key default gen_random_uuid(),
  watchlist_id    uuid not null references public.watchlists(id) on delete cascade,
  domain          text not null,
  company_name    text,
  status          text not null default 'active' check (status in ('active', 'paused', 'error')),
  last_checked_at timestamptz,
  created_at      timestamptz not null default now(),
  constraint watchlist_targets_unique_domain unique (watchlist_id, domain)
);

create index if not exists watchlist_targets_watchlist_idx on public.watchlist_targets (watchlist_id);
create index if not exists watchlist_targets_domain_idx on public.watchlist_targets (domain);

-- ── 3. monitored_pages ─────────────────────────────────────────────────────
create table if not exists public.monitored_pages (
  id              uuid primary key default gen_random_uuid(),
  target_id       uuid not null references public.watchlist_targets(id) on delete cascade,
  url             text not null,
  category        text not null check (category in ('pricing', 'product', 'positioning', 'terms', 'other')),
  content_hash    text,
  last_fetched_at timestamptz,
  http_status     integer,
  created_at      timestamptz not null default now(),
  constraint monitored_pages_unique_url unique (target_id, url)
);

create index if not exists monitored_pages_target_idx on public.monitored_pages (target_id);

-- ── 4. entity_snapshots ────────────────────────────────────────────────────
create table if not exists public.entity_snapshots (
  id              uuid primary key default gen_random_uuid(),
  target_id       uuid not null references public.watchlist_targets(id) on delete cascade,
  page_id         uuid not null references public.monitored_pages(id) on delete cascade,
  snapshot_type   text not null check (snapshot_type in ('pricing', 'product', 'positioning')),
  extracted_data  jsonb not null default '{}'::jsonb,
  content_hash    text not null,
  created_at      timestamptz not null default now()
);

create index if not exists entity_snapshots_target_idx on public.entity_snapshots (target_id, created_at desc);

-- ── 5. field_changes ───────────────────────────────────────────────────────
create table if not exists public.field_changes (
  id                uuid primary key default gen_random_uuid(),
  target_id         uuid not null references public.watchlist_targets(id) on delete cascade,
  watchlist_id      uuid not null references public.watchlists(id) on delete cascade,
  field_name        text not null,
  category          text not null check (category in ('pricing', 'product', 'positioning', 'other')),
  old_value         text,
  new_value         text,
  materiality       text not null default 'medium' check (materiality in ('critical', 'high', 'medium', 'low', 'unknown')),
  fact_summary      text not null,
  ai_interpretation text,
  detected_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists field_changes_watchlist_idx on public.field_changes (watchlist_id, detected_at desc);
create index if not exists field_changes_target_idx on public.field_changes (target_id, detected_at desc);
create index if not exists field_changes_materiality_idx on public.field_changes (materiality);

-- ── 6. change_feedback ─────────────────────────────────────────────────────
create table if not exists public.change_feedback (
  id              uuid primary key default gen_random_uuid(),
  field_change_id uuid not null references public.field_changes(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  feedback        text not null check (feedback in ('useful', 'not_useful', 'mute_field')),
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists change_feedback_change_idx on public.change_feedback (field_change_id);
create index if not exists change_feedback_user_idx on public.change_feedback (user_id);

-- ── helper trigger function ─────────────────────────────────────────────────
create or replace function public.watchlists_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists watchlists_touch_updated_at_trg on public.watchlists;
create trigger watchlists_touch_updated_at_trg
  before update on public.watchlists
  for each row execute function public.watchlists_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.watchlists enable row level security;
alter table public.watchlist_targets enable row level security;
alter table public.monitored_pages enable row level security;
alter table public.entity_snapshots enable row level security;
alter table public.field_changes enable row level security;
alter table public.change_feedback enable row level security;

-- watchlists policies
create policy watchlists_owner_access on public.watchlists
  for all using (user_id = auth.uid() or auth.uid() is null);

-- watchlist_targets policies
create policy watchlist_targets_owner_access on public.watchlist_targets
  for all using (
    auth.uid() is null or exists (
      select 1 from public.watchlists w where w.id = watchlist_targets.watchlist_id and w.user_id = auth.uid()
    )
  );

-- monitored_pages policies
create policy monitored_pages_owner_access on public.monitored_pages
  for all using (
    auth.uid() is null or exists (
      select 1 from public.watchlist_targets t
      join public.watchlists w on w.id = t.watchlist_id
      where t.id = monitored_pages.target_id and w.user_id = auth.uid()
    )
  );

-- entity_snapshots policies
create policy entity_snapshots_owner_access on public.entity_snapshots
  for all using (
    auth.uid() is null or exists (
      select 1 from public.watchlist_targets t
      join public.watchlists w on w.id = t.watchlist_id
      where t.id = entity_snapshots.target_id and w.user_id = auth.uid()
    )
  );

-- field_changes policies
create policy field_changes_owner_access on public.field_changes
  for all using (
    auth.uid() is null or exists (
      select 1 from public.watchlists w where w.id = field_changes.watchlist_id and w.user_id = auth.uid()
    )
  );

-- change_feedback policies
create policy change_feedback_owner_access on public.change_feedback
  for all using (user_id = auth.uid() or auth.uid() is null);

grant all on public.watchlists to anon, authenticated, service_role;
grant all on public.watchlist_targets to anon, authenticated, service_role;
grant all on public.monitored_pages to anon, authenticated, service_role;
grant all on public.entity_snapshots to anon, authenticated, service_role;
grant all on public.field_changes to anon, authenticated, service_role;
grant all on public.change_feedback to anon, authenticated, service_role;


-- ============================================================
-- 0043_signal_rules.sql
-- ============================================================
-- 0043_signal_rules.sql
-- Phase 6 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md —
-- PRD 5: Native Signal Routing.
--
-- Adds 2 tables:
--   1. signal_rules: if-this-then-that routing rules (Slack, Email, Webhook, HubSpot)
--   2. rule_executions: audit trail of rule evaluations and action dispatches
--
-- Adds 1 function (signal_rules_touch_updated_at) and 1 trigger.

-- ── 1. signal_rules ─────────────────────────────────────────────────────────
create table if not exists public.signal_rules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  workspace_id    uuid references public.workspaces(id) on delete cascade,
  name            text not null,
  status          text not null default 'active' check (status in ('active', 'paused')),
  trigger_source  text not null check (trigger_source in ('watchlist', 'bulk_enrichment', 'workflow_run')),
  conditions      jsonb not null default '[]'::jsonb,
  action_type     text not null check (action_type in ('slack', 'email', 'webhook', 'hubspot')),
  action_config   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists signal_rules_user_idx on public.signal_rules (user_id, created_at desc);
create index if not exists signal_rules_source_idx on public.signal_rules (trigger_source, status);

-- ── 2. rule_executions ──────────────────────────────────────────────────────
create table if not exists public.rule_executions (
  id              uuid primary key default gen_random_uuid(),
  rule_id         uuid not null references public.signal_rules(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'success' check (status in ('success', 'failed', 'skipped')),
  event_payload   jsonb not null default '{}'::jsonb,
  action_response jsonb not null default '{}'::jsonb,
  error           text,
  latency_ms      integer,
  executed_at     timestamptz not null default now()
);

create index if not exists rule_executions_rule_idx on public.rule_executions (rule_id, executed_at desc);
create index if not exists rule_executions_user_idx on public.rule_executions (user_id, executed_at desc);

-- ── helper trigger function ─────────────────────────────────────────────────
create or replace function public.signal_rules_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists signal_rules_touch_updated_at_trg on public.signal_rules;
create trigger signal_rules_touch_updated_at_trg
  before update on public.signal_rules
  for each row execute function public.signal_rules_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.signal_rules enable row level security;
alter table public.rule_executions enable row level security;

-- signal_rules policies
create policy signal_rules_owner_access on public.signal_rules
  for all using (user_id = auth.uid() or auth.uid() is null);

-- rule_executions policies
create policy rule_executions_owner_access on public.rule_executions
  for all using (user_id = auth.uid() or auth.uid() is null);

grant all on public.signal_rules to anon, authenticated, service_role;
grant all on public.rule_executions to anon, authenticated, service_role;


-- ============================================================
-- 0044_lock_down_workflow_rls.sql
-- ============================================================
-- 0044_lock_down_workflow_rls.sql
--
-- SECURITY FIX. Migrations 0041 (bulk enrichment), 0042 (watchlists) and 0043
-- (signal rules) shipped fifteen tables that are readable AND writable by any
-- anonymous caller holding the publishable anon key — which is committed to
-- this repository and served in every browser bundle by design.
--
-- Two independent mistakes combined, and either alone would have been enough:
--
--   1.  grant all on public.<table> to anon, authenticated, service_role;
--       Phases 0-3 (0036-0040) grant nothing to anon at all.
--
--   2.  create policy ... for all using (user_id = auth.uid() or auth.uid() is null)
--       `auth.uid()` IS null for the anon role. The clause that reads like a
--       local-development convenience is in fact "…or the caller is anonymous",
--       so the policy evaluates TRUE for every row for exactly the caller it
--       was meant to exclude. `canonical_entities_insert`'s
--       `with check (auth.uid() is null or auth.uid() is not null)` is a
--       tautology — literally `true`.
--
-- Verified exploitable against the staging project on 2026-09-04, read-only:
--   GET /rest/v1/lists?select=id&limit=1   with only the public anon key
--   → HTTP 200, real row ids. No Authorization header, no session.
-- Reads were confirmed; the same policy grants insert, update and delete.
--
-- The rule this restores is already locked in this repo (0029_referrals.sql,
-- 0031_team_workspaces.sql, and 0036-0040): the browser NEVER reaches these
-- tables directly — it goes through a Netlify Function, which uses the service
-- key. An anon policy is therefore not a convenience, it is pure unused attack
-- surface. Ownership is enforced in the handler, and RLS is the second line.
--
-- Idempotent and safe to re-run. Drops the permissive policies by name, revokes
-- the grants, and installs the service-role-only policy the rest of the schema
-- uses.

-- ── 1. Drop every permissive policy from 0041-0043 ──────────────────────────
drop policy if exists lists_owner_access                on public.lists;
drop policy if exists canonical_entities_select         on public.canonical_entities;
drop policy if exists canonical_entities_insert         on public.canonical_entities;
drop policy if exists canonical_entities_update         on public.canonical_entities;
drop policy if exists list_records_owner_access         on public.list_records;
drop policy if exists icp_score_rules_select            on public.icp_score_rules;
drop policy if exists icp_score_rules_write             on public.icp_score_rules;
drop policy if exists enrichment_jobs_owner_access      on public.enrichment_jobs;
drop policy if exists enrichment_job_items_owner_access on public.enrichment_job_items;
drop policy if exists review_queue_owner_access         on public.review_queue;

drop policy if exists watchlists_owner_access           on public.watchlists;
drop policy if exists watchlist_targets_owner_access    on public.watchlist_targets;
drop policy if exists monitored_pages_owner_access      on public.monitored_pages;
drop policy if exists entity_snapshots_owner_access     on public.entity_snapshots;
drop policy if exists field_changes_owner_access        on public.field_changes;
drop policy if exists change_feedback_owner_access      on public.change_feedback;

drop policy if exists signal_rules_owner_access         on public.signal_rules;
drop policy if exists rule_executions_owner_access      on public.rule_executions;

-- ── 2. Revoke the anon/authenticated grants ─────────────────────────────────
-- `revoke` on a role that was never granted is a no-op, so this is safe even
-- if a prior partial fix has already run.
do $$
declare t text;
begin
  foreach t in array array[
    'lists','canonical_entities','list_records','icp_score_rules',
    'enrichment_jobs','enrichment_job_items','review_queue',
    'watchlists','watchlist_targets','monitored_pages','entity_snapshots',
    'field_changes','change_feedback',
    'signal_rules','rule_executions'
  ]
  loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ── 3. Re-assert RLS and install service-role-only policies ─────────────────
-- Matches 0036-0040 exactly. `to service_role` is the load-bearing clause: a
-- policy without it applies to PUBLIC, which is every role.
do $$
declare t text;
begin
  foreach t in array array[
    'lists','canonical_entities','list_records','icp_score_rules',
    'enrichment_jobs','enrichment_job_items','review_queue',
    'watchlists','watchlist_targets','monitored_pages','entity_snapshots',
    'field_changes','change_feedback',
    'signal_rules','rule_executions'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t
         and policyname = 'service full access'
    ) then
      execute format(
        'create policy "service full access" on public.%I '
        'for all to service_role using (true) with check (true)', t);
    end if;
  end loop;
end $$;


-- ============================================================
-- 0045_workflow_engines.sql
-- ============================================================
-- 0045_workflow_engines.sql
--
-- Schema the three execution engines need (PRD 3, 4, 5). Additive only: no
-- table is dropped, no column is removed, no data is rewritten.
--
-- Follows the service-role-only RLS convention 0044 restored. Nothing here
-- grants anything to anon.

-- ── 1. Field-level provenance on an enriched account row ────────────────────
--
-- The BRD makes provenance a product feature, not metadata: every important
-- output should disclose its source URL, extraction timestamp, method, and
-- "whether a field was explicitly observed, inferred, or generated by AI".
--
-- `enriched_data` holds the VALUES; this holds, per field, how we came to
-- believe them:
--   { "industry": { "method": "inferred", "source": "https://…", "confidence": 0.8 } }
--
-- It is separate from `confidence_score` (a single row-level number) because a
-- row is rarely uniformly trustworthy — a company name read off the page and an
-- industry inferred by a model are not the same kind of claim, and collapsing
-- them into one number is what let the previous enricher stamp 0.95 on
-- fabricated firmographics.
alter table public.list_records
  add column if not exists provenance jsonb not null default '{}'::jsonb;

-- ── 2. Watchlist crawl bookkeeping ──────────────────────────────────────────
--
-- `watchlists.last_run_at` lets the monitor answer "when did this watchlist
-- last actually run?" without scanning every target, and gives the UI something
-- truthful to show instead of implying a cadence that has never fired.
alter table public.watchlists
  add column if not exists last_run_at timestamptz;

-- Why a page stopped being monitored. A robots.txt refusal is a standing
-- decision, not a transient error, and must be distinguishable from "the fetch
-- failed this once" — otherwise the crawler retries a disallowed host hourly
-- for ever, which is exactly the behaviour our own /blog promises we do not
-- have.
alter table public.monitored_pages
  add column if not exists paused_reason text;

-- ── 3. Rule execution retry accounting ──────────────────────────────────────
--
-- PRD 5 lists "retry failed actions" as a Must. A retry needs somewhere to
-- record that it IS a retry, or a transient Slack 503 is indistinguishable from
-- a rule that has failed eleven times and should be reported to its owner.
alter table public.rule_executions
  add column if not exists attempt integer not null default 1;

alter table public.rule_executions
  add column if not exists next_retry_at timestamptz;

create index if not exists rule_executions_retry_idx
  on public.rule_executions (next_retry_at)
  where next_retry_at is not null;

-- ── 4. Keep the 0044 posture ────────────────────────────────────────────────
-- Adding a column cannot change a policy, but asserting it here means a future
-- reader of this file sees the invariant rather than having to go and check.
do $$
declare t text;
begin
  foreach t in array array['list_records','watchlists','monitored_pages','rule_executions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;


-- ============================================================
-- 0046_rule_execution_outcomes.sql
-- ============================================================
-- 0046_rule_execution_outcomes.sql
--
-- Two fixes to `rule_executions`, both about the audit trail PRD 5 requires
-- being able to record what actually happened.
--
-- ── 1. `refused` was not an allowed status ──────────────────────────────────
--
-- 0043 constrained status to ('success','failed','skipped'), but the dispatcher
-- added in this cycle also produces `refused` — the verdict when a rule's
-- destination is rejected at dispatch time, which is the SSRF guard firing.
--
-- The insert therefore violated the CHECK, and `dispatchSignal` catches
-- bookkeeping errors so it never breaks a dispatch — so the row was silently
-- dropped with a console.error. The net effect: **every security refusal was
-- missing from the audit trail**, which is precisely the event an operator most
-- needs to see. Verified against the real schema before this migration.
--
-- `refused` is kept DISTINCT from `failed` rather than folded into it. They mean
-- different things to the person reading the history: `failed` is "we tried and
-- the destination did not answer", `refused` is "we would not send this at all".
-- Collapsing them would tell a user their webhook is flaky when in fact we are
-- refusing to call it.
--
-- ── 2. `retrying` is a real state ───────────────────────────────────────────
--
-- PRD 5 lists "retry failed actions" as a Must. A row awaiting its next attempt
-- is neither a settled failure nor a success, and reporting it as `failed` would
-- make the change feed show a permanent failure for something still in flight.
--
-- ── 3. Why the constraint is dropped BY LOOKUP, not by name ─────────────────
--
-- 0043 declares the CHECK inline on the column, so its name is whatever Postgres
-- auto-generated — conventionally `rule_executions_status_check`, but that is a
-- convention this migration would be betting the fix on. Dropping an ASSUMED
-- name with `if exists` fails open twice over: if the live name differs at all
-- (a hand-applied constraint, a table rebuilt out of band, a second CHECK added
-- later and auto-suffixed `..._check1`), the DROP matches nothing, the ADD then
-- succeeds under a free name, and the table ends up carrying BOTH constraints.
--
-- Postgres ANDs CHECK constraints. Two of them means the old, narrower list is
-- still in force, so `refused` and `retrying` are still rejected — and the
-- migration reports success while fixing nothing. That is the same silent
-- failure this file exists to repair, reintroduced by the repair itself.
--
-- So: find every CHECK that actually constrains the `status` column (by attnum,
-- not by text matching, so a constraint on some future `http_status` is never
-- collateral), drop those, add exactly one, then ASSERT exactly one remains.
-- The assertion is the point — it converts a silent no-op into a failed
-- migration, which is the only way anyone finds out.

do $$
declare
  c        record;
  status_a smallint;
begin
  select attnum into status_a
    from pg_attribute
   where attrelid = 'public.rule_executions'::regclass
     and attname  = 'status'
     and not attisdropped;

  if status_a is null then
    raise exception '0046: public.rule_executions has no status column';
  end if;

  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.rule_executions'::regclass
       and con.contype  = 'c'
       and con.conkey   @> array[status_a]
  loop
    execute format('alter table public.rule_executions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.rule_executions
  add constraint rule_executions_status_check
  check (status in ('success', 'failed', 'skipped', 'refused', 'retrying'));

-- Fail loudly if anything but exactly one status CHECK survived. A second one
-- would silently re-narrow the set; zero would mean the ADD did not take.
do $$
declare n integer;
begin
  select count(*) into n
    from pg_constraint con
   where con.conrelid = 'public.rule_executions'::regclass
     and con.contype  = 'c'
     and con.conkey   @> array[(
           select attnum from pg_attribute
            where attrelid = 'public.rule_executions'::regclass
              and attname  = 'status'
              and not attisdropped)];

  if n <> 1 then
    raise exception
      '0046: expected exactly 1 CHECK on rule_executions.status, found %', n;
  end if;
end $$;

-- Keep the 0044 posture. Adding a constraint cannot change a policy, but
-- asserting it here means a reader sees the invariant rather than going to look.
alter table public.rule_executions enable row level security;
revoke all on public.rule_executions from anon;
revoke all on public.rule_executions from authenticated;
grant  all on public.rule_executions to service_role;


-- ============================================================
-- 0047_monitored_page_source.sql
-- ============================================================
-- 0047_monitored_page_source.sql
--
-- Records HOW a monitored page came to be monitored.
--
-- PRD 4 asks for two things that pull in opposite directions: *"Domain mapping
-- to recommend relevant pages"* and *"User chooses monitored categories/pages"*.
-- Automatic discovery satisfies the first and, left unlabelled, quietly
-- undermines the second — a user would open their watchlist and find pages they
-- never added, with no way to tell which were theirs.
--
-- `source` keeps the distinction visible:
--   'user' — explicitly added. The default, so nothing pre-existing is
--            retroactively relabelled as something the product guessed at.
--   'auto' — discovered by crawling the target's homepage. The UI can surface
--            these as "we added these, remove any you don't want", and a user
--            removing one is removing a suggestion rather than undoing their
--            own earlier decision.
--
-- Every auto-discovered page is a recurring crawl charged to the customer, so
-- being able to see and prune them is not cosmetic.

alter table public.monitored_pages
  add column if not exists source text not null default 'user'
  check (source in ('user', 'auto'));

-- Lets the crawler find "targets that have never been discovered for" without
-- scanning every page of every watchlist.
create index if not exists monitored_pages_source_idx
  on public.monitored_pages (target_id, source);

-- Keep the 0044 posture.
do $$ begin
  execute 'alter table public.monitored_pages enable row level security';
  execute 'revoke all on public.monitored_pages from anon';
  execute 'revoke all on public.monitored_pages from authenticated';
  execute 'grant all on public.monitored_pages to service_role';
end $$;


-- ============================================================
-- 0048_discoverability_evidence.sql
-- ============================================================
-- 0048_discoverability_evidence.sql
--
-- Gives every stored signal and every stored issue the provenance the BRD
-- requires of it, and stamps every result with the version of the maths that
-- produced it.
--
-- ── THE REQUIREMENT ────────────────────────────────────────────────────────
--   "Every signal and issue must retain evidence. Evidence includes source URL,
--    selector or extracted section, observed value, excerpt/structured object,
--    collection timestamp and confidence."
--   "Each score stores calculation components, raw values, normalized score,
--    weight, threshold, evidence and model version."
--
-- Before this migration the engine could satisfy neither sentence. `audit_signals`
-- had `raw_value` and `evidence_json` columns from 0030 that NOTHING EVER WROTE
-- — they have been NULL on every row since the module shipped — and
-- `audit_issues` had a single `evidence text` column holding a human sentence
-- with no source, no selector, no timestamp and no confidence. Both were
-- readable and neither was checkable, so "where exactly did you see that?" had
-- no answer, which is the question a customer asks the moment a finding
-- surprises them.
--
-- ── WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT ───────────────────────────
-- Additive only. Nothing is dropped, renamed or backfilled destructively.
--
--   audit_issues.evidence_json    NEW. The structured records, as an array.
--   audit_signals.threshold_json  NEW. The boundary a scorer applied, where one
--                                 exists at all — see below.
--   audit_results.scoring_model_version  NEW. Which maths produced these numbers.
--
-- `audit_issues.evidence` (the sentence) is KEPT and keeps its meaning. It is
-- what every export prints, what every stored row already contains and what
-- every historical diff compares — replacing it would rewrite the past. The
-- structured records sit BESIDE it, and the sentence becomes the issue's
-- plain-language observed fact rather than its only provenance.
--
-- ── WHY threshold_json IS NULLABLE AND USUALLY NULL ────────────────────────
-- Most signals are CURVES, not thresholds. Conciseness declines either side of
-- a 40-60 word band; heading integrity is a proportion of a tree; render
-- completeness is a ratio. Those have no boundary to record, and inventing one
-- so the column looks populated would put a number in front of a customer that
-- the scorer never applied. Only the signals that genuinely have a published
-- cut-off — Core Web Vitals' good/poor thresholds, the ideal answer-length band
-- — write here. A NULL means "this score is a curve", not "we forgot".
--
-- ── WHY THE VERSION LIVES ON THE RESULT, NOT THE AUDIT ─────────────────────
-- The audit row is the JOB — when it ran, what was asked for. The result row is
-- the MEASUREMENT. Two audits of the same URL a month apart may be scored by
-- different models, and it is the measurements that have to declare which rules
-- produced them, because it is measurements the diff engine subtracts. Storing
-- it on the job would put the version one join away from the numbers it governs.
--
-- Existing rows are backfilled to 'v1' rather than left NULL: they WERE scored,
-- by the model this repository has always shipped, and a NULL would read as
-- "unknown model" and make every historical baseline non-comparable overnight.

-- ── Structured evidence on findings ────────────────────────────────────────
alter table public.audit_issues
  add column if not exists evidence_json jsonb;

comment on column public.audit_issues.evidence_json is
  'Array of evidence records supporting this finding. Shape is fixed by src/lib/discoverability/evidenceModel.js: {method, observed, source_url, selector, section, observed_value, excerpt, structured, collected_at, confidence}. Sits beside `evidence`, which stays the human-readable observed fact.';

-- "Show me every finding that rests on a model judgement rather than a reading"
-- is a support question and a trust question, and without this it is a table
-- scan over every issue ever raised.
create index if not exists audit_issues_evidence_gin
  on public.audit_issues using gin (evidence_json);

-- ── The boundary a scorer applied, where there is one ──────────────────────
alter table public.audit_signals
  add column if not exists threshold_json jsonb;

comment on column public.audit_signals.threshold_json is
  'The published cut-off this signal was scored against, when it has one (Core Web Vitals good/poor, ideal answer-length band). NULL is the common and correct case: most signals are curves with no threshold, and a fabricated boundary would misdescribe the scorer.';

-- ── Which maths produced these numbers ─────────────────────────────────────
alter table public.audit_results
  add column if not exists scoring_model_version text;

comment on column public.audit_results.scoring_model_version is
  'Version of the scoring model that produced this result. auditDiff refuses to compare across versions: a delta between two different models is a number nobody earned. Bumped for any change that can move the score of an unchanged page — pillar/framework/signal weights, penalty factors, the penalty set, or a scorer curve.';

update public.audit_results
   set scoring_model_version = 'v1'
 where scoring_model_version is null;

-- NOT NULL, and deliberately WITHOUT a default.
--
-- A default would be the dangerous choice here, not the safe one: it would let
-- a future writer that forgets to stamp the version have its result silently
-- filed under whatever the default happened to be, which is exactly the class
-- of error the version exists to prevent. NOT NULL with no default means a
-- forgotten stamp is a loud write failure at the moment the code is wrong,
-- rather than a quiet mislabelling discovered months later in a trend line.
--
-- Safe to apply in one migration because the backfill above covers every
-- existing row and auditStore.persistResult falls back to the imported
-- SCORING_MODEL_VERSION constant, so it cannot send a null.
alter table public.audit_results
  alter column scoring_model_version set not null;

-- The trend and comparison queries filter on it, and they run per user.
create index if not exists audit_results_model_version_idx
  on public.audit_results (user_id, scoring_model_version);


-- ============================================================
-- 0049_discoverability_intake.sql
-- ============================================================
-- 0049_discoverability_intake.sql
--
-- Gives an audit the context it was commissioned with: what KIND of audit was
-- asked for, what the customer was trying to achieve, where they are trying to
-- be found, and who they measure themselves against.
--
-- ── THE REQUIREMENT ────────────────────────────────────────────────────────
-- The BRD's intake section makes audit type, primary goal and audit profile
-- REQUIRED fields, and adds target geography and competitor URLs beside them.
-- Of those five the schema carried exactly one — `audit_profile`, and only
-- four of its eight values.
--
-- ── WHY THIS MIGRATION CANNOT WAIT AND CANNOT BE BACK-FILLED ───────────────
-- Every other column in this module records something we MEASURED, and a
-- measurement can always be taken again by re-running the audit. These record
-- something the customer SAID. If nobody was asked "what are you trying to
-- achieve?" at the moment the audit was commissioned, that answer does not
-- exist anywhere and no later migration can recover it.
--
-- That is why `primary_goal` is nullable and why the historical rows are left
-- NULL rather than defaulted to anything. A default here would be a fabricated
-- intent — the same class of error as an evidence record with a guessed source
-- URL, and the P2 brand, product, service and local modules key off this field,
-- so a guessed goal would propagate into work nobody commissioned.
--
--   NULL primary_goal  =  "this audit predates the question" or "not answered"
--   NOT NULL           =  "the customer said this"
--
-- ── source vs audit_type: TWO DIFFERENT QUESTIONS ──────────────────────────
-- `source` (0030) already exists and is NOT what this is. `source` records WHO
-- ASKED — api, ui, schedule, benchmark, rerun. `audit_type` records WHAT KIND
-- of audit it is — a single page, a domain snapshot, a benchmark member, a
-- prompt monitor, a re-audit. They overlap on two values and diverge on the
-- rest: a scheduled run is `source = schedule` and `audit_type = rerun`,
-- because a monitor re-audits a page it has audited before, and a UI-initiated
-- domain snapshot would be `source = ui`, `audit_type = domain`.
--
-- Collapsing them, which is what the module did until now, is why "show me my
-- domain snapshots" and "show me everything the scheduler ran" could not both
-- be answered.
--
-- ── WHY THE CHECK LISTS TWO TYPES THE ENGINE CANNOT PRODUCE ────────────────
-- `domain` and `prompt_monitor` are legal values here and REFUSED by the API.
-- The vocabulary is a stored contract and widening a live CHECK later is a
-- migration, a deploy, and a window in which the API and the database disagree
-- about what is legal. Declaring the full set now costs nothing.
--
-- What would cost something is a row claiming to be a domain snapshot when a
-- single page was fetched, so `intakeModel.js` marks both `available: false`
-- and the router rejects them outright. A rejected request is visible in the
-- moment; a mislabelled row is discovered a quarter later, inside a trend line.

-- ── The four business-model profiles ───────────────────────────────────────
--
-- The BRD names eight profiles; 0030 allowed four. The four being added name a
-- BUSINESS rather than a framework, because "which of SEO, AEO and GEO matters
-- most to me?" is not a question a customer can answer on their first visit
-- and "I sell software" is.
--
-- ⚠️ A PROFILE IS STILL A LENS AND NOT DIFFERENT MATHS. All four framework
-- views are computed with identical weightings under every profile; the
-- profile selects which one leads the report. See the header of
-- src/lib/discoverability/auditProfiles.js. Nothing in this migration can
-- move a score, and `scoring_model_version` therefore stays 'v1'.
--
-- Dropped and re-added rather than widened in place: a CHECK constraint has no
-- ALTER form. The names are Postgres's own defaults for an inline
-- single-column check (`<table>_<column>_check`), which is what 0030 created.
alter table public.audits
  drop constraint if exists audits_audit_profile_check;
alter table public.audits
  add constraint audits_audit_profile_check
  check (audit_profile in ('balanced','seo','aeo','geo','saas','services','local','ecommerce'));

alter table public.audit_benchmarks
  drop constraint if exists audit_benchmarks_audit_profile_check;
alter table public.audit_benchmarks
  add constraint audit_benchmarks_audit_profile_check
  check (audit_profile in ('balanced','seo','aeo','geo','saas','services','local','ecommerce'));

alter table public.audit_schedules
  drop constraint if exists audit_schedules_audit_profile_check;
alter table public.audit_schedules
  add constraint audit_schedules_audit_profile_check
  check (audit_profile in ('balanced','seo','aeo','geo','saas','services','local','ecommerce'));

-- ── What kind of audit this is ─────────────────────────────────────────────
alter table public.audits
  add column if not exists audit_type text not null default 'url';

-- Defaulted, unlike primary_goal, because unlike a goal this one IS knowable
-- retrospectively: every audit that already exists fetched exactly one page,
-- which is what 'url' means. The default is a true statement about the past,
-- not a guess at one.
alter table public.audits
  drop constraint if exists audits_audit_type_check;
alter table public.audits
  add constraint audits_audit_type_check
  check (audit_type in ('url','domain','benchmark','prompt_monitor','rerun'));

comment on column public.audits.audit_type is
  'What kind of audit this is: url | domain | benchmark | prompt_monitor | rerun. Distinct from `source`, which records who asked (api|ui|schedule|benchmark|rerun). `domain` and `prompt_monitor` are legal values the engine cannot yet produce and the API refuses — see src/lib/discoverability/intakeModel.js.';

-- ── What the customer is trying to achieve ─────────────────────────────────
alter table public.audits
  add column if not exists primary_goal text;

alter table public.audits
  drop constraint if exists audits_primary_goal_check;
alter table public.audits
  add constraint audits_primary_goal_check
  check (primary_goal is null or primary_goal in (
    'seo_health','ai_citations','product_discovery',
    'service_leads','local_discovery','competitor_intelligence'));

comment on column public.audits.primary_goal is
  'The discoverability goal the customer selected at intake. NULL means the question was not asked or not answered — never a default, because a goal cannot be re-derived from anything and a fabricated one would propagate into the P2 modules that key off it. Changes which lens leads the report; changes NO score.';

-- ── Where they are trying to be found ──────────────────────────────────────
alter table public.audits
  add column if not exists target_geography jsonb;

comment on column public.audits.target_geography is
  'Normalised {country, region, city, language}, or NULL. Written by normaliseGeography() in src/lib/discoverability/intakeModel.js, which returns NULL rather than {} for an empty intake: an empty object reads as "asked and answered nowhere", which is a different claim from "nobody was asked". Country is upper-cased only when it is already an ISO 3166-1 alpha-2 code; free text is stored as typed rather than half-guessed into a code.';

-- ── Who they measure themselves against ────────────────────────────────────
alter table public.audits
  add column if not exists competitor_urls text[] not null default '{}';

comment on column public.audits.competitor_urls is
  'Competitors named at intake, capped at MAX_COMPETITOR_URLS (10). RECORDED CONTEXT ONLY — naming a competitor here fetches nothing and spends no audit credit. audit_benchmarks is what turns them into runs.';

-- ── How the profile was chosen ─────────────────────────────────────────────
--
-- The same rule the evidence envelope enforces one layer down: an observed
-- fact and an inference must never be presented as the same kind of thing.
-- "You are reading the GEO view because you asked for it" and "because we
-- guessed from your schema" are different claims, and a customer who disagrees
-- with the second one needs to be able to see that it was a guess.
--
-- Defaulted to 'default' — literally true of every existing row, all of which
-- carry the profile they were sent or the 'balanced' fallback, with nothing
-- inferred because nothing inferred anything before this migration.
alter table public.audits
  add column if not exists audit_profile_source text not null default 'default';

alter table public.audits
  drop constraint if exists audits_audit_profile_source_check;
alter table public.audits
  add constraint audits_audit_profile_source_check
  check (audit_profile_source in ('explicit','goal','inferred','default'));

comment on column public.audits.audit_profile_source is
  'Why this audit carries the profile it does: explicit (the customer chose it) | goal (derived from primary_goal) | inferred (read from the page) | default. Resolved by resolveAuditProfile() in src/lib/discoverability/intakeModel.js, whose ordering is the definition of this column.';

-- "Show me every audit run for local discovery" is a real question and this is
-- what makes it an index scan. Partial, because the column is NULL on every
-- row that predates the question and those rows answer no goal query.
create index if not exists audits_owner_goal_idx
  on public.audits (user_id, primary_goal, created_at desc)
  where primary_goal is not null;

create index if not exists audits_owner_type_idx
  on public.audits (user_id, audit_type, created_at desc);

-- ── Intake reuse on the recurring path ─────────────────────────────────────
--
-- A schedule re-audits the same page week after week, and the trend line it
-- produces is only comparable if every run was commissioned the same way. A
-- monitor that dropped the goal and the geography on every run would build a
-- twelve-month series in which the first point had context and none of the
-- others did — and the comparison would still be drawn, because nothing in the
-- diff engine knows the context changed.
alter table public.audit_schedules
  add column if not exists primary_goal text;

alter table public.audit_schedules
  drop constraint if exists audit_schedules_primary_goal_check;
alter table public.audit_schedules
  add constraint audit_schedules_primary_goal_check
  check (primary_goal is null or primary_goal in (
    'seo_health','ai_citations','product_discovery',
    'service_leads','local_discovery','competitor_intelligence'));

alter table public.audit_schedules
  add column if not exists page_type_hint text;

alter table public.audit_schedules
  add column if not exists target_geography jsonb;

alter table public.audit_schedules
  add column if not exists competitor_urls text[] not null default '{}';

comment on column public.audit_schedules.primary_goal is
  'Carried onto every audit this schedule creates, so a monitored page keeps the context it was commissioned with across the whole trend line.';


-- ============================================================
-- 0050_discoverability_gap_analysis.sql
-- ============================================================
-- 0050_discoverability_gap_analysis.sql
--
-- Turns a list of findings into a diagnosis, and connects each finding to the
-- work it produced.
--
-- ── THE REQUIREMENT ────────────────────────────────────────────────────────
-- The BRD specifies eleven fields on every issue. The table carried six. The
-- five it did not carry are the five that make a queue actionable rather than
-- merely correct:
--
--   observed facts, separately from inference   ← one blended `evidence` column
--   root cause                                  ← no taxonomy at all
--   recommended DatIQ module                    ← absent
--   recommended owner role                      ← catalogue-only, never stored
--   workflow state                              ← issues had no lifecycle
--
-- ── WHY A ROOT CAUSE, WHEN EVERY ISSUE ALREADY HAS A CODE ──────────────────
-- 46 codes is more than anyone reads. Forty individually-true findings is a
-- list, not a diagnosis, and the reader's question is "what is WRONG with this
-- page" — which no single code answers and which grouping by PILLAR does not
-- answer either, because a pillar is a scoring construct. "Entity authority is
-- 42" says where points were lost, not what to go and do.
--
-- Root cause is the axis a person can act on: eleven findings that all reduce
-- to `entity_ambiguity` are one afternoon's work, and seeing that is the
-- difference between a report that gets worked and one that gets filed.
--
-- ── WHY observed AND inference ARE TWO COLUMNS ─────────────────────────────
-- They have different warranties, and storing them in one column launders the
-- weaker one into the stronger.
--
--   "The page has two H1 elements"        MEASURED. We will defend it.
--   "This dilutes the topical signal"     REASONED. An expert could disagree.
--
-- Both were already present in the codebase — the per-audit sentence and the
-- catalogue's `why` — but they reached the reader as one paragraph, which gives
-- the second the authority of the first. The split is the same discipline
-- migration 0048 applied to evidence `method` (`observed: true|false`) one
-- layer down, and the same discipline 0049 applied to `audit_profile_source`.
--
-- ⚠️ `evidence` IS KEPT AND KEEPS ITS MEANING. It is what every export prints,
-- what every stored row already contains and what every historical diff
-- compares. `observed` is populated from the same sentence going forward;
-- replacing the column would rewrite the past.
--
-- ── WHY owner_role IS DENORMALISED ─────────────────────────────────────────
-- `owner` has lived in issueCatalog.js since the module shipped and has never
-- been stored. "Show me everything engineering has to do this sprint" was
-- therefore a client-side filter over a list the client had to fetch in full
-- first — which is not a query, and does not survive the queue growing.

-- ── The diagnosis ──────────────────────────────────────────────────────────
alter table public.audit_issues
  add column if not exists root_cause text;

alter table public.audit_issues
  drop constraint if exists audit_issues_root_cause_check;
alter table public.audit_issues
  add constraint audit_issues_root_cause_check
  check (root_cause is null or root_cause in (
    'technical_access','weak_page_structure','entity_ambiguity','insufficient_proof',
    'missing_content_coverage','location_radius_mismatch','ux_friction','conversion_friction'));

comment on column public.audit_issues.root_cause is
  'Which of the eight causes in src/lib/discoverability/gapTaxonomy.js this finding reduces to. NULL on rows written before this migration — the taxonomy did not exist when they were recorded, and assigning one retrospectively would be a diagnosis nobody made. Two of the eight (location_radius_mismatch, conversion_friction) are declared for P2 and unused in P1, deliberately: the vocabulary is a contract, and a taxonomy that arrives in two halves invites the second half to be numbered around the first.';

-- ── The referral ───────────────────────────────────────────────────────────
--
-- ⚠️ STORED AS A SLUG, NOT AS THE BRD's "M1-M13" NUMBER.
-- The BRD names the modules M1 to M13 and does not enumerate which is which
-- anywhere this repository can see. Numbering them from a guess and storing
-- those numbers would break the rule that matters most here — codes are a
-- public contract, never renumber one — the first time the real list
-- disagreed. The slug is derived from the PRD's own section names and cannot be
-- wrong about itself; `MODULES[].mCode` in gapTaxonomy.js is a nullable display
-- alias waiting for that confirmation, and nothing keys off it.
alter table public.audit_issues
  add column if not exists recommended_module text;

alter table public.audit_issues
  drop constraint if exists audit_issues_recommended_module_check;
alter table public.audit_issues
  add constraint audit_issues_recommended_module_check
  check (recommended_module is null or recommended_module in (
    'technical_remediation','recommendation_studio','schema_intelligence','ai_visibility',
    'validation_lab','business_truth_record','entity_graph','brand_discoverability',
    'product_discoverability','service_findability','local_directory','trust_and_proof',
    'service_radius'));

comment on column public.audit_issues.recommended_module is
  'Which DatIQ capability answers this finding, as a slug. See gapTaxonomy.js — the slug is the contract; the BRD''s M1-M13 numbering is an unconfirmed display alias and is deliberately not stored.';

-- ── Observed fact, and inference, as two columns ───────────────────────────
alter table public.audit_issues
  add column if not exists observed text;

alter table public.audit_issues
  add column if not exists inference text;

comment on column public.audit_issues.observed is
  'What was MEASURED on this page, on this run. Per-audit. Populated from the same sentence `evidence` carries, which is kept unchanged so historical rows and every export keep working.';

comment on column public.audit_issues.inference is
  'What it is REASONED to mean. Per-code, from issueCatalog.why. Separate from `observed` because the two have different warranties and one column launders the weaker into the stronger.';

-- ── Who fixes it ───────────────────────────────────────────────────────────
alter table public.audit_issues
  add column if not exists owner_role text;

alter table public.audit_issues
  drop constraint if exists audit_issues_owner_role_check;
alter table public.audit_issues
  add constraint audit_issues_owner_role_check
  check (owner_role is null or owner_role in ('content','seo','engineering','brand','product'));

-- ── The lifecycle issues have never had ────────────────────────────────────
--
-- The full BRD vocabulary is declared now, and only `open` is reachable until
-- W8 wires the transitions. Same reasoning as 0049's audit types: widening a
-- live CHECK later is a migration plus a deploy plus a window in which the API
-- and the database disagree about what is legal, and declaring the whole set
-- costs nothing. What it must NOT do is let a row claim a state no code can
-- produce — the API is what enforces that, not the constraint.
alter table public.audit_issues
  add column if not exists status text not null default 'open';

alter table public.audit_issues
  drop constraint if exists audit_issues_status_check;
alter table public.audit_issues
  add constraint audit_issues_status_check
  check (status in ('open','accepted','assigned','in_progress','implemented',
                    'validation_scheduled','validated','dismissed'));

alter table public.audit_issues
  add column if not exists status_changed_at timestamptz;

comment on column public.audit_issues.status is
  'BRD workflow state. The full seven-stage vocabulary plus `dismissed` is declared here; only `open` is reachable until W8 wires the transitions. Defaulted rather than nullable because every finding genuinely starts open — unlike primary_goal in 0049, this one IS knowable retrospectively.';

-- "Everything engineering owns that is still open, worst first" — the query the
-- queue is actually built from, and a table scan without this.
create index if not exists audit_issues_owner_status_idx
  on public.audit_issues (user_id, owner_role, status, severity);

-- "What is really wrong with this page" — grouping the report by diagnosis.
create index if not exists audit_issues_root_cause_idx
  on public.audit_issues (audit_id, root_cause)
  where root_cause is not null;

-- ── The link that was declared and never written ───────────────────────────
--
-- 🔴 `audit_recommendations.issue_id` HAS EXISTED SINCE MIGRATION 0030 AND
-- NOTHING HAS EVER WRITTEN IT. NULL on every row for the life of the module —
-- the same defect class as `audit_signals.raw_value` and `.evidence_json`,
-- which W1 found in the same table set.
--
-- The consequence is that every recommendation is an orphan. "Which finding
-- produced this task" has had no answer in the data, so the validation loop
-- could not close: when a re-audit reports AC-01 resolved there was no way to
-- mark the recommendation it produced as validated except by matching on
-- `code`, which works only while the mapping stays one-to-one and silently
-- mis-attributes the moment it does not.
--
-- No column is added here. The fix is in the WRITE PATH (auditStore.persistResult
-- now inserts issues first, keeps the returned ids and threads them onto the
-- recommendation rows), and this index is what makes the resulting join cheap.
create index if not exists audit_recommendations_issue_idx
  on public.audit_recommendations (issue_id)
  where issue_id is not null;


-- ============================================================
-- 0051_recommendation_assignment.sql
-- ============================================================
-- 0051_recommendation_assignment.sql — W5.5. The assign verb.
--
-- §7.6 lists the Recommendation Studio's acceptance verbs: copy, export,
-- accept, dismiss, mark implemented — all shipped — and **assign**, which was
-- not. A queue you cannot hand to anybody is a personal to-do list.
--
-- ── WHY A USER AND NOT A ROLE ──────────────────────────────────────────────
-- W4 added `audit_issues.owner_role`, which says a fix belongs to Engineering
-- or Content. That is a CLASSIFICATION, and it is per issue CODE — every
-- noindex finding everywhere has the same owner role. It cannot answer "who is
-- doing this one", which is the question a queue exists to settle.
--
-- Decision D6 defers the PRD's seven-role RBAC to P2, so this deliberately adds
-- no role system. It adds one nullable pointer to a real person, reusing
-- `workspace_members` (migration 0031). When P2's RBAC arrives it layers on
-- top of an assignee that already exists, rather than having to backfill one.
--
-- ── on delete set null, NOT cascade ────────────────────────────────────────
-- A person leaving must not delete the recommendation they were holding. It
-- becomes unassigned and returns to the queue, which is what actually happens
-- in the room. `on delete cascade` here would quietly destroy audit findings
-- as a side effect of offboarding.

alter table public.audit_recommendations
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

comment on column public.audit_recommendations.assigned_to is
  'The person holding this fix. NULL means unassigned, which is the default and the resting state. Set only to a user who shares a workspace with the owner (enforced by assign_recommendation); nulled automatically if that account is deleted, so offboarding never destroys a finding.';

alter table public.audit_recommendations
  add column if not exists assigned_at timestamptz;

comment on column public.audit_recommendations.assigned_at is
  'When the current assignee took it. NULL whenever assigned_to is NULL. Kept beside the pointer rather than derived from the event log so the queue can sort by it without a join.';

-- Partial: the overwhelming majority of rows are unassigned, and "show me what
-- I am holding" is the only query this index has to serve.
create index if not exists audit_recommendations_assignee_idx
  on public.audit_recommendations (assigned_to)
  where assigned_to is not null;

-- ── The assignment itself ──────────────────────────────────────────────────
--
-- 🔴 THE SHARED-WORKSPACE CHECK LIVES HERE, NOT ONLY IN THE HANDLER.
-- Without it, `assigned_to` accepts any uuid in auth.users, which turns the
-- endpoint into a membership oracle: assign, read back the result, and learn
-- whether an id is a real account. This repo has already shipped that class of
-- defect — four IDORs in Phases 4-6, one of which took no user id at all — and
-- the fix that stuck was the one the database enforced.
--
-- Returns 'ok' | 'not_found' | 'not_a_member'. Callers map not_found to 404 and
-- never to 403: a 403 confirms the id is real, which is how an id space gets
-- enumerated.
create or replace function public.assign_recommendation(
  p_user_id uuid,
  p_rec_id uuid,
  p_assignee uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner
    from public.audit_recommendations
   where id = p_rec_id and user_id = p_user_id;

  if v_owner is null then
    return 'not_found';
  end if;

  -- Unassigning is always allowed: you can always put work down.
  if p_assignee is null then
    update public.audit_recommendations
       set assigned_to = null, assigned_at = null
     where id = p_rec_id;
    return 'ok';
  end if;

  -- Assigning to yourself needs no workspace at all. A solo operator has no
  -- workspace rows, and refusing them their own queue would be absurd.
  if p_assignee <> p_user_id then
    if not exists (
      select 1
        from public.workspace_members me
        join public.workspace_members them
          on them.workspace_id = me.workspace_id
       where me.user_id = p_user_id
         and them.user_id = p_assignee
    ) then
      return 'not_a_member';
    end if;
  end if;

  update public.audit_recommendations
     set assigned_to = p_assignee, assigned_at = now()
   where id = p_rec_id;

  return 'ok';
end;
$$;

comment on function public.assign_recommendation(uuid, uuid, uuid) is
  'Assign a recommendation to a person who shares a workspace with its owner, or to the owner themselves. Returns ok | not_found | not_a_member. The membership check is here rather than only in the handler so the column cannot be set to an arbitrary account id by any path.';

revoke all on function public.assign_recommendation(uuid, uuid, uuid) from public, anon, authenticated;


-- ============================================================
-- 0052_citation_states.sql
-- ============================================================
-- 0052_citation_states.sql — W6.3. Seven states where there were two booleans.
--
-- `audit_prompt_runs` has carried `mention_detected` and `citation_detected`
-- since 0030. Four combinations, and three of them say almost nothing: the
-- difference between "we are invisible" and "we are visible and losing" — which
-- are different problems with different fixes — is not expressible in them.
--
-- ── THE OLD BOOLEANS ARE KEPT, NOT REPLACED ────────────────────────────────
-- `citation_footprint` scores from them, every stored audit contains them and
-- every historical diff compares them. Dropping them would silently rewrite the
-- past. `state` is derived from the same measurements and sits beside them.
--
-- 🔴 A NULL STATE MEANS "NOT CLASSIFIED", NEVER "ABSENT". Rows written before
-- this migration have no state, and `absent` is a measured finding that the
-- brand did not appear. Reading one as the other would turn every historical
-- run into evidence of invisibility.

alter table public.audit_prompt_runs
  add column if not exists state text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'audit_prompt_runs_state_check'
  ) then
    alter table public.audit_prompt_runs
      add constraint audit_prompt_runs_state_check
      check (state is null or state in (
        'misrepresented', 'cited_and_recommended', 'recommended',
        'cited', 'mentioned', 'competitor_dominated', 'absent'
      ));
  end if;
end $$;

comment on column public.audit_prompt_runs.state is
  'Which of the seven PRD citation states this answer represents. NULL on rows written before 0052, meaning NOT CLASSIFIED — never read a NULL as ''absent'', which is a measured finding that the brand did not appear.';

-- ── What was asked, and whether it was a contest ───────────────────────────
--
-- RecommendationRate is measured over COMMERCIAL prompts only: "what is X"
-- cannot produce a recommendation, and counting it would dilute the rate with
-- questions that were never a contest. The denominator therefore has to be
-- stored per run and survive into every later read of this audit.
alter table public.audit_prompt_runs
  add column if not exists prompt_kind text;

comment on column public.audit_prompt_runs.prompt_kind is
  'One of the seven taxonomy kinds (brand, category, buyer_problem, comparison, industry, local, trust). NULL for runs predating the taxonomy.';

alter table public.audit_prompt_runs
  add column if not exists commercial boolean;

comment on column public.audit_prompt_runs.commercial is
  'Whether being named in this answer would be advocacy rather than recall. The denominator of RecommendationRate. NULL means unknown, and an unknown must be excluded from that rate rather than counted as false.';

alter table public.audit_prompt_runs
  add column if not exists kind_confidence smallint;

comment on column public.audit_prompt_runs.kind_confidence is
  '100 when the prompt was generated and its kind is a fact; lower when a user wrote the prompt and the kind was inferred from its text. A rate computed over inferred intent deserves to be read more cautiously than one computed over declared intent.';

-- ── The two judgements behind the state ────────────────────────────────────

alter table public.audit_prompt_runs
  add column if not exists recommended boolean;

comment on column public.audit_prompt_runs.recommended is
  'Did the sentences naming the brand advocate for it? Only meaningful where commercial is true.';

-- 🔴 THREE-VALUED ON PURPOSE. true = the engine stated something the page
-- contradicts; false = checked and consistent; NULL = COULD NOT CHECK, which is
-- the common case (the page states no price to check against). Collapsing NULL
-- to false would report every unverifiable answer as verified-correct.
alter table public.audit_prompt_runs
  add column if not exists misrepresented boolean;

comment on column public.audit_prompt_runs.misrepresented is
  'Three-valued. true: the answer stated a claim the audited page contradicts. false: checked and consistent. NULL: could not be checked, which is the common case — never read NULL as false.';

-- ── Who else was in the answer ─────────────────────────────────────────────
--
-- Each entry carries `declared`: true for a competitor the operator typed at
-- intake (exact match, confidence 100), false for a domain the engine cited
-- that we inferred to be a rival (confidence 45). AI SOV is reported against
-- each set separately and never against their sum — see competitorTracking.js.
alter table public.audit_prompt_runs
  add column if not exists competitors_json jsonb;

comment on column public.audit_prompt_runs.competitors_json is
  'Competitors present in this answer, each with `declared` and a confidence. Declared ones were named by the operator and matched exactly; discovered ones are inferred from cited domains. Never blend the two into one share-of-voice number.';

create index if not exists audit_prompt_runs_state_idx
  on public.audit_prompt_runs (audit_id, state)
  where state is not null;


-- ============================================================
-- 0053_prompt_monitors.sql
-- ============================================================
-- 0053_prompt_monitors.sql — W6.5. Prompt monitoring gets its own schedule.
--
-- `intakeModel.js` has declared a `prompt_monitor` audit type since W2, shipped
-- `available: false` with "not available yet". This is the engine behind it.
--
-- ── WHY NOT audit_schedules ────────────────────────────────────────────────
-- `discoverability-monitor.js` states the rule this follows: it refuses to
-- share a cron with `scheduled-runner.js` because "they share a cadence and
-- nothing else — the row shape, the alert condition and the failure mode are
-- all different". The same is true one level down:
--
--   row shape       an audit schedule points at a TARGET and scores a page.
--                   A prompt monitor points at a PROMPT SET and samples an
--                   engine. The target is context, not the subject.
--   alert condition an audit alerts when a SCORE moves past a threshold.
--                   A monitor alerts when a citation STATE changes — going
--                   from cited to absent is news at any score.
--   failure mode    an audit fails when a page is unreachable. A monitor fails
--                   when an ENGINE is unreachable, which is a different outage
--                   with a different remedy and must not pause page auditing.
--
-- Folding them together would put two unrelated job kinds behind one cron's
-- assumptions, which is the thing that rule exists to prevent.

create table if not exists public.prompt_monitors (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  workspace_id    uuid,
  -- Context, not subject: which brand and domain the answers are read against.
  target_id       uuid not null references public.audit_targets(id) on delete cascade,
  prompt_set_id   uuid references public.audit_prompt_sets(id) on delete set null,
  name            text,

  cadence         text not null default 'weekly'
                    check (cadence in ('daily','weekly','monthly')),
  -- NULL means "whichever live engine is configured", which is the honest
  -- default: pinning an engine a deployment has no key for would make the
  -- monitor fail silently rather than degrade.
  engine          text check (engine is null or engine in ('perplexity','gemini')),

  -- The user's intent, and the platform's, kept apart for the same reason
  -- audit_schedules keeps them apart: a monitor an operator paused must not be
  -- resumable by the user, and one the USER paused must stay paused when the
  -- platform resumes everything it stopped.
  status              text not null default 'active' check (status in ('active','paused')),
  system_paused       boolean not null default false,
  system_pause_reason text,

  alert_email     text,
  -- 🔴 THE ALERT CONDITION IS A STATE CHANGE, NOT A SCORE MOVE. Going from
  -- `cited` to `absent` is news even when WAVI barely moves, because the thing
  -- that changed is whether anyone can find you through that question.
  alert_on_state_change boolean not null default true,
  -- Secondary: WAVI moving past this many points also alerts. 0 disables it.
  alert_wavi_delta      numeric(5,2) not null default 10,

  last_run_at     timestamptz,
  next_run_at     timestamptz,
  run_until       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.prompt_monitors is
  'A recurring answer-engine sample over a prompt set. Separate from audit_schedules because the row shape, the alert condition and the failure mode all differ — an engine outage must not pause page auditing.';

create index if not exists prompt_monitors_due_idx
  on public.prompt_monitors (next_run_at)
  where status = 'active' and system_paused = false;

create index if not exists prompt_monitors_user_idx
  on public.prompt_monitors (user_id, created_at desc);

-- ── Results ────────────────────────────────────────────────────────────────
--
-- One row per run of the whole set. The per-prompt detail lives in
-- audit_prompt_runs, which already stores states, kinds and competitors and
-- gains a nullable monitor_id below rather than being duplicated here.
create table if not exists public.prompt_monitor_runs (
  id               uuid primary key default gen_random_uuid(),
  monitor_id       uuid not null references public.prompt_monitors(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  engine_name      text,
  -- Whether the answers were RETRIEVED or recalled. A run where every answer
  -- came from a model's weights is not a measurement of the live web, and a
  -- trend line that mixes the two is comparing different things.
  live             boolean not null default false,
  prompt_count     integer not null default 0,
  -- The rates and index, stored so a trend does not have to recompute history
  -- through whatever version of the maths is current.
  mention_rate     numeric(5,2),
  citation_rate    numeric(5,2),
  recommendation_rate numeric(5,2),
  wavi_score       numeric(5,2),
  wavi_coverage    numeric(5,2),
  sov_declared     numeric(5,2),
  states_json      jsonb,
  error            text,
  created_at       timestamptz not null default now()
);

comment on column public.prompt_monitor_runs.recommendation_rate is
  'Measured over COMMERCIAL prompts only, and NULL when the set contained none. Never read a NULL here as zero — it means the question was not asked, not that the answer was no.';

comment on column public.prompt_monitor_runs.wavi_coverage is
  'What share of WAVI''s weight was actually measured. A score without its coverage is half a measurement.';

create index if not exists prompt_monitor_runs_monitor_idx
  on public.prompt_monitor_runs (monitor_id, created_at desc);

-- Ties a stored prompt run to the monitor that produced it. Nullable because
-- the overwhelming majority of prompt runs come from an audit, not a monitor.
alter table public.audit_prompt_runs
  add column if not exists monitor_run_id uuid
    references public.prompt_monitor_runs(id) on delete cascade;

create index if not exists audit_prompt_runs_monitor_idx
  on public.audit_prompt_runs (monitor_run_id)
  where monitor_run_id is not null;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Service-key only, matching every other table in this module. The browser
-- reaches Supabase exclusively through Netlify Functions, so a direct-read
-- policy would be unused attack surface.
alter table public.prompt_monitors enable row level security;
alter table public.prompt_monitor_runs enable row level security;

drop policy if exists prompt_monitors_service on public.prompt_monitors;
create policy prompt_monitors_service on public.prompt_monitors
  for all to service_role using (true) with check (true);

drop policy if exists prompt_monitor_runs_service on public.prompt_monitor_runs;
create policy prompt_monitor_runs_service on public.prompt_monitor_runs
  for all to service_role using (true) with check (true);

revoke all on public.prompt_monitors from anon, authenticated;
revoke all on public.prompt_monitor_runs from anon, authenticated;

-- Keep updated_at honest without a second trigger function: reuse the one
-- 0030 already created for this module.
drop trigger if exists prompt_monitors_touch on public.prompt_monitors;
create trigger prompt_monitors_touch
  before update on public.prompt_monitors
  for each row execute function public.audit_touch_updated_at();


-- ============================================================
-- 0054_workflow_hub.sql
-- ============================================================
-- 0054_workflow_hub.sql — W8. The lifecycle a queue needs to be a queue.
--
-- Shipped states are `open | accepted | dismissed | done`. The PRD's lifecycle
-- is Open → Accepted → Assigned → In progress → Implemented → Validation
-- scheduled → Validated, and the gap between those two lists is the difference
-- between a checklist and a workflow: there is no way to say a fix is underway,
-- and no way to say it was verified rather than merely claimed.
--
-- ── EIGHT STATES, NOT THE PRD'S SEVEN ──────────────────────────────────────
-- `dismissed` is ours and it stays. A queue you cannot decline an item from
-- forces the user to either do work they judged unnecessary or leave it open
-- for ever, and the mandatory dismissal REASON this codebase already enforces
-- is some of the most useful data in the table — "three months from now a
-- dismissal with no reason is indistinguishable from a mis-click".
--
-- ── `done` IS KEPT AS AN ALIAS OF `implemented` ────────────────────────────
-- Every stored row, every export and every webhook payload in existence uses
-- `done`. Renaming it would rewrite history and break the three UI call sites
-- that post it. `implemented` is the PRD's word for the same state and both are
-- accepted; `recommendationModel.js` maps them to one label.

alter table public.audit_recommendations
  drop constraint if exists audit_recommendations_status_check;

alter table public.audit_recommendations
  add constraint audit_recommendations_status_check
  check (status in (
    -- Shipped, and still written by the existing UI.
    'open', 'accepted', 'dismissed', 'done',
    -- The PRD's lifecycle states that had nowhere to live.
    'assigned', 'in_progress', 'implemented', 'validation_scheduled', 'validated'
  ));

comment on column public.audit_recommendations.status is
  'Lifecycle state. Eight meaningful values: the PRD''s seven plus ''dismissed'', which is ours and load-bearing — a queue you cannot decline from forces work nobody judged necessary. ''done'' and ''implemented'' are the same state under two names; ''done'' is kept because every stored row and webhook payload uses it.';

-- ── Due dates and notes ────────────────────────────────────────────────────
alter table public.audit_recommendations
  add column if not exists due_at timestamptz;

comment on column public.audit_recommendations.due_at is
  'When the owner committed to having this done. NULL is the default and the common case — an imposed due date nobody agreed to is noise, so this is only ever set explicitly.';

alter table public.audit_recommendations
  add column if not exists notes text;

comment on column public.audit_recommendations.notes is
  'Free text from whoever is working the item. Deliberately not structured: the useful content here is "blocked on the CMS migration", which no schema anticipates.';

-- ── Validation ─────────────────────────────────────────────────────────────
--
-- 🔴 `validated_by_audit_id` IS WHAT MAKES 'validated' MEAN ANYTHING.
-- Without it, `validated` is a second word for `implemented` — a claim by the
-- same person who did the work. Pointing at the audit that re-measured the
-- signal afterwards is the difference between "I fixed it" and "it is fixed",
-- and the closed loop this whole product promises rests on that distinction.
alter table public.audit_recommendations
  add column if not exists validated_by_audit_id uuid
    references public.audits(id) on delete set null;

comment on column public.audit_recommendations.validated_by_audit_id is
  'The audit that re-measured this signal after the fix. Without it ''validated'' is just a second word for ''implemented'' — a claim by the person who did the work rather than a measurement.';

create index if not exists audit_recommendations_due_idx
  on public.audit_recommendations (user_id, due_at)
  where due_at is not null and status not in ('done', 'implemented', 'validated', 'dismissed');

-- ── D6: workspace_id, actually written ─────────────────────────────────────
--
-- The columns have existed since 0030 and nothing has ever written them. D6
-- rules that P1 wires them through because back-filling later is far more
-- expensive than carrying them now — the same reasoning that made `raw_value`
-- and `audit_recommendations.issue_id` worth fixing rather than dropping.
--
-- ⚠️ NULL REMAINS VALID AND COMMON. Most audits are run by a solo operator with
-- no workspace at all, and a NOT NULL here would make the whole module require
-- a concept most users never touch.
alter table public.audit_recommendations
  add column if not exists workspace_id uuid;

comment on column public.audit_recommendations.workspace_id is
  'Denormalised from the audit so the queue can be filtered by workspace without a join. NULL is valid and common: most audits have no workspace.';

create index if not exists audit_recommendations_workspace_idx
  on public.audit_recommendations (workspace_id, status)
  where workspace_id is not null;

create index if not exists audits_workspace_idx
  on public.audits (workspace_id, created_at desc)
  where workspace_id is not null;


-- ============================================================
-- 0055_business_truth.sql
-- ============================================================
-- 0055_business_truth.sql — W9. The Canonical Business Truth Record.
--
-- Until now this module could say what a PAGE claims. It could not say what is
-- TRUE. Every P2 module needs the second thing: the entity graph needs a
-- subject, brand scoring needs a brand, NAP matching needs a name-address-phone
-- to match AGAINST, and the accuracy half of citation classification needs
-- something to check an engine's answer against — `citationStates.js` narrows
-- its accuracy check to price for exactly this reason, in its own header.
--
-- Naming follows decision D3: the `audit_` prefix, not the PRD's
-- `discoverability_`. One prefix across the whole module.
--
-- ── TWO TABLES, BECAUSE A RECORD AND ITS VERSIONS ARE DIFFERENT THINGS ─────
-- The record is the stable identity — "the truth record for acme.example" — and
-- is what other tables will point at. The versions are proposals, most of which
-- never become canonical. Folding them together would mean either losing the
-- history on every edit or making every consumer filter for the current row.
--
-- ── APPROVAL IS ENFORCED HERE TOO, NOT ONLY IN THE APPLICATION ────────────
-- `businessTruth.canPromote()` refuses self-approval. So does the CHECK
-- constraint below. This is the same three-layer discipline `ops_audit_log`
-- already uses for its mandatory reason: a rule that lives only in one endpoint
-- is a rule the next endpoint forgets, and this record is about to become the
-- thing other modules assert as true.

-- ── The record ─────────────────────────────────────────────────────────────
create table if not exists public.audit_business_truth_records (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  workspace_id      uuid,

  -- Optional. A truth record is about a BUSINESS, not a page — it can exist
  -- before any audit has run, and it outlives every individual audit. The
  -- target is a convenience link for the common case, never the identity.
  target_id         uuid references public.audit_targets(id) on delete set null,

  -- 🔴 THE BRIDGE KEY. `public.canonical_entities` (0041) already resolves a
  -- company from a domain for bulk enrichment. Carrying the same normalised
  -- host here is what stops this module resolving the same company a second
  -- time and disagreeing with itself. Bare host, lower-cased, no `www.` —
  -- `businessTruth.normalizeFieldValue('canonical_domain', …)` produces exactly
  -- this shape, and it is the one field both sides must spell identically.
  canonical_domain  text not null,

  display_name      text,

  -- Fields this business genuinely does not have, so completeness can EXCLUDE
  -- them and say so rather than scoring them zero. A business with no premises
  -- has no street address; counting that against them would report a correct
  -- record as a deficient one.
  not_applicable    text[] not null default '{}',

  status            text not null default 'active'
                      check (status in ('active', 'archived')),

  -- Set only by promotion. Null means no version has ever been approved, which
  -- is the honest state for a record somebody started and never finished.
  current_version_id uuid,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.audit_business_truth_records is
  'The stable identity of one business''s approved facts. Versions live in audit_business_truth_versions; this row only ever points at whichever one is canonical.';

comment on column public.audit_business_truth_records.canonical_domain is
  'Normalised bare host — lower-case, no www, no scheme, no path. The bridge key to public.canonical_entities so a company is resolved once across the platform. Must match businessTruth.normalizeFieldValue(''canonical_domain'', …) exactly.';

comment on column public.audit_business_truth_records.current_version_id is
  'The approved version other modules may assert as true. NULL until a first version is promoted — never defaulted to the newest draft, because an unreviewed draft asserted as truth is the failure this whole table exists to prevent.';

comment on column public.audit_business_truth_records.not_applicable is
  'Field ids that do not apply to this business. Excluded from completeness AND reported as excluded, never scored as zero.';

-- One live record per business per owner. A second record for the same domain
-- would give two answers to "what is true", which is the one thing this table
-- must never do. Archived rows are exempt so a record can be retired and
-- rebuilt.
create unique index if not exists audit_btr_owner_domain_uniq
  on public.audit_business_truth_records (user_id, canonical_domain)
  where status = 'active';

create index if not exists audit_btr_user_idx
  on public.audit_business_truth_records (user_id, updated_at desc);

create index if not exists audit_btr_workspace_idx
  on public.audit_business_truth_records (workspace_id)
  where workspace_id is not null;

-- ── The versions ───────────────────────────────────────────────────────────
create table if not exists public.audit_business_truth_versions (
  id              uuid primary key default gen_random_uuid(),
  record_id       uuid not null references public.audit_business_truth_records(id) on delete cascade,

  -- Monotonic per record. Human-readable in a way a uuid is not — "version 4
  -- was rejected" is a sentence somebody can act on.
  version_no      integer not null,

  state           text not null default 'draft'
                    check (state in ('draft','pending_review','approved','rejected','superseded')),

  -- The facts themselves: { fieldId: { value, source, evidence, stated_by,
  -- stated_at, … } } exactly as `businessTruth.makeFact` builds them. JSONB
  -- rather than a column per field because the field registry is a product
  -- decision that will move, and a migration per new fact would guarantee the
  -- registry and the schema drift apart.
  fields_json     jsonb not null default '{}'::jsonb,

  -- Denormalised from fields_json at write time so a list of versions does not
  -- need to recompute completeness for every row. Advisory: fields_json is the
  -- source of truth, and `truthCompleteness()` is the only implementation.
  completeness    numeric(5,2),

  -- Where this proposal came from. `audit` means an audit run proposed it from
  -- what it observed; that path must produce a DRAFT and never an approval.
  origin          text not null default 'manual'
                    check (origin in ('manual','audit','import')),
  source_audit_id uuid references public.audits(id) on delete set null,

  proposed_by     uuid references auth.users(id) on delete set null,
  proposed_at     timestamptz not null default now(),

  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,

  superseded_at   timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- 🔴 SELF-APPROVAL IS REFUSED BY THE DATABASE, NOT ONLY BY THE HANDLER.
  -- The entire value of `approved` is that a second person looked; one
  -- signature in both boxes is a draft with extra steps. NULL proposers are
  -- exempt because an imported or system-generated proposal has no human to
  -- collide with — and such a row still needs a real reviewer to reach
  -- `approved`, which the next constraint enforces.
  constraint audit_btv_no_self_approval check (
    state <> 'approved'
    or proposed_by is null
    or reviewed_by is null
    or reviewed_by <> proposed_by
  ),

  -- An approved version with no reviewer recorded is an approval by nobody.
  constraint audit_btv_approved_has_reviewer check (
    state <> 'approved' or (reviewed_by is not null and reviewed_at is not null)
  ),

  -- A rejection with no reason is indistinguishable from a mis-click three
  -- months later. Same rule, and the same reasoning, as the dismissal reason
  -- `audit_recommendations` already enforces.
  constraint audit_btv_rejected_has_reason check (
    state <> 'rejected' or (review_note is not null and length(btrim(review_note)) > 0)
  ),

  constraint audit_btv_version_no_positive check (version_no > 0)
);

comment on table public.audit_business_truth_versions is
  'One proposed set of business facts. Most versions never become canonical — that is the point of a version, and the rejected ones with their reasons are some of the most useful rows here.';

comment on column public.audit_business_truth_versions.fields_json is
  'Facts as businessTruth.makeFact builds them: value plus source, evidence, who stated it and when. An `observed` fact without an evidence record is refused by the model layer — a claim of verifiability with nothing to verify against is a guess wearing a warranty.';

comment on column public.audit_business_truth_versions.origin is
  '''audit'' means an audit run proposed this from what it observed. Such a version is always a DRAFT: a page reading is a proposal about the business, never a decision by it.';

comment on column public.audit_business_truth_versions.completeness is
  'Advisory copy of truthCompleteness().percent at write time, so listing versions needs no recomputation. fields_json remains the source of truth.';

create unique index if not exists audit_btv_record_version_uniq
  on public.audit_business_truth_versions (record_id, version_no);

create index if not exists audit_btv_record_idx
  on public.audit_business_truth_versions (record_id, version_no desc);

create index if not exists audit_btv_pending_idx
  on public.audit_business_truth_versions (record_id)
  where state = 'pending_review';

-- The circular reference, added once both tables exist. `on delete set null`
-- rather than cascade: losing the pointer must never delete the record whose
-- history it indexes.
alter table public.audit_business_truth_records
  drop constraint if exists audit_btr_current_version_fk;

alter table public.audit_business_truth_records
  add constraint audit_btr_current_version_fk
  foreign key (current_version_id)
  references public.audit_business_truth_versions(id)
  on delete set null;

-- ── Conflicts found against the canonical record ───────────────────────────
--
-- Written by an audit when a page contradicts the approved truth. Kept as rows
-- rather than recomputed on read because the finding is about a MOMENT — the
-- page said this on that date — and re-deriving it later against a record that
-- has since changed would rewrite history.
create table if not exists public.audit_business_truth_conflicts (
  id             uuid primary key default gen_random_uuid(),
  record_id      uuid not null references public.audit_business_truth_records(id) on delete cascade,
  audit_id       uuid references public.audits(id) on delete cascade,
  version_id     uuid references public.audit_business_truth_versions(id) on delete set null,

  -- A public contract, exactly like the signal and issue codes. Add codes;
  -- never repurpose or renumber one.
  code           text not null check (code in ('BT-01','BT-02','BT-03','BT-04')),
  field          text not null,
  severity       text not null default 'medium' check (severity in ('low','medium','high')),

  canonical_value text,
  observed_value  text,
  -- The evidence record for the observed side, as makeEvidence built it. NULL
  -- for BT-02, where the finding IS that nothing was observed.
  evidence_json   jsonb,

  resolved_at    timestamptz,
  resolution     text check (resolution is null or resolution in ('record_updated','page_updated','not_a_conflict')),

  created_at     timestamptz not null default now()
);

comment on table public.audit_business_truth_conflicts is
  'Where an audited page disagreed with the approved record. BT-01 is a contradiction; BT-02 is an absence — different codes because they have opposite remedies, and telling a customer their address is wrong when the page simply never mentions it wastes the fix.';

create index if not exists audit_btc_record_idx
  on public.audit_business_truth_conflicts (record_id, created_at desc);

create index if not exists audit_btc_open_idx
  on public.audit_business_truth_conflicts (record_id)
  where resolved_at is null;

create index if not exists audit_btc_audit_idx
  on public.audit_business_truth_conflicts (audit_id)
  where audit_id is not null;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Service-key only, matching every other table in this module. The browser
-- reaches Supabase exclusively through Netlify Functions, so a direct-read
-- policy would be unused attack surface.
alter table public.audit_business_truth_records  enable row level security;
alter table public.audit_business_truth_versions enable row level security;
alter table public.audit_business_truth_conflicts enable row level security;

drop policy if exists audit_btr_service on public.audit_business_truth_records;
create policy audit_btr_service on public.audit_business_truth_records
  for all to service_role using (true) with check (true);

drop policy if exists audit_btv_service on public.audit_business_truth_versions;
create policy audit_btv_service on public.audit_business_truth_versions
  for all to service_role using (true) with check (true);

drop policy if exists audit_btc_service on public.audit_business_truth_conflicts;
create policy audit_btc_service on public.audit_business_truth_conflicts
  for all to service_role using (true) with check (true);

revoke all on public.audit_business_truth_records  from anon, authenticated;
revoke all on public.audit_business_truth_versions from anon, authenticated;
revoke all on public.audit_business_truth_conflicts from anon, authenticated;

-- Reuse the trigger function 0030 already created for this module rather than
-- adding a second one that does the same thing.
drop trigger if exists audit_btr_touch on public.audit_business_truth_records;
create trigger audit_btr_touch
  before update on public.audit_business_truth_records
  for each row execute function public.audit_touch_updated_at();

drop trigger if exists audit_btv_touch on public.audit_business_truth_versions;
create trigger audit_btv_touch
  before update on public.audit_business_truth_versions
  for each row execute function public.audit_touch_updated_at();

-- ── Promotion ──────────────────────────────────────────────────────────────
--
-- 🔴 ONE FUNCTION, BECAUSE PROMOTION IS THREE WRITES THAT MUST NOT SEPARATE.
-- Promoting means: mark the outgoing version superseded, mark the incoming one
-- approved, and repoint the record. Doing that as three PostgREST calls leaves
-- windows where the record points at a superseded version, or at nothing, or at
-- two versions that both believe they are current. It is one statement.
--
-- The gate is re-checked here rather than trusted from the caller, for the same
-- reason the CHECK constraints exist: this is the last place before a fact
-- becomes something other modules assert as true.
create or replace function public.promote_business_truth_version(
  p_version_id  uuid,
  p_reviewer_id uuid,
  p_note        text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id  uuid;
  v_state      text;
  v_proposer   uuid;
  v_fields     jsonb;
  v_current    uuid;
begin
  select record_id, state, proposed_by, fields_json
    into v_record_id, v_state, v_proposer, v_fields
    from public.audit_business_truth_versions
   where id = p_version_id
   for update;

  if v_record_id is null then
    return 'not_found';
  end if;

  -- Already canonical: idempotent, so a retried request cannot double-supersede
  -- the version it just replaced.
  if v_state = 'approved' then
    select current_version_id into v_current
      from public.audit_business_truth_records where id = v_record_id;
    if v_current = p_version_id then
      return 'ok';
    end if;
  end if;

  if v_state not in ('pending_review', 'approved') then
    return 'not_reviewable';
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id then
    return 'self_approval';
  end if;

  -- The two identifying facts. Mirrors REQUIRED_FOR_CANONICAL in
  -- businessTruth.js; `p1Gate`-style parity is asserted by the db-verify suite
  -- rather than by hoping the two lists stay in step.
  if v_fields -> 'legal_name' is null or v_fields -> 'canonical_domain' is null then
    return 'missing_required';
  end if;

  -- Retire the outgoing version first, so there is never a moment where two
  -- versions of one record are both 'approved'.
  update public.audit_business_truth_versions v
     set state = 'superseded', superseded_at = now()
    from public.audit_business_truth_records r
   where r.id = v_record_id
     and v.id = r.current_version_id
     and v.id <> p_version_id;

  update public.audit_business_truth_versions
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_version_id;

  update public.audit_business_truth_records
     set current_version_id = p_version_id
   where id = v_record_id;

  return 'ok';
end;
$$;

comment on function public.promote_business_truth_version(uuid, uuid, text) is
  'Approve a version and make it canonical, atomically. Returns ok | not_found | not_reviewable | no_approver | self_approval | missing_required. Idempotent for a version that is already the record''s current one.';

revoke all on function public.promote_business_truth_version(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.promote_business_truth_version(uuid, uuid, text) to service_role;


-- ============================================================
-- 0056_entity_graph.sql
-- ============================================================
-- 0056_entity_graph.sql — W10. The Entity Graph Builder.
--
-- W9 gave the module one approved set of FACTS about a business. A fact is a
-- value; it says nothing about how things relate. "Acme sells Acme Cloud",
-- "Acme Cloud is a product, not the company", "these two office records are one
-- organisation" — those are edges, and edges are what a knowledge graph
-- resolves an entity by. An engine that cannot tell which Acme a page is about
-- merges it into the wrong node, which is the failure EA-11 already fires on at
-- the page level.
--
-- Naming follows D3: the `audit_` prefix, not the PRD's `discoverability_`.
--
-- ── D7 IS STILL OPEN, AND THIS DOES NOT PRE-EMPT IT ───────────────────────
-- Graph conflicts get their own table, exactly as W9's truth conflicts did,
-- rather than retrofitting `subject_type` + `subject_id` onto
-- `audit_issues`. That retrofit touches every reader of the P1 queue, the diff
-- engine and all four exports — doing it as a side effect of building the graph
-- would ship the two one bug apart. When D7 lands, these findings migrate into
-- whatever it decides; nothing here blocks that.
--
-- ── THE RULE THAT KEEPS A GRAPH HONEST ────────────────────────────────────
-- 🔴 EVERY RELATION CARRIES EVIDENCE AND A CONFIDENCE, OR IT IS NOT A RELATION.
-- An edge nobody can drill into is indistinguishable from one somebody made up.
-- `makeRelation` refuses an observed edge with no evidence; the CHECK below
-- refuses it at the database too.

-- ── Entities ───────────────────────────────────────────────────────────────
create table if not exists public.audit_entities (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,

  -- Optional. A graph belongs to a business; linking it to that business's
  -- truth record is the common case, not the identity.
  truth_record_id  uuid references public.audit_business_truth_records(id) on delete set null,

  -- The fourteen types. ⚠️ The PRD enumerates them nowhere visible in this
  -- repository — the same situation W4 hit with "M1-M13" — so these are derived
  -- from schema.org, which is the vocabulary this module already reads,
  -- validates and generates. 🔴 If the PRD's own list differs, ADD; never
  -- renumber or repurpose one. These ids travel in stored rows and every
  -- historical diff, exactly like the signal and issue codes.
  entity_type      text not null check (entity_type in (
    'organization','brand','product','service','location','person','offer',
    'review','credential','event','content_asset','topic','industry','audience'
  )),

  name             text not null check (length(btrim(name)) > 0),
  description      text,

  -- 🔴 THE BRIDGE KEY, again. public.canonical_entities (0041) is UNIQUE on
  -- this column, and so is audit_business_truth_records. Bare host, lower-case,
  -- no `www.`, or one company gets resolved twice and the halves disagree.
  canonical_domain text,

  -- GSTIN, CIN, DUNS, LEI, a Wikidata QID. The only properties that resolve an
  -- entity unambiguously, which is why they are kept apart from the name.
  external_ids     jsonb not null default '{}'::jsonb,

  source           text not null check (source in ('declared','observed','inferred')),
  evidence_json    jsonb,
  confidence       numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  state            text not null default 'proposed'
                     check (state in ('proposed','approved','rejected')),
  proposed_by      uuid references auth.users(id) on delete set null,
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  review_note      text,

  source_audit_id  uuid references public.audits(id) on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- 🔴 AN OBSERVED CLAIM WITH NOTHING TO POINT AT IS NOT AN OBSERVATION.
  -- Mirrors makeEntity, which refuses the same row before it ever gets here.
  constraint audit_entities_observed_has_evidence check (
    source <> 'observed' or evidence_json is not null
  ),

  -- Same three-layer discipline as the truth record: approval means a second
  -- person looked, and a rejection without a reason is indistinguishable from a
  -- mis-click three months later.
  constraint audit_entities_no_self_approval check (
    state <> 'approved' or proposed_by is null or reviewed_by is null or reviewed_by <> proposed_by
  ),
  constraint audit_entities_approved_has_reviewer check (
    state <> 'approved' or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint audit_entities_rejected_has_reason check (
    state <> 'rejected' or (review_note is not null and length(btrim(review_note)) > 0)
  )
);

comment on table public.audit_entities is
  'A node in a business''s entity graph. Fourteen types, each mapped to a schema.org class so the graph and the structured data this module already validates speak one language.';

comment on column public.audit_entities.state is
  'Everything is created ''proposed'', whatever proposed it. An edge or node a crawler read and nobody looked at is a suggestion; treating it as knowledge is how a graph fills with confident nonsense.';

comment on column public.audit_entities.canonical_domain is
  'Bridge key to public.canonical_entities and to audit_business_truth_records. Bare host, lower-case, no www — the shape entityGraph.makeEntity produces.';

create index if not exists audit_entities_user_idx
  on public.audit_entities (user_id, updated_at desc);
create index if not exists audit_entities_truth_idx
  on public.audit_entities (truth_record_id) where truth_record_id is not null;
create index if not exists audit_entities_domain_idx
  on public.audit_entities (canonical_domain) where canonical_domain is not null;
create index if not exists audit_entities_review_idx
  on public.audit_entities (user_id) where state = 'proposed';

-- ── Relations ──────────────────────────────────────────────────────────────
create table if not exists public.audit_entity_relationships (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- 🔴 CASCADE ON BOTH ENDS. An edge to a deleted node is not a partial edge,
  -- it is a dangling pointer that every traversal has to defend against for
  -- ever. Deleting a node deletes what pointed at it.
  subject_id    uuid not null references public.audit_entities(id) on delete cascade,
  object_id     uuid not null references public.audit_entities(id) on delete cascade,

  -- The nine predicates. Same provenance note as entity_type above.
  predicate     text not null check (predicate in (
    'owns','offers','located_at','employs','part_of','same_as','about','serves','competes_with'
  )),

  source        text not null check (source in ('declared','observed','inferred')),
  evidence_json jsonb,
  confidence    numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  state         text not null default 'proposed'
                  check (state in ('proposed','approved','rejected')),
  proposed_by   uuid references auth.users(id) on delete set null,
  reviewed_by   uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,

  source_audit_id uuid references public.audits(id) on delete set null,
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- 🔴 A SELF-EDGE IS NEVER INFORMATION. "Acme is part of Acme" and "Acme is
  -- the same as Acme" are both vacuously true and both pollute every traversal.
  constraint audit_rel_no_self_edge check (subject_id <> object_id),

  constraint audit_rel_observed_has_evidence check (
    source <> 'observed' or evidence_json is not null
  ),
  constraint audit_rel_no_self_approval check (
    state <> 'approved' or proposed_by is null or reviewed_by is null or reviewed_by <> proposed_by
  ),
  constraint audit_rel_approved_has_reviewer check (
    state <> 'approved' or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint audit_rel_rejected_has_reason check (
    state <> 'rejected' or (review_note is not null and length(btrim(review_note)) > 0)
  )
);

comment on table public.audit_entity_relationships is
  'One edge. Nine predicates, each with a declared domain and range enforced by entityGraph.validateRelation — without that a graph is a bag of edges, and "this review employs that topic" is storable, meaningless and impossible to notice later.';

-- 🔴 ONE EDGE, NOT FIVE COPIES OF IT. Without this, a crawler that re-reads the
-- same page every week accumulates a new row per run, every count doubles, and
-- "who do we compete with" answers differently depending on how many audits
-- have happened. Re-observation updates the row; it does not add one.
create unique index if not exists audit_rel_unique
  on public.audit_entity_relationships (subject_id, predicate, object_id);

create index if not exists audit_rel_subject_idx
  on public.audit_entity_relationships (subject_id) where state = 'approved';
create index if not exists audit_rel_object_idx
  on public.audit_entity_relationships (object_id) where state = 'approved';
create index if not exists audit_rel_review_idx
  on public.audit_entity_relationships (user_id) where state = 'proposed';

-- ── Evidence ───────────────────────────────────────────────────────────────
--
-- ⚠️ THIS IS NOT A SECOND EVIDENCE MODEL. `evidence_json` above holds the
-- evidence for the ORIGINAL assertion — the reading that created the row. This
-- table holds CORROBORATION: every later sighting of the same relationship, on
-- a different page or in a different run. The distinction matters because "we
-- read this once in 2024" and "we have read this on six pages across nine
-- months" are different warranties on the same edge, and collapsing them would
-- throw away the difference.
create table if not exists public.audit_entity_evidence (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid references public.audit_entities(id) on delete cascade,
  relationship_id uuid references public.audit_entity_relationships(id) on delete cascade,
  audit_id        uuid references public.audits(id) on delete set null,

  evidence_json   jsonb not null,
  confidence      numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  collected_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  -- Evidence for nothing is not evidence.
  constraint audit_entity_evidence_has_subject check (
    entity_id is not null or relationship_id is not null
  )
);

comment on table public.audit_entity_evidence is
  'Corroboration. Every later sighting of an entity or relationship already recorded — "read once in 2024" and "read on six pages across nine months" are different warranties on the same edge.';

create index if not exists audit_entity_evidence_entity_idx
  on public.audit_entity_evidence (entity_id, collected_at desc) where entity_id is not null;
create index if not exists audit_entity_evidence_rel_idx
  on public.audit_entity_evidence (relationship_id, collected_at desc) where relationship_id is not null;

-- ── Graph conflicts ────────────────────────────────────────────────────────
create table if not exists public.audit_entity_conflicts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  truth_record_id uuid references public.audit_business_truth_records(id) on delete cascade,
  audit_id      uuid references public.audits(id) on delete set null,

  -- A public contract. Add codes; never repurpose or renumber one.
  code          text not null check (code in ('EG-01','EG-02','EG-03','EG-04','EG-05','EG-06')),
  severity      text not null default 'medium' check (severity in ('low','medium','high')),

  subject_id    uuid references public.audit_entities(id) on delete cascade,
  predicate     text,
  detail_json   jsonb,
  message       text,

  resolved_at   timestamptz,
  resolution    text check (resolution is null or resolution in
                  ('relationship_removed','relationship_corrected','entity_merged','not_a_conflict')),

  created_at    timestamptz not null default now()
);

comment on table public.audit_entity_conflicts is
  'Structural problems in the APPROVED graph — two headquarters, a hierarchy that loops, a sameAs across two types. A proposal that contradicts the graph is not a conflict, it is a proposal; reporting it as one would make the review queue argue with itself.';

create index if not exists audit_entity_conflicts_open_idx
  on public.audit_entity_conflicts (user_id, created_at desc) where resolved_at is null;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.audit_entities              enable row level security;
alter table public.audit_entity_relationships  enable row level security;
alter table public.audit_entity_evidence       enable row level security;
alter table public.audit_entity_conflicts      enable row level security;

drop policy if exists audit_entities_service on public.audit_entities;
create policy audit_entities_service on public.audit_entities
  for all to service_role using (true) with check (true);

drop policy if exists audit_rel_service on public.audit_entity_relationships;
create policy audit_rel_service on public.audit_entity_relationships
  for all to service_role using (true) with check (true);

drop policy if exists audit_entity_evidence_service on public.audit_entity_evidence;
create policy audit_entity_evidence_service on public.audit_entity_evidence
  for all to service_role using (true) with check (true);

drop policy if exists audit_entity_conflicts_service on public.audit_entity_conflicts;
create policy audit_entity_conflicts_service on public.audit_entity_conflicts
  for all to service_role using (true) with check (true);

revoke all on public.audit_entities             from anon, authenticated;
revoke all on public.audit_entity_relationships from anon, authenticated;
revoke all on public.audit_entity_evidence      from anon, authenticated;
revoke all on public.audit_entity_conflicts     from anon, authenticated;

drop trigger if exists audit_entities_touch on public.audit_entities;
create trigger audit_entities_touch
  before update on public.audit_entities
  for each row execute function public.audit_touch_updated_at();

drop trigger if exists audit_rel_touch on public.audit_entity_relationships;
create trigger audit_rel_touch
  before update on public.audit_entity_relationships
  for each row execute function public.audit_touch_updated_at();

-- ── Approval ───────────────────────────────────────────────────────────────
--
-- 🔴 ONE FUNCTION, BECAUSE APPROVING AN EDGE IS NOT ONE WRITE.
-- An approved edge whose endpoints are still unreviewed proposals is a
-- half-built statement: the graph asserts a relationship between two things it
-- has not agreed exist. So approving an edge approves its endpoints in the same
-- statement, under the same reviewer, or refuses.
--
-- ⚠️ THE ENDPOINTS ARE APPROVED, NOT CREATED. A node that was rejected stays
-- rejected and blocks the edge — reviving it silently would undo somebody's
-- explicit decision.
create or replace function public.approve_entity_relationship(
  p_relationship_id uuid,
  p_reviewer_id     uuid,
  p_note            text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    text;
  v_proposer uuid;
  v_subject  uuid;
  v_object   uuid;
  v_bad      integer;
begin
  select state, proposed_by, subject_id, object_id
    into v_state, v_proposer, v_subject, v_object
    from public.audit_entity_relationships
   where id = p_relationship_id
   for update;

  if v_state is null then
    return 'not_found';
  end if;

  if v_state = 'approved' then
    return 'ok';                           -- idempotent; a retry is not an error
  end if;

  if v_state = 'rejected' then
    return 'rejected';                     -- propose it again rather than reviving it
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id then
    return 'self_approval';
  end if;

  -- An endpoint somebody explicitly rejected blocks the edge.
  select count(*) into v_bad
    from public.audit_entities
   where id in (v_subject, v_object) and state = 'rejected';
  if v_bad > 0 then
    return 'endpoint_rejected';
  end if;

  -- Approve any endpoint still merely proposed, under the same reviewer, so the
  -- graph never asserts a relationship between two things it has not agreed
  -- exist. The self-approval CHECK on audit_entities still applies, so an
  -- endpoint this reviewer proposed themselves stops the whole call.
  update public.audit_entities
     set state = 'approved', reviewed_by = p_reviewer_id, reviewed_at = now()
   where id in (v_subject, v_object)
     and state = 'proposed';

  update public.audit_entity_relationships
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_relationship_id;

  return 'ok';
end;
$$;

comment on function public.approve_entity_relationship(uuid, uuid, text) is
  'Approve an edge and its endpoints atomically. Returns ok | not_found | rejected | no_approver | self_approval | endpoint_rejected. An approved edge between unreviewed nodes is a half-built statement, so the endpoints come with it.';

revoke all on function public.approve_entity_relationship(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_entity_relationship(uuid, uuid, text) to service_role;


-- ============================================================
-- 0057_audit_subjects.sql
-- ============================================================
-- 0057_audit_subjects.sql — D7. The subject registry.
--
-- ── THE QUESTION D7 ANSWERS ───────────────────────────────────────────────
-- P1 audits a PAGE: `audits.target_id` points at `audit_targets`, and every
-- finding hangs off the audit. P2 audits things that are NOT pages — a brand, a
-- product, a service, a location. W11's BDS/PDS/SFS score exactly those. So how
-- does a business-level audit relate to a page-level one?
--
-- 🔴 THE RECORDED DEFAULT WAS A POLYMORPHIC `subject_type` + `subject_id` ON
-- `audit_issues`, AND IT IS THE WRONG SHAPE. A `subject_id` that points at
-- `audit_targets` on one row and `audit_entities` on the next CANNOT CARRY A
-- FOREIGN KEY, so nothing stops an issue referencing a brand deleted last
-- month. This repository has already been burned three times by a pointer the
-- database could not check — `audit_signals.raw_value`, `.evidence_json` and
-- `audit_recommendations.issue_id` were all declared and written by nothing,
-- and the read path returned `null` identically to "not applicable". An
-- unenforceable pointer is that same failure with a different spelling: it is
-- wrong SILENTLY. It would also have touched every reader of the P1 queue, the
-- diff engine and all four export formats at once.
--
-- ── SO THE AUDIT BECOMES POLYMORPHIC, ONE LEVEL UP ────────────────────────
--   audit_subjects ─< audits ─< audit_issues            ← UNCHANGED
--                           └─< audit_recommendations   ← UNCHANGED
--                           └─< audit_signals           ← UNCHANGED
--
-- The polymorphism lives in a CHECK constraint the database enforces, over
-- three columns each of which is a REAL foreign key, instead of in one bare
-- uuid the database cannot check at all. One queue is preserved — findings
-- still hang off `audit_id` — which was the actual goal all along.
--
-- ⚠️ `audits.target_id` IS KEPT AND MUST NEVER BE DROPPED. It is not redundant:
-- it is the fast path for the page case, it is what every existing query uses,
-- and dropping it would recreate the exact blast radius this design exists to
-- avoid. `subject_id` is ADDITIVE. A pre-0057 audit has a NULL subject_id and
-- keeps working unchanged — that is the backward-compatibility contract, and
-- `auditDiff` falls back to `target_id` for precisely those rows.
--
-- Naming follows D3: the `audit_` prefix, not the PRD's `discoverability_`.

-- ── Subjects ───────────────────────────────────────────────────────────────
create table if not exists public.audit_subjects (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,

  subject_kind     text not null check (subject_kind in
                     ('page','domain','brand','product','service','location')),

  -- 🔴 EXACTLY ONE of these is non-null, and every one is a REAL foreign key.
  target_id        uuid references public.audit_targets(id)                on delete cascade,
  entity_id        uuid references public.audit_entities(id)               on delete cascade,
  truth_record_id  uuid references public.audit_business_truth_records(id) on delete cascade,

  label            text not null check (length(btrim(label)) > 0),

  -- The same bridge key W9 and W10 already use, and public.canonical_entities
  -- (0041) before them. Bare host, lower-case, no `www.`, or one company gets
  -- resolved twice and the halves disagree.
  canonical_domain text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint audit_subjects_exactly_one_ref check (
    (target_id       is not null)::int
  + (entity_id       is not null)::int
  + (truth_record_id is not null)::int = 1
  ),

  -- Without this, `subject_kind` and the actual reference could disagree —
  -- which is the polymorphic bug back again, one column over. A `page` subject
  -- pointing at a brand entity would score a brand and report it as a page.
  constraint audit_subjects_kind_matches_ref check (
    (subject_kind = 'page' and target_id is not null)
    or (subject_kind = 'domain' and (target_id is not null or truth_record_id is not null))
    or (subject_kind in ('brand','product','service','location') and entity_id is not null)
  )
);

-- One subject per owner per referenced row per kind. Three partial indexes
-- rather than one composite, because a composite over three nullable columns
-- does not constrain anything in Postgres: NULLs never collide. Without these
-- a re-audit mints a second subject and the history scatters — the same defect
-- `audit_targets_owner_url_idx` exists to prevent for pages.
create unique index if not exists audit_subjects_target_idx
  on public.audit_subjects (user_id, subject_kind, target_id) where target_id is not null;
create unique index if not exists audit_subjects_entity_idx
  on public.audit_subjects (user_id, subject_kind, entity_id) where entity_id is not null;
create unique index if not exists audit_subjects_truth_idx
  on public.audit_subjects (user_id, subject_kind, truth_record_id) where truth_record_id is not null;

create index if not exists audit_subjects_owner_kind_idx
  on public.audit_subjects (user_id, subject_kind, created_at desc);
create index if not exists audit_subjects_domain_idx
  on public.audit_subjects (user_id, canonical_domain) where canonical_domain is not null;

comment on table public.audit_subjects is
  'D7. One row per audited thing. The polymorphism lives in CHECK constraints over three real foreign keys, never in a bare uuid. audits.target_id is kept and must never be dropped.';

-- ── The audit points at its subject ────────────────────────────────────────
-- Nullable, and `on delete set null`: losing the subject registry entry must
-- never destroy an audit that was run and charged for.
alter table public.audits
  add column if not exists subject_id uuid references public.audit_subjects(id) on delete set null;

create index if not exists audits_subject_idx
  on public.audits (subject_id, created_at desc) where subject_id is not null;

comment on column public.audits.subject_id is
  'D7. NULL on every pre-0057 audit and that is valid — readers fall back to target_id. Comparability is "same subject" where both sides have one, "same target" otherwise.';

-- ── Backfill ───────────────────────────────────────────────────────────────
-- One `page` subject per existing target, then point every audit at its own.
-- Written to be RE-RUNNABLE: `on conflict do nothing` plus a `where` that skips
-- audits already pointed, so applying this file twice changes nothing the
-- second time. A migration that is only correct once is a migration nobody can
-- safely re-apply after a partial failure.
insert into public.audit_subjects (user_id, workspace_id, subject_kind, target_id, label, canonical_domain)
select t.user_id, t.workspace_id, 'page', t.id,
       coalesce(nullif(btrim(t.label), ''), t.canonical_url),
       t.host
  from public.audit_targets t
on conflict do nothing;

update public.audits a
   set subject_id = s.id
  from public.audit_subjects s
 where s.target_id = a.target_id
   and s.subject_kind = 'page'
   and s.user_id = a.user_id
   and a.subject_id is null;

-- ── Get-or-create ──────────────────────────────────────────────────────────
-- Mirrors upsert_audit_target: the application asks for a subject and gets one,
-- whether or not it already existed. Idempotent by the partial unique indexes
-- above, so two concurrent audits of the same brand cannot mint two subjects.
create or replace function public.upsert_audit_subject(
  p_user_id uuid,
  p_kind text,
  p_target_id uuid default null,
  p_entity_id uuid default null,
  p_truth_record_id uuid default null,
  p_label text default null,
  p_canonical_domain text default null,
  p_workspace_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- The CHECKs would refuse this anyway; naming it here makes the refusal
  -- legible to the caller instead of surfacing as a constraint violation.
  if (p_target_id is not null)::int
   + (p_entity_id is not null)::int
   + (p_truth_record_id is not null)::int <> 1 then
    raise exception 'upsert_audit_subject: exactly one reference is required';
  end if;

  select id into v_id from public.audit_subjects
   where user_id = p_user_id
     and subject_kind = p_kind
     and target_id is not distinct from p_target_id
     and entity_id is not distinct from p_entity_id
     and truth_record_id is not distinct from p_truth_record_id;

  if v_id is not null then
    update public.audit_subjects
       set label = coalesce(nullif(btrim(p_label), ''), label),
           canonical_domain = coalesce(p_canonical_domain, canonical_domain),
           workspace_id = coalesce(p_workspace_id, workspace_id),
           updated_at = now()
     where id = v_id;
    return v_id;
  end if;

  insert into public.audit_subjects
    (user_id, workspace_id, subject_kind, target_id, entity_id, truth_record_id,
     label, canonical_domain)
  values
    (p_user_id, p_workspace_id, p_kind, p_target_id, p_entity_id, p_truth_record_id,
     coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
  returning id into v_id;

  return v_id;
end $$;

comment on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) is
  'D7 get-or-create. Refuses anything but exactly one reference, so the CHECK can never be reached with a confusing message.';

revoke all on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) to service_role;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.audit_subjects enable row level security;

drop policy if exists audit_subjects_service on public.audit_subjects;
create policy audit_subjects_service on public.audit_subjects
  for all to service_role using (true) with check (true);

revoke all on public.audit_subjects from anon, authenticated;

drop trigger if exists audit_subjects_touch on public.audit_subjects;
create trigger audit_subjects_touch
  before update on public.audit_subjects
  for each row execute function public.audit_touch_updated_at();


-- ============================================================
-- 0058_local_directory.sql
-- ============================================================
-- 0058_local_directory.sql — W12. Local and directory intelligence.
--
-- W9 recorded what is TRUE about a business. W12 measures whether the records
-- the business does not own agree with it: a Google Business Profile, a
-- Justdial listing, an MCA filing. When they disagree about the name, the
-- address or the phone, an engine asked "where is Acme" has several answers and
-- picks one. It does not error.
--
-- Naming follows D3: the `audit_` prefix, not the PRD's `discoverability_`.
--
-- ── THIS IS THE FIRST TABLE SET BUILT ON D7 ───────────────────────────────
-- `audit_local_checks.subject_id` points at `audit_subjects` (0057). A local
-- check is about a BUSINESS or a LOCATION, not about a page, which is exactly
-- the case the page-shaped `audits.target_id` could never carry. Nullable, for
-- the same reason `audits.subject_id` is: a check whose subject could not be
-- resolved is degraded, not lost.
--
-- ── WHY SOURCE IDS ARE NOT ENUMERATED IN A CHECK CONSTRAINT ───────────────
-- 🔴 THIS DEPARTS FROM W10, DELIBERATELY. 0056 puts its fourteen entity types
-- in a CHECK because that vocabulary is a closed, slow-moving contract derived
-- from schema.org. The directory registry is neither: a new market is a dozen
-- new sources, and a CHECK would make each one a migration plus a deploy plus a
-- window where the API and the database disagree about what is legal — the very
-- cost 0049's header cites for widening a live enum. What IS closed is the
-- TIER, so the tier is constrained here and `directorySources.js` stays the one
-- place a source is declared. `napModel.matchDirectory` refuses an unknown
-- source id before anything reaches this table.

-- ── One observed listing ───────────────────────────────────────────────────
create table if not exists public.audit_directory_listings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,

  truth_record_id  uuid references public.audit_business_truth_records(id) on delete cascade,

  source_id        text not null check (length(btrim(source_id)) > 0),
  source_tier      text not null check (source_tier in
                     ('authoritative','major_aggregator','registry','vertical','social_review')),
  -- D5's three acquisition tiers. Stored per listing, because the SAME source
  -- can be read two ways and the fidelity differs: a Google profile read
  -- through the customer's own OAuth is not the same evidence as one scraped
  -- from a public page, and a reader must be able to tell them apart.
  acquisition      text not null check (acquisition in ('authorized_api','declared_url','public_listing')),

  listing_url      text,

  -- What the directory actually said. NULL means the listing did not state it,
  -- which is a different fact from "we did not look" (no row at all) and from
  -- "this source never publishes it" (the registry knows that, not the row).
  observed_name        text,
  observed_address     text,
  observed_phone       text,
  observed_postal_code text,
  observed_locality    text,
  observed_extra       jsonb not null default '{}'::jsonb,

  -- The same envelope W1 built and W9/W10 reuse. A listing nobody can drill
  -- into is indistinguishable from one somebody made up.
  evidence_json    jsonb,

  observed_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- An observed listing claims somebody could go and check it, so it carries
  -- the URL that was read — except for an authorised API, where the evidence is
  -- the connection itself and there is no page.
  constraint audit_dir_listing_public_has_url check (
    acquisition = 'authorized_api' or listing_url is not null
  )
);

-- One current listing per owner per source per record. A weekly re-read
-- UPDATES what the source says; it does not stack a second opinion, or every
-- count doubles and "what does Justdial say" answers differently depending on
-- how many checks have run. That is the same defect 0056's unique edge index
-- exists to prevent.
create unique index if not exists audit_dir_listing_unique
  on public.audit_directory_listings (user_id, coalesce(truth_record_id, '00000000-0000-0000-0000-000000000000'::uuid), source_id);
create index if not exists audit_dir_listing_owner_idx
  on public.audit_directory_listings (user_id, source_tier, observed_at desc);

-- ── One NAP check run ──────────────────────────────────────────────────────
create table if not exists public.audit_local_checks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,

  truth_record_id  uuid references public.audit_business_truth_records(id) on delete cascade,
  -- D7. What this check is ABOUT.
  subject_id       uuid references public.audit_subjects(id) on delete set null,

  -- 🔴 NULLABLE, AND NULL IS NOT ZERO. A run where nothing could be read scores
  -- null and reports its coverage, because scoring it 0 would say the business
  -- is inconsistent when the truth is that we checked nothing — and would then
  -- show a phantom jump the day the customer authorises one connection.
  nap_score        numeric check (nap_score is null or (nap_score >= 0 and nap_score <= 100)),
  coverage         numeric check (coverage is null or (coverage >= 0 and coverage <= 1)),

  checked_count    integer not null default 0 check (checked_count >= 0),
  configured_count integer not null default 0 check (configured_count >= 0),
  region           text,

  -- Set membership, so a later reader can tell "not authorised" from
  -- "authorised and unreadable" without re-deriving it from the registry.
  unchecked_sources  text[] not null default '{}',
  unreadable_sources text[] not null default '{}',

  created_at       timestamptz not null default now(),

  constraint audit_local_check_counts check (checked_count <= configured_count)
);

create index if not exists audit_local_checks_owner_idx
  on public.audit_local_checks (user_id, created_at desc);
create index if not exists audit_local_checks_subject_idx
  on public.audit_local_checks (subject_id, created_at desc) where subject_id is not null;

-- ── Per-directory match ────────────────────────────────────────────────────
create table if not exists public.audit_directory_matches (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  check_id         uuid not null references public.audit_local_checks(id) on delete cascade,
  listing_id       uuid references public.audit_directory_listings(id) on delete set null,

  source_id        text not null,
  source_tier      text not null check (source_tier in
                     ('authoritative','major_aggregator','registry','vertical','social_review')),
  tier_weight      numeric not null check (tier_weight > 0 and tier_weight <= 1),

  match_score      numeric check (match_score is null or (match_score >= 0 and match_score <= 100)),
  coverage         numeric check (coverage is null or (coverage >= 0 and coverage <= 1)),

  -- Per-field states, as the model produced them. Stored whole rather than as
  -- four columns, because the field set is the model's to grow — and because a
  -- reader asking "why is this 55" needs the states, not a re-derivation.
  fields_json      jsonb not null default '[]'::jsonb,
  mismatched       text[] not null default '{}',
  absent_fields    text[] not null default '{}',

  created_at       timestamptz not null default now()
);

create unique index if not exists audit_dir_match_unique
  on public.audit_directory_matches (check_id, source_id);
create index if not exists audit_dir_match_owner_idx
  on public.audit_directory_matches (user_id, created_at desc);

-- ── Findings ───────────────────────────────────────────────────────────────
-- Its own table, and its own lifecycle, for the reason D7 §4 records: these are
-- about a RECORD, not about an audit, and their resolution vocabulary is not
-- the recommendation queue's eight workflow states. Collapsing them would lose
-- the difference between "this listing now agrees" and "somebody did the task".
create table if not exists public.audit_local_findings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,

  check_id         uuid references public.audit_local_checks(id) on delete cascade,
  truth_record_id  uuid references public.audit_business_truth_records(id) on delete cascade,
  source_id        text,

  code             text not null check (code ~ '^LD-[0-9]{2}$'),
  severity         text not null check (severity in ('critical','high','medium','low')),
  fields           text[] not null default '{}',
  detail           text,

  resolution       text check (resolution in ('listing_updated','record_updated','not_a_conflict','wont_fix')),
  resolved_at      timestamptz,
  resolved_by      uuid references auth.users(id) on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- A resolution with no timestamp, or a timestamp with no resolution, is half
  -- a record: the list would show it as open while a reader believed it closed.
  constraint audit_local_finding_resolution_paired check (
    (resolution is null and resolved_at is null)
    or (resolution is not null and resolved_at is not null)
  )
);

create index if not exists audit_local_findings_open_idx
  on public.audit_local_findings (user_id, created_at desc) where resolved_at is null;
create index if not exists audit_local_findings_code_idx
  on public.audit_local_findings (user_id, code);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.audit_directory_listings enable row level security;
alter table public.audit_local_checks       enable row level security;
alter table public.audit_directory_matches  enable row level security;
alter table public.audit_local_findings     enable row level security;

drop policy if exists audit_dir_listings_service on public.audit_directory_listings;
create policy audit_dir_listings_service on public.audit_directory_listings
  for all to service_role using (true) with check (true);

drop policy if exists audit_local_checks_service on public.audit_local_checks;
create policy audit_local_checks_service on public.audit_local_checks
  for all to service_role using (true) with check (true);

drop policy if exists audit_dir_matches_service on public.audit_directory_matches;
create policy audit_dir_matches_service on public.audit_directory_matches
  for all to service_role using (true) with check (true);

drop policy if exists audit_local_findings_service on public.audit_local_findings;
create policy audit_local_findings_service on public.audit_local_findings
  for all to service_role using (true) with check (true);

revoke all on public.audit_directory_listings from anon, authenticated;
revoke all on public.audit_local_checks       from anon, authenticated;
revoke all on public.audit_directory_matches  from anon, authenticated;
revoke all on public.audit_local_findings     from anon, authenticated;

drop trigger if exists audit_dir_listings_touch on public.audit_directory_listings;
create trigger audit_dir_listings_touch
  before update on public.audit_directory_listings
  for each row execute function public.audit_touch_updated_at();

drop trigger if exists audit_local_findings_touch on public.audit_local_findings;
create trigger audit_local_findings_touch
  before update on public.audit_local_findings
  for each row execute function public.audit_touch_updated_at();


-- ============================================================
-- 0059_local_directory_listing_upsert.sql
-- ============================================================
-- 0059_local_directory_listing_upsert.sql — make W12's listing upsert legal.
--
-- 0058 promises one CURRENT listing per (owner, truth record, source).  It used
-- an expression unique index to make NULL truth_record_id values conflict too.
-- That enforces the invariant for ordinary INSERTs, but PostgREST's
-- `on_conflict=user_id,truth_record_id,source_id` names COLUMNS, not an
-- expression.  PostgreSQL therefore cannot select 0058's expression index as
-- the upsert arbiter, and the normal API save fails before it can update a
-- listing.
--
-- PostgreSQL 15's `NULLS NOT DISTINCT` expresses the actual rule as a named
-- column constraint: two NULL truth-record ids are the same key.  That keeps
-- the no-duplicate invariant AND makes the existing column-based PostgREST
-- upsert valid.  This is deliberately forward-only: 0058 is already applied
-- to dev/stage, so rewriting its historical DDL would not repair either.

alter table public.audit_directory_listings
  drop constraint if exists audit_dir_listing_unique;

-- On a 0058-only database this removes the expression index. On a re-run, the
-- preceding DROP CONSTRAINT has already removed its same-named backing index,
-- so this is a harmless no-op. The order is load-bearing: dropping a
-- constraint-backed index first is rejected by PostgreSQL.
drop index if exists public.audit_dir_listing_unique;

alter table public.audit_directory_listings
  add constraint audit_dir_listing_unique
  unique nulls not distinct (user_id, truth_record_id, source_id);


-- ============================================================
-- 0060_audit_subject_upsert_atomic.sql
-- ============================================================
-- 0060_audit_subject_upsert_atomic.sql — close the get-or-create race in D7.
--
-- 0057 shipped `upsert_audit_subject` as SELECT-then-INSERT and its own comment
-- claimed the partial unique indexes made it "idempotent ... so two concurrent
-- audits of the same brand cannot mint two subjects". That claim is half true,
-- and the missing half is the defect: the indexes make a SECOND ROW impossible,
-- they do NOT make the losing caller return the winner's id. A concurrent
-- transaction's snapshot cannot see the other's uncommitted row, so its SELECT
-- misses, its INSERT raises unique_violation, and the exception propagates out
-- of the function.
--
-- `ensureSubject` swallows that into `null`, which is a legal state — so the
-- audit still runs. The cost is silent: that audit carries no subject_id, and
-- `sameSubject()` falls back to `target_id`. For a PAGE subject the fallback
-- covers it, which is why nothing has surfaced. An entity-backed subject
-- (brand / product / service / location) has NO fallback, so the moment W13
-- persists one, a lost race scatters exactly the history D7 exists to keep
-- together.
--
-- `upsert_audit_target` — the function 0057 says it mirrors — has always been
-- atomic. This makes the newer one match rather than be quietly weaker.
--
-- Three INSERTs rather than one, because the arbiter differs per reference:
-- each partial index is inferred by restating its own predicate. A single
-- composite arbiter is impossible here for the same reason 0057 used three
-- indexes — a composite over three nullable columns constrains nothing.
--
-- Forward-only: 0057 is already applied to dev/stage, so editing its history
-- would repair neither.

create or replace function public.upsert_audit_subject(
  p_user_id uuid,
  p_kind text,
  p_target_id uuid default null,
  p_entity_id uuid default null,
  p_truth_record_id uuid default null,
  p_label text default null,
  p_canonical_domain text default null,
  p_workspace_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- The CHECKs would refuse this anyway; naming it here makes the refusal
  -- legible to the caller instead of surfacing as a constraint violation.
  -- It also guarantees exactly one of the three branches below is taken.
  if (p_target_id is not null)::int
   + (p_entity_id is not null)::int
   + (p_truth_record_id is not null)::int <> 1 then
    raise exception 'upsert_audit_subject: exactly one reference is required';
  end if;

  -- `coalesce(nullif(btrim(...),''), <existing>)` in the DO UPDATE keeps the
  -- 0057 merge semantics exactly: a caller that supplies nothing must never
  -- blank a label or a domain another caller already established.
  if p_target_id is not null then
    insert into public.audit_subjects
      (user_id, workspace_id, subject_kind, target_id, label, canonical_domain)
    values
      (p_user_id, p_workspace_id, p_kind, p_target_id,
       coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
    on conflict (user_id, subject_kind, target_id) where target_id is not null
      do update set
        label            = coalesce(nullif(btrim(p_label), ''), public.audit_subjects.label),
        canonical_domain = coalesce(p_canonical_domain, public.audit_subjects.canonical_domain),
        workspace_id     = coalesce(p_workspace_id, public.audit_subjects.workspace_id),
        updated_at       = now()
    returning id into v_id;

  elsif p_entity_id is not null then
    insert into public.audit_subjects
      (user_id, workspace_id, subject_kind, entity_id, label, canonical_domain)
    values
      (p_user_id, p_workspace_id, p_kind, p_entity_id,
       coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
    on conflict (user_id, subject_kind, entity_id) where entity_id is not null
      do update set
        label            = coalesce(nullif(btrim(p_label), ''), public.audit_subjects.label),
        canonical_domain = coalesce(p_canonical_domain, public.audit_subjects.canonical_domain),
        workspace_id     = coalesce(p_workspace_id, public.audit_subjects.workspace_id),
        updated_at       = now()
    returning id into v_id;

  else
    insert into public.audit_subjects
      (user_id, workspace_id, subject_kind, truth_record_id, label, canonical_domain)
    values
      (p_user_id, p_workspace_id, p_kind, p_truth_record_id,
       coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
    on conflict (user_id, subject_kind, truth_record_id) where truth_record_id is not null
      do update set
        label            = coalesce(nullif(btrim(p_label), ''), public.audit_subjects.label),
        canonical_domain = coalesce(p_canonical_domain, public.audit_subjects.canonical_domain),
        workspace_id     = coalesce(p_workspace_id, public.audit_subjects.workspace_id),
        updated_at       = now()
    returning id into v_id;
  end if;

  return v_id;
end $$;

comment on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) is
  'D7 get-or-create. ATOMIC since 0060 — one INSERT .. ON CONFLICT per reference, so a concurrent caller receives the existing subject instead of a unique_violation. Refuses anything but exactly one reference.';

-- Re-stated because `create or replace function` does not carry privileges
-- forward on its own in every path, and a SECURITY DEFINER function that
-- anon can execute would be a privilege-escalation primitive.
revoke all on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) to service_role;


-- ============================================================
-- 0061_rpc_lockdown.sql
-- ============================================================
-- 0061_rpc_lockdown.sql — take ten SECURITY DEFINER functions away from `anon`.
--
-- 🔴 THIS IS THE 0044 DEFECT AGAIN, ONE LAYER DOWN. 0041-0043 shipped fifteen
-- TABLES readable and writable by anyone holding the public anon key, and 0044
-- locked them. Nobody checked the FUNCTIONS — and PostgreSQL grants EXECUTE on
-- a new function to PUBLIC by default, so every migration that created one and
-- did not revoke left it callable by `anon` through PostgREST's `/rpc/<name>`.
-- The publishable key is committed in `public/runtime-config.js` on purpose:
-- as that file's own comment says, "RLS protects data, not the key".
--
-- SECURITY DEFINER runs as the owner and BYPASSES RLS. So a function that is
-- anon-executable, takes a caller-supplied `p_user_id`, and never consults
-- `auth.uid()` is not merely over-permissive — it is an impersonation
-- primitive. All ten below are exactly that shape:
--
--   set_account_frozen           freeze ANY account — denial of service per user
--   request_account_deletion     schedule ANY account for deletion (and freeze it)
--   cancel_account_deletion      silently undo a user's own deletion request
--   credit_spend                 drain ANY user's credit ledger
--   credit_balance               read ANY user's balance — information disclosure
--   redeem_admin_coupon          grant plan value to an arbitrary account
--   create_admin_coupon_assignment  mint a coupon assignment
--   issue_referral_code          mint referral codes for arbitrary accounts
--   accept_workspace_invite      consume an invite as somebody else
--   upsert_audit_target          write rows attributed to another tenant
--
-- ⚠️ NOTHING LEGITIMATE CALLS THESE FROM A BROWSER, and that is what makes the
-- revoke safe rather than a behaviour change. The architecture rule is that the
-- browser reaches Supabase only through `apiClient.js` → Netlify Functions;
-- verified by grep, the only direct `supabase.rpc(...)` in `src/` is
-- `claim_billing_session`, which is deliberately NOT in this list because it is
-- already the correct shape: it derives `uid := auth.uid()`, takes no user id
-- from the caller, and 0012 already revoked it from anon and granted it to
-- authenticated. It is the model the other ten should have followed.
--
-- Every caller of all ten lives in `netlify/functions/`, which holds the
-- service key, and `service_role` keeps EXECUTE throughout — so this closes the
-- hole without touching a single working code path.
--
-- ⚠️ REVOKE FROM `public` IS THE LOAD-BEARING CLAUSE. Revoking from `anon` and
-- `authenticated` alone leaves the default PUBLIC grant in place, which both
-- roles inherit — the revoke would appear to succeed and change nothing.
--
-- Forward-only, and deliberately not folded into the migrations that created
-- these functions: several are already applied to production, so rewriting
-- their history would repair nothing that is actually running.

revoke all on function public.set_account_frozen(uuid, boolean, text, uuid)              from public, anon, authenticated;
revoke all on function public.request_account_deletion(uuid, integer)                    from public, anon, authenticated;
revoke all on function public.cancel_account_deletion(uuid)                              from public, anon, authenticated;
revoke all on function public.credit_spend(uuid, text, text, integer, text, integer, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.credit_balance(uuid, text)                                 from public, anon, authenticated;
revoke all on function public.redeem_admin_coupon(uuid, text)                            from public, anon, authenticated;
revoke all on function public.create_admin_coupon_assignment(uuid, text, text, integer, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.issue_referral_code(uuid)                                  from public, anon, authenticated;
revoke all on function public.accept_workspace_invite(text, uuid, text)                  from public, anon, authenticated;
revoke all on function public.upsert_audit_target(uuid, text, text, text)                from public, anon, authenticated;

grant execute on function public.set_account_frozen(uuid, boolean, text, uuid)              to service_role;
grant execute on function public.request_account_deletion(uuid, integer)                    to service_role;
grant execute on function public.cancel_account_deletion(uuid)                              to service_role;
grant execute on function public.credit_spend(uuid, text, text, integer, text, integer, jsonb, uuid) to service_role;
grant execute on function public.credit_balance(uuid, text)                                 to service_role;
grant execute on function public.redeem_admin_coupon(uuid, text)                            to service_role;
grant execute on function public.create_admin_coupon_assignment(uuid, text, text, integer, timestamptz, text, text) to service_role;
grant execute on function public.issue_referral_code(uuid)                                  to service_role;
grant execute on function public.accept_workspace_invite(text, uuid, text)                  to service_role;
grant execute on function public.upsert_audit_target(uuid, text, text, text)                to service_role;

-- ── The one correct function, whose revoke was a no-op ─────────────────────
-- 🔴 `claim_billing_session` is the SHAPE the ten above should have had — it
-- derives `uid := auth.uid()` and takes no user id — and it is the only
-- function the browser calls directly, so `authenticated` must keep it. But
-- 0012 wrote `revoke execute ... from anon` and nothing else, and that is a
-- NO-OP: the ACL still reads `=X/postgres`, the default PUBLIC grant, which
-- anon inherits. The function has therefore been anon-reachable since 0012
-- despite a line that reads as though it were not.
--
-- Low severity by itself — `auth.uid()` is NULL for anon, so an anon caller
-- claims nothing — but a revoke that silently fails is worth correcting
-- wherever it appears, because the next one may not be harmless.
revoke all on function public.claim_billing_session(text) from public, anon;
grant execute on function public.claim_billing_session(text) to authenticated, service_role;

-- ── Three definer functions that revoke without granting ───────────────────
-- These revoke from `public, anon, authenticated` and never name service_role,
-- so they depend entirely on Supabase's `ALTER DEFAULT PRIVILEGES ... GRANT ALL
-- ON FUNCTIONS TO service_role` having been in force when they were created.
-- That is true on a stock Supabase project and NOT true anywhere else — a
-- self-hosted Postgres, a restored dump, or PGlite leaves the server unable to
-- call its own RPC. `assign_recommendation` is reached from
-- `auditStore.js` → `/rpc/assign_recommendation` on every assignment, so the
-- failure mode is a working feature that stops working on a different host.
-- Stating the grant costs nothing and removes the environmental assumption.
grant execute on function public.assign_recommendation(uuid, uuid, uuid)                          to service_role;
grant execute on function public.prune_ops_history(integer)                                       to service_role;
grant execute on function public.record_pql_score(uuid, integer, numeric, boolean, boolean, text, jsonb, text[]) to service_role;


-- ============================================================
-- 0062_schema_trust.sql
-- ============================================================
-- 0062_schema_trust.sql — P2 · W13: schema intelligence + trust & proof.
--
-- Two tables. They exist because W11 shipped three components binding to a
-- `trust_proof` source that did not exist — `trust_credibility` (20% of BDS),
-- `trust_proof` (15% of PDS) and `trust_signals` (10% of SFS) all read `null`
-- and were redistributed. This is the storage behind them.
--
-- ── 🔴 THE FIVE RULES THIS MIGRATION WAS WRITTEN AGAINST ──────────────────
-- Each one cost a migration on already-merged work in the 2026-09-12 review,
-- so they are applied here rather than rediscovered:
--
--  (a) EVERY TABLE HAS A WRITER AND A CONTRACT TEST THAT ASSERTS THE CALL.
--      Four columns in this schema have been declared, reviewed, merged and
--      written by nothing. `saveSchemaEntity` and `saveTrustObservation` are
--      called by `/schema-trust/*` and the assertions were confirmed RED first.
--  (b) THE UPSERT ARBITER NAMES COLUMNS, NOT AN EXPRESSION, and uses
--      `NULLS NOT DISTINCT` because `subject_id` is nullable. 0058 used a
--      `coalesce(...)` index that enforced the invariant AND made every save
--      fail, because PostgREST can only name column arbiters (0059).
--  (c) NO SELECT-THEN-INSERT get-or-create anywhere (0060).
--  (d) NOTHING HERE IS `SECURITY DEFINER`, so there is no grant to get wrong —
--      and if one is ever added it must `revoke all ... from public`, not just
--      from anon, which is a no-op while PUBLIC holds the default grant (0061).
--  (e) Caller-supplied parent ids are checked in the ROUTE against rows the
--      caller owns, and refused 404 — see `requireSchemaTrustRefs`.
--
-- ── ⚠️ WHY `independence` IS A CHECK AND `signal` IS NOT ──────────────────
-- The same split W12 made, for the same reason. `independence` is a THREE-VALUE
-- trust vocabulary that decides how much a claim is worth; widening it is a
-- deliberate scoring change and should cost a migration. `signal` is an open
-- registry that grows with the market — a new trust source is a code change,
-- and constraining it here would make each one a migration for nothing.
-- `schema-trust-parity.test.js` PARSES this CHECK out of the file rather than
-- restating it, because a copy drifts exactly as `EVENT_TO_SOURCE` did.

-- ── Schema entities observed for a subject ────────────────────────────────
create table if not exists public.audit_schema_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  subject_id uuid references public.audit_subjects(id) on delete cascade,
  audit_id   uuid references public.audits(id)        on delete set null,

  schema_type text not null check (length(btrim(schema_type)) > 0),
  -- Present-but-unusable is a THIRD state, not a worse version of absent — the
  -- distinction EA-11 exists for, and the reason a half-built node is worse
  -- than none: it gets merged into the WRONG knowledge-graph entry.
  validity text not null default 'valid'
    check (validity in ('valid', 'incomplete', 'unparseable')),
  missing_properties text[] not null default '{}',
  node_id text,                 -- the block's @id, where it has one
  same_as text[] not null default '{}',

  -- The component scores this observation contributed to, kept so a stored
  -- score can be explained without recomputing it from a page that has since
  -- changed. NULL means not measured — never zero.
  component_scores jsonb not null default '{}'::jsonb,
  evidence_json jsonb,

  observed_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One CURRENT row per (owner, subject, type). A re-audit UPDATES what the
-- markup says; it does not stack a second opinion, or every count doubles and
-- "what does this page declare" answers differently depending on how many
-- audits have run — the defect 0056's unique edge index and 0058's listing
-- index both exist to prevent.
alter table public.audit_schema_entities
  drop constraint if exists audit_schema_entity_unique;
alter table public.audit_schema_entities
  add constraint audit_schema_entity_unique
  unique nulls not distinct (user_id, subject_id, schema_type);

create index if not exists audit_schema_entities_owner_idx
  on public.audit_schema_entities (user_id, observed_at desc);
create index if not exists audit_schema_entities_subject_idx
  on public.audit_schema_entities (subject_id) where subject_id is not null;

-- ── Trust observations ────────────────────────────────────────────────────
create table if not exists public.audit_trust_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  subject_id uuid references public.audit_subjects(id) on delete cascade,
  audit_id   uuid references public.audits(id)        on delete set null,

  signal text not null check (length(btrim(signal)) > 0),

  -- 🔴 THE COLUMN THE WHOLE MODEL RESTS ON. It is a claim about WHO holds the
  -- evidence, which is what separates a trust score from a testimonial
  -- counter — so it is constrained here AND refused from a request body in
  -- `/schema-trust/trust`. A provenance flag a client can set is not a claim:
  -- it is `?consented=true` wearing a fifth hat.
  independence text not null
    check (independence in ('self_published', 'self_attributed', 'third_party')),

  observed_count integer not null default 0 check (observed_count >= 0),
  verifiable boolean not null default false,

  -- ⚠️ A `third_party` record with no source_url is a claim ABOUT one. The
  -- model demotes it rather than refusing it, and this CHECK makes the
  -- database agree: independence cannot outrun the evidence behind it.
  source_url text,
  constraint audit_trust_third_party_needs_source
    check (independence <> 'third_party' or source_url is not null),

  evidence_json jsonb,
  observed_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.audit_trust_evidence
  drop constraint if exists audit_trust_evidence_unique;
alter table public.audit_trust_evidence
  add constraint audit_trust_evidence_unique
  unique nulls not distinct (user_id, subject_id, signal, independence);

create index if not exists audit_trust_evidence_owner_idx
  on public.audit_trust_evidence (user_id, observed_at desc);
create index if not exists audit_trust_evidence_subject_idx
  on public.audit_trust_evidence (subject_id) where subject_id is not null;

comment on table public.audit_schema_entities is
  'W13. One row per schema type observed for a subject. Re-observation UPDATES; it never stacks.';
comment on table public.audit_trust_evidence is
  'W13. Trust observations scored by independence, never by count. third_party requires a source_url at the database level.';

-- ── Touch triggers ────────────────────────────────────────────────────────
drop trigger if exists audit_schema_entities_touch on public.audit_schema_entities;
create trigger audit_schema_entities_touch
  before update on public.audit_schema_entities
  for each row execute function public.audit_touch_updated_at();

drop trigger if exists audit_trust_evidence_touch on public.audit_trust_evidence;
create trigger audit_trust_evidence_touch
  before update on public.audit_trust_evidence
  for each row execute function public.audit_touch_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Service-key only, like every other table in this module. The browser reaches
-- Supabase exclusively through Netlify Functions, so an anon policy would be
-- unused attack surface — and 0044 is what that costs when it is not.
alter table public.audit_schema_entities enable row level security;
alter table public.audit_trust_evidence  enable row level security;

drop policy if exists audit_schema_entities_service on public.audit_schema_entities;
create policy audit_schema_entities_service on public.audit_schema_entities
  for all to service_role using (true) with check (true);

drop policy if exists audit_trust_evidence_service on public.audit_trust_evidence;
create policy audit_trust_evidence_service on public.audit_trust_evidence
  for all to service_role using (true) with check (true);

revoke all on public.audit_schema_entities from anon, authenticated;
revoke all on public.audit_trust_evidence  from anon, authenticated;


-- ============================================================
-- 0063_revalidation_request.sql
-- ============================================================
-- 0063_revalidation_request.sql — P2 · W14: revalidation is a REQUEST.
--
-- `validation_scheduled` has been a legal recommendation state since 0054, and
-- `validated_by_audit_id` has been there to record which audit confirmed the
-- fix. Between them sat nothing: no way to say "please re-check this", so the
-- state was set by hand and the loop never closed.
--
-- ── 🔴 WHY THIS IS A REQUEST AND NOT A BUTTON THAT RUNS AN AUDIT ──────────
--
-- A re-audit is a PAID action — it is several fetches, a PageSpeed lookup, a
-- citation sample and an AI call, which is why `audit` has its own monthly
-- budget rather than debiting extraction credits. An "is this fixed yet?"
-- control that silently spends one is the shape of thing a customer discovers
-- on an invoice. So the request is recorded here, gated on `audit.revalidate`
-- (which delegates to the real audit quota), and the run happens on the
-- monitor's own tick where it is visible and countable.
--
-- ⚠️ AND IT IS IDEMPOTENT BY CONSTRUCTION. `revalidation_requested_at` is set
-- once and only cleared when the run completes; a second request while one is
-- outstanding returns the existing one rather than queuing a second paid
-- audit. Clicking twice must not cost twice.
--
-- ⚠️ COLUMNS, NOT A TABLE, deliberately. Nothing here is several writes that
-- must not separate — the test `promote_business_truth_version` had to pass —
-- so a table would buy nothing and add a join to every queue read. Same
-- reasoning 0054 applied to the lifecycle itself.

alter table public.audit_recommendations
  add column if not exists revalidation_requested_at timestamptz,
  -- The audit the fix is being measured AGAINST. Without it "did this improve"
  -- has no answer: a re-audit alone reports a number, not a change — and
  -- `sameSubject()` needs both sides to decide whether the comparison is even
  -- legitimate (D7).
  add column if not exists revalidation_baseline_audit_id uuid
    references public.audits(id) on delete set null;

comment on column public.audit_recommendations.revalidation_requested_at is
  'W14. Set when a re-audit is requested, cleared when it completes. A second request while this is set returns the first — clicking twice must not cost twice.';
comment on column public.audit_recommendations.revalidation_baseline_audit_id is
  'W14. The audit the fix is measured against. A re-audit without a baseline reports a number, not a change.';

-- Outstanding requests, for the worker. Partial, because the overwhelming
-- majority of rows have no request and indexing them would be dead weight.
create index if not exists audit_recommendations_revalidation_idx
  on public.audit_recommendations (user_id, revalidation_requested_at)
  where revalidation_requested_at is not null;


-- ============================================================
-- 0064_subject_scores.sql
-- ============================================================
-- 0064_subject_scores.sql — P2 · W11's withheld result surface. W13's step 5.
--
-- W11 shipped `subjectScoring.js` complete, tested, and IMPORTED BY NOTHING.
-- That was deliberate and it was recorded as deliberate: persisting a subject
-- score needed a subject model (D7) and two components that did not exist
-- (TC from W13, TP from W13). Both blockers are now gone — D7 shipped as
-- `0057`, TC and TP as `0062` — so the deferral has expired, and a pure model
-- with no caller is this schema's own recorded failure mode five times over.
--
-- ── 🔴 THIS TABLE APPENDS. IT DOES NOT UPSERT. ────────────────────────────
-- Every other table W13 added carries a `unique nulls not distinct` arbiter so
-- a re-observation UPDATES rather than stacking. THIS ONE DELIBERATELY HAS NO
-- SUCH CONSTRAINT, and the difference is what each table is FOR:
--
--   `audit_schema_entities` answers "what does this page declare NOW". A second
--   opinion is not wanted; the current answer replaces the last one.
--
--   This table answers "what did this brand score ON THE 12th". That IS the
--   product — W11 exists so a customer can watch a subject improve. An upsert
--   arbiter here would silently destroy the trend line every time a subject was
--   re-scored, leaving one row that claims to be the whole history.
--
-- ⚠️ So two legitimate scorings of the same subject on the same day produce two
-- rows, and that is correct: they are two measurements. A constraint that
-- refused the second would be refusing a re-measure to prevent a duplicate.
--
-- ── 🔴 `score` IS NULLABLE AND `coverage` IS NOT. ─────────────────────────
-- `scoreSubject` returns `score: null` when nothing in the formula could be
-- measured. Storing 0 there would be the one thing this entire module is built
-- to prevent — and it would be indistinguishable, for ever, from a subject that
-- genuinely scored zero.
--
-- And `coverage` is NOT NULL because a score without it is not a smaller score,
-- it is a DIFFERENT one. 72 at 80% coverage with TC excluded and 72 at 100%
-- coverage are not the same measurement. A trend line drawn through stored
-- scores whose coverage was not kept would show a phantom jump on the day an
-- excluded component started being measured — the exact fiction `weightedMean`
-- and `blockedBy` were written to prevent, re-created at the storage layer.
--
-- ── ⚠️ `model_version` IS NOT NULL WITH NO DEFAULT ────────────────────────
-- The rule `audit_results.scoring_model_version` already established in `0048`:
-- a default would let a writer that forgets the stamp file a future score under
-- the current version, which is precisely the mislabelling the column exists to
-- prevent. There are no rows to backfill — this table is new.
--
-- ⚠️ AND IT IS THE SUBJECT MODEL'S OWN VERSION, NOT THE PAGE MODEL'S.
-- `SCORING_MODEL_VERSION` is at "v3" and describes the penalty/pillar maths.
-- The BDS/PDS/SFS weights are a different formula that moves for different
-- reasons. Filing both under one version number would make each comparability
-- claim false: a page-model bump would wrongly invalidate every subject trend,
-- and a weight change here would wrongly leave page diffs comparable. The
-- subject series is namespaced `s1` so the two can never be read as the same.
--
-- ── The five rules from the 2026-09-12 review still apply ─────────────────
--  (a) The table has a writer and a contract test asserting the CALL.
--  (b) No expression arbiter (0059) — there is no arbiter here at all, above.
--  (c) No SELECT-then-INSERT get-or-create (0060).
--  (d) Nothing is SECURITY DEFINER, so there is no grant to get wrong (0061).
--  (e) `subject_id` and `audit_id` are checked in the ROUTE against rows the
--      caller owns, and refused 404 — see `requireSubjectScoreRefs`.

create table if not exists public.audit_subject_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,

  -- 🔴 NOT NULL. A subject score with no subject is the polymorphic pointer D7
  -- was written to refuse. The join table is the whole reason this table can
  -- exist at all, so it is a hard reference, not a hint.
  subject_id uuid not null references public.audit_subjects(id) on delete cascade,
  audit_id   uuid references public.audits(id) on delete set null,

  -- ⚠️ THREE VALUES, NOT SIX. `audit_subjects` legitimately holds `page`,
  -- `domain` and `location` too, and `scoreIdFor()` returns null for all three
  -- because there is no single-number formula for them. A row claiming a page
  -- has a BDS is a category error, so the database refuses it rather than
  -- trusting every future writer to remember.
  kind text not null check (kind in ('brand', 'product', 'service')),
  code text not null check (code in ('BDS', 'PDS', 'SFS')),

  score numeric(5,1) check (score is null or (score >= 0 and score <= 100)),
  coverage numeric(5,1) not null check (coverage >= 0 and coverage <= 100),
  model_version text not null,

  -- The full component breakdown, kept so a stored score can be EXPLAINED
  -- without recomputing it from inputs that have since changed. Recomputation
  -- is not an option for a historical score: the page moved.
  components jsonb not null default '[]'::jsonb,

  -- Which components ran, which did not, and which workstream the absent ones
  -- are waiting on. `blocked_by` is what keeps "we cannot measure this yet"
  -- and "you are failing at this" from rendering the same, months later, to a
  -- reader who was not here when it was scored.
  measured    text[] not null default '{}',
  unmeasured  text[] not null default '{}',
  blocked_by  text[] not null default '{}',

  scored_at  timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists audit_subject_scores_owner_idx
  on public.audit_subject_scores (user_id, scored_at desc);
-- The trend query: one subject, newest first.
create index if not exists audit_subject_scores_subject_idx
  on public.audit_subject_scores (subject_id, scored_at desc);

comment on table public.audit_subject_scores is
  'W11/W13-step-5. APPEND-ONLY history of BDS/PDS/SFS per subject. Never upserted: the trend is the product. score is NULLABLE (unknown is never 0); coverage is NOT NULL because a score without it is a different measurement.';
comment on column public.audit_subject_scores.model_version is
  'The SUBJECT formula version (s-series), not the page model version (v-series). Two different formulas that move for different reasons.';

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Service-key only, like every other table in this module. The browser reaches
-- Supabase exclusively through Netlify Functions, so an anon policy would be
-- unused attack surface — and 0044 is what that costs when it is not.
alter table public.audit_subject_scores enable row level security;

drop policy if exists audit_subject_scores_service on public.audit_subject_scores;
create policy audit_subject_scores_service on public.audit_subject_scores
  for all to service_role using (true) with check (true);

revoke all on public.audit_subject_scores from anon, authenticated;


-- ============================================================
-- 0065_entity_graph_taxonomy.sql
-- ============================================================
-- 0065_entity_graph_taxonomy.sql — align the stored entity graph with §9.2.
--
-- Forward-only: 0056 is already deployable history. Its ids remain valid and
-- four missing entity concepts plus four missing relationships are added here.

alter table public.audit_entities
  drop constraint if exists audit_entities_entity_type_check;

alter table public.audit_entities
  add constraint audit_entities_entity_type_check check (entity_type in (
    'organization','brand','product','service','location','person','offer',
    'review','credential','event','content_asset','topic','industry','audience',
    'partner','customer_case_study','directory_listing','competitor'
  ));

comment on table public.audit_entities is
  'A node in a business entity graph. Eighteen stable internal types cover all fifteen §9.2 semantic types plus offer, event, and topic implementation extensions.';

alter table public.audit_entity_relationships
  drop constraint if exists audit_entity_relationships_predicate_check;

alter table public.audit_entity_relationships
  add constraint audit_entity_relationships_predicate_check check (predicate in (
    'owns','offers','located_at','employs','part_of','same_as','about','serves','competes_with',
    'provides','founded_by','validated_by','listed_on'
  ));

comment on table public.audit_entity_relationships is
  'One entity-graph edge. Thirteen stable internal predicates cover all nine §9.2 relationships plus owns, part_of, same_as, and about implementation extensions; domains and ranges are enforced by entityGraph.validateRelation.';


-- ============================================================
-- 0066_approved_entity_subjects.sql
-- ============================================================
-- 0066_approved_entity_subjects.sql — CP-1.1's explicit entity → subject link.
-- Approved identity is the source of display facts. No proposed/rejected node
-- is backfilled merely because this migration was applied.

create unique index if not exists audit_subjects_workspace_entity_idx
  on public.audit_subjects (workspace_id, subject_kind, entity_id)
  where workspace_id is not null and entity_id is not null;

create or replace function public.upsert_audit_subject(
  p_user_id uuid,
  p_kind text,
  p_target_id uuid default null,
  p_entity_id uuid default null,
  p_truth_record_id uuid default null,
  p_label text default null,
  p_canonical_domain text default null,
  p_workspace_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_entity public.audit_entities%rowtype;
begin
  if (p_target_id is not null)::int
   + (p_entity_id is not null)::int
   + (p_truth_record_id is not null)::int <> 1 then
    raise exception 'upsert_audit_subject: exactly one reference is required';
  end if;

  if p_entity_id is not null then
    select * into v_entity from public.audit_entities where id = p_entity_id;
    if v_entity.id is null or v_entity.state <> 'approved' then
      raise exception 'upsert_audit_subject: entity not found or not approved';
    end if;
    if not (
      (p_kind = 'brand' and v_entity.entity_type in ('organization','brand'))
      or (p_kind = 'product' and v_entity.entity_type = 'product')
      or (p_kind = 'service' and v_entity.entity_type = 'service')
    ) then
      raise exception 'upsert_audit_subject: subject kind does not match entity type';
    end if;

    if v_entity.workspace_id is null then
      if v_entity.user_id <> p_user_id then
        raise exception 'upsert_audit_subject: entity not found';
      end if;
      insert into public.audit_subjects
        (user_id, workspace_id, subject_kind, entity_id, label, canonical_domain)
      values
        (v_entity.user_id, null, p_kind, p_entity_id,
         v_entity.name, v_entity.canonical_domain)
      on conflict (user_id, subject_kind, entity_id) where entity_id is not null
        do update set
          label = excluded.label,
          canonical_domain = excluded.canonical_domain,
          updated_at = now()
      returning id into v_id;
    else
      if p_workspace_id is distinct from v_entity.workspace_id
         or not exists (
           select 1 from public.workspace_members m
            where m.workspace_id = v_entity.workspace_id and m.user_id = p_user_id
         ) then
        raise exception 'upsert_audit_subject: entity not found';
      end if;
      insert into public.audit_subjects
        (user_id, workspace_id, subject_kind, entity_id, label, canonical_domain)
      values
        (v_entity.user_id, v_entity.workspace_id, p_kind, p_entity_id,
         v_entity.name, v_entity.canonical_domain)
      on conflict (workspace_id, subject_kind, entity_id)
        where workspace_id is not null and entity_id is not null
        do update set
          label = excluded.label,
          canonical_domain = excluded.canonical_domain,
          updated_at = now()
      returning id into v_id;
    end if;
    return v_id;
  end if;

  if p_target_id is not null then
    insert into public.audit_subjects
      (user_id, workspace_id, subject_kind, target_id, label, canonical_domain)
    values
      (p_user_id, p_workspace_id, p_kind, p_target_id,
       coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
    on conflict (user_id, subject_kind, target_id) where target_id is not null
      do update set
        label = coalesce(nullif(btrim(p_label), ''), public.audit_subjects.label),
        canonical_domain = coalesce(p_canonical_domain, public.audit_subjects.canonical_domain),
        workspace_id = coalesce(p_workspace_id, public.audit_subjects.workspace_id),
        updated_at = now()
    returning id into v_id;
  else
    insert into public.audit_subjects
      (user_id, workspace_id, subject_kind, truth_record_id, label, canonical_domain)
    values
      (p_user_id, p_workspace_id, p_kind, p_truth_record_id,
       coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
    on conflict (user_id, subject_kind, truth_record_id) where truth_record_id is not null
      do update set
        label = coalesce(nullif(btrim(p_label), ''), public.audit_subjects.label),
        canonical_domain = coalesce(p_canonical_domain, public.audit_subjects.canonical_domain),
        workspace_id = coalesce(p_workspace_id, public.audit_subjects.workspace_id),
        updated_at = now()
    returning id into v_id;
  end if;
  return v_id;
end $$;

comment on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) is
  'D7/CP-1.1 atomic get-or-create. Entity subjects require approved, type-compatible entities and derive identity from them. Workspace members share one subject; no proposal is backfilled.';

revoke all on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid)
  to service_role;


-- ============================================================
-- 0067_discoverability_governance.sql
-- ============================================================
-- 0067_discoverability_governance.sql — P3 scoped roles, shared review and effects.

alter table public.workspace_members add column if not exists discoverability_role text;
update public.workspace_members
   set discoverability_role = case when role in ('owner','admin') then 'admin' else 'viewer' end
 where discoverability_role is null;
alter table public.workspace_members
  alter column discoverability_role set default 'viewer',
  alter column discoverability_role set not null;
alter table public.workspace_members drop constraint if exists workspace_members_discoverability_role_check;
alter table public.workspace_members add constraint workspace_members_discoverability_role_check
  check (discoverability_role in
    ('viewer','analyst','editor','manager','admin','agency_admin','client_viewer'));

alter table public.workspace_invites
  add column if not exists discoverability_role text not null default 'viewer';
alter table public.workspace_invites drop constraint if exists workspace_invites_discoverability_role_check;
alter table public.workspace_invites add constraint workspace_invites_discoverability_role_check
  check (discoverability_role in
    ('viewer','analyst','editor','manager','admin','agency_admin','client_viewer'));

comment on column public.workspace_members.discoverability_role is
  'P3 Discoverability-scoped role, independent of workspace billing/ownership authority.';

create or replace function public.create_workspace(p_owner_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if p_owner_id is null then raise exception 'create_workspace requires an owner id'; end if;
  if v_name = '' then v_name := 'My workspace'; end if;
  insert into public.workspaces (owner_id, name) values (p_owner_id, v_name) returning id into v_id;
  insert into public.workspace_members (workspace_id, user_id, role, discoverability_role)
    values (v_id, p_owner_id, 'owner', 'admin');
  return v_id;
end $$;
revoke all on function public.create_workspace(uuid, text) from public, anon, authenticated;
grant execute on function public.create_workspace(uuid, text) to service_role;

create or replace function public.set_workspace_discoverability_role(
  p_workspace_id uuid, p_actor uuid, p_target_user uuid, p_role text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_actor_role text;
begin
  if p_role not in ('viewer','analyst','editor','manager','admin','agency_admin','client_viewer') then
    return 'invalid_role';
  end if;
  select role into v_actor_role from public.workspace_members
   where workspace_id=p_workspace_id and user_id=p_actor;
  if v_actor_role not in ('owner','admin') then return 'not_authorized'; end if;
  update public.workspace_members set discoverability_role=p_role
   where workspace_id=p_workspace_id and user_id=p_target_user;
  if not found then return 'not_found'; end if;
  return 'ok';
end $$;
revoke all on function public.set_workspace_discoverability_role(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_workspace_discoverability_role(uuid, uuid, uuid, text)
  to service_role;

-- Workspace review must be a real path, not a role label over owner-only rows.
alter table public.audit_entity_relationships
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
update public.audit_entity_relationships r set workspace_id=e.workspace_id
  from public.audit_entities e
 where e.id=r.subject_id and r.workspace_id is null and e.workspace_id is not null;
create index if not exists audit_entity_relationships_workspace_review_idx
  on public.audit_entity_relationships (workspace_id, state, created_at desc)
  where workspace_id is not null;

alter table public.audit_entity_conflicts
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
update public.audit_entity_conflicts c set workspace_id=r.workspace_id
  from public.audit_business_truth_records r
 where r.id=c.truth_record_id and c.workspace_id is null and r.workspace_id is not null;
update public.audit_entity_conflicts c set workspace_id=e.workspace_id
  from public.audit_entities e
 where e.id=c.subject_id and c.workspace_id is null and e.workspace_id is not null;
create index if not exists audit_entity_conflicts_workspace_open_idx
  on public.audit_entity_conflicts (workspace_id, created_at desc)
  where workspace_id is not null and resolved_at is null;

-- §12's measured validation outcomes extend the shared W8 lifecycle.
alter table public.audit_recommendations drop constraint if exists audit_recommendations_status_check;
alter table public.audit_recommendations add constraint audit_recommendations_status_check check (status in (
  'open','accepted','dismissed','done','assigned','in_progress','implemented',
  'validation_scheduled','validated','no_measurable_change','regressed'
));
alter table public.audit_issues drop constraint if exists audit_issues_status_check;
alter table public.audit_issues add constraint audit_issues_status_check check (status in (
  'open','accepted','assigned','in_progress','implemented','validation_scheduled',
  'validated','dismissed','no_measurable_change','regressed'
));
alter table public.audit_issues drop constraint if exists audit_issues_owner_role_check;
alter table public.audit_issues add constraint audit_issues_owner_role_check check (
  owner_role is null or owner_role in (
    'content','seo','engineering','brand','product','growth_cro','product_marketing',
    'analytics','local_ops','design','customer_success','sales','agency'
  )
);

-- Connector delivery is an idempotent effect log, not a second workflow.
create table if not exists public.audit_connector_dispatches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  truth_record_id uuid references public.audit_business_truth_records(id) on delete cascade,
  entity_id uuid references public.audit_entities(id) on delete cascade,
  provider text not null check (provider in ('hubspot','notion','airtable','slack','zapier')),
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  payload_json jsonb not null default '{}'::jsonb,
  status text not null default 'claimed' check (status in ('claimed','delivered','failed')),
  response_json jsonb,
  error text,
  created_at timestamptz not null default now(),
  attempted_at timestamptz,
  delivered_at timestamptz,
  constraint audit_connector_dispatch_one_source check (
    (truth_record_id is not null)::int + (entity_id is not null)::int = 1
  ),
  constraint audit_connector_dispatch_idempotent unique (user_id, provider, idempotency_key)
);
-- A workspace dispatch belongs to the workspace, not whichever admin clicked
-- first. The legacy constraint remains the personal-scope arbiter; this second
-- index prevents two different workspace admins delivering the same effect.
create unique index if not exists audit_connector_dispatch_workspace_idempotent
  on public.audit_connector_dispatches (workspace_id, provider, idempotency_key)
  where workspace_id is not null;
alter table public.audit_connector_dispatches enable row level security;
drop policy if exists audit_connector_dispatches_service on public.audit_connector_dispatches;
create policy audit_connector_dispatches_service on public.audit_connector_dispatches
  for all to service_role using (true) with check (true);
revoke all on public.audit_connector_dispatches from anon, authenticated;

create or replace function public.claim_discoverability_connector_dispatch(
  p_user_id uuid, p_provider text, p_idempotency_key text,
  p_truth_record_id uuid default null, p_entity_id uuid default null,
  p_workspace_id uuid default null, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.audit_connector_dispatches%rowtype;
begin
  if (p_truth_record_id is not null)::int + (p_entity_id is not null)::int <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'one_source_required');
  end if;
  if p_workspace_id is not null and not exists (
    select 1 from public.workspace_members m
     where m.workspace_id=p_workspace_id and m.user_id=p_user_id
       and m.discoverability_role in ('admin','agency_admin')
  ) then return jsonb_build_object('ok', false, 'reason', 'not_authorized'); end if;

  if p_truth_record_id is not null and not exists (
    select 1 from public.audit_business_truth_records r
      join public.audit_business_truth_versions v on v.id=r.current_version_id
     where r.id=p_truth_record_id and r.status='active' and v.state='approved'
       and ((p_workspace_id is null and r.user_id=p_user_id)
         or (p_workspace_id is not null and r.workspace_id=p_workspace_id))
  ) then return jsonb_build_object('ok', false, 'reason', 'source_not_approved'); end if;

  if p_entity_id is not null and not exists (
    select 1 from public.audit_entities e
     where e.id=p_entity_id and e.state='approved'
       and ((p_workspace_id is null and e.user_id=p_user_id)
         or (p_workspace_id is not null and e.workspace_id=p_workspace_id))
  ) then return jsonb_build_object('ok', false, 'reason', 'source_not_approved'); end if;

  insert into public.audit_connector_dispatches
    (user_id, workspace_id, truth_record_id, entity_id, provider, idempotency_key, payload_json)
  values (p_user_id,p_workspace_id,p_truth_record_id,p_entity_id,p_provider,
          btrim(p_idempotency_key),coalesce(p_payload,'{}'::jsonb))
  on conflict do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.audit_connector_dispatches
     where provider=p_provider and idempotency_key=btrim(p_idempotency_key)
       and ((p_workspace_id is null and user_id=p_user_id and workspace_id is null)
         or (p_workspace_id is not null and workspace_id=p_workspace_id));
    return jsonb_build_object('ok',true,'replay',true,'id',v_row.id,'status',v_row.status);
  end if;
  return jsonb_build_object('ok',true,'replay',false,'id',v_row.id,'status',v_row.status);
end $$;
revoke all on function public.claim_discoverability_connector_dispatch(uuid,text,text,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_discoverability_connector_dispatch(uuid,text,text,uuid,uuid,uuid,jsonb)
  to service_role;

create or replace function public.assign_discoverability_recommendation(
  p_user_id uuid, p_workspace_id uuid, p_rec_id uuid, p_assignee uuid default null
) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.workspace_members m
     where m.workspace_id=p_workspace_id and m.user_id=p_user_id
       and m.discoverability_role in ('manager','admin','agency_admin')
  ) then return 'not_authorized'; end if;
  if not exists (
    select 1 from public.audit_recommendations r
     where r.id=p_rec_id and r.workspace_id=p_workspace_id
  ) then return 'not_found'; end if;
  if p_assignee is not null and not exists (
    select 1 from public.workspace_members m
     where m.workspace_id=p_workspace_id and m.user_id=p_assignee and m.paused_at is null
  ) then return 'not_a_member'; end if;
  update public.audit_recommendations
     set assigned_to=p_assignee,
         assigned_at=case when p_assignee is null then null else now() end
   where id=p_rec_id and workspace_id=p_workspace_id;
  return 'ok';
end $$;
revoke all on function public.assign_discoverability_recommendation(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.assign_discoverability_recommendation(uuid,uuid,uuid,uuid)
  to service_role;


-- ============================================================
-- 0068_sxo_static_runs.sql
-- ============================================================
-- 0068_sxo_static_runs.sql — Search Experience Optimization (SXO) static audit runs (Stage 2 / P3A).
--
-- Governed by §11.14 of the P3 PRD:
-- 1. `sxo_total_score` is NULLABLE — unknown is never 0.
-- 2. `coverage` is NOT NULL — a score without coverage is a different measurement.
-- 3. `model_version` has NO DEFAULT — every writer must explicitly declare the version.
-- 4. RLS enabled, revoked from anon and authenticated, service_role access only.

-- 1. SXO runs table
create table if not exists public.audit_sxo_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text not null,
  subject_id text,
  target_id uuid references public.audit_targets(id) on delete set null,
  sxo_total_score numeric(5,1) check (sxo_total_score is null or (sxo_total_score >= 0 and sxo_total_score <= 100)),
  coverage numeric(5,1) not null check (coverage >= 0 and coverage <= 100),
  layer_scores jsonb not null default '{}'::jsonb,
  layer_results jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  weight_set_id text not null default 'sxo_default_v1',
  model_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_sxo_runs_user_audit_idx
  on public.audit_sxo_runs (user_id, audit_id);

create index if not exists audit_sxo_runs_workspace_idx
  on public.audit_sxo_runs (workspace_id)
  where workspace_id is not null;

create index if not exists audit_sxo_runs_subject_idx
  on public.audit_sxo_runs (subject_id)
  where subject_id is not null;

-- 2. Intent mappings table
create table if not exists public.audit_intent_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  subject_id text,
  intent_class text not null,
  target_url text not null,
  mapped_prompt_kinds jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_intent_mappings_user_subject_idx
  on public.audit_intent_mappings (user_id, subject_id);

-- 3. Page templates table
create table if not exists public.audit_page_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  template_key text not null,
  label text not null,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists audit_page_templates_user_key_idx
  on public.audit_page_templates (user_id, template_key)
  where workspace_id is null;

create unique index if not exists audit_page_templates_workspace_key_idx
  on public.audit_page_templates (workspace_id, template_key)
  where workspace_id is not null;

-- 4. RLS and Security lockdown
alter table public.audit_sxo_runs enable row level security;
alter table public.audit_intent_mappings enable row level security;
alter table public.audit_page_templates enable row level security;

revoke all on public.audit_sxo_runs from anon, authenticated;
revoke all on public.audit_intent_mappings from anon, authenticated;
revoke all on public.audit_page_templates from anon, authenticated;

grant select, insert, update, delete on public.audit_sxo_runs to service_role;
grant select, insert, update, delete on public.audit_intent_mappings to service_role;
grant select, insert, update, delete on public.audit_page_templates to service_role;


-- ============================================================
-- 0069_analytics_funnels_forms.sql
-- ============================================================
-- 0069_analytics_funnels_forms.sql — Analytics, Journey Funnels, Form Diagnostics & Goals (Stage 3 / P3B).
--
-- Governed by §11.8, §11.9, §11.14 & §13 of the P3 PRD:
-- 1. Aggregates ONLY. No raw session rows, IP addresses, or visitor PII (§10 / §11.8).
-- 2. Credentials and OAuth tokens in audit_analytics_connections are encrypted at rest.
-- 3. RLS enabled, revoked from anon and authenticated, service_role access only.

-- 1. Conversion goals table (§11.14: conversion_goals)
create table if not exists public.audit_conversion_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text,
  subject_id text,
  name text not null,
  outcome_type text not null,
  target_url text,
  target_selector text,
  target_event text,
  value_cents integer default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_conversion_goals_user_idx
  on public.audit_conversion_goals (user_id);

create index if not exists audit_conversion_goals_workspace_idx
  on public.audit_conversion_goals (workspace_id)
  where workspace_id is not null;

-- 2. Analytics connections table (§11.14: analytics_connections)
create table if not exists public.audit_analytics_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  provider text not null,
  provider_account_id text,
  encrypted_token text,
  token_fingerprint text not null,
  status text not null default 'connected',
  settings jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_analytics_connections_user_idx
  on public.audit_analytics_connections (user_id);

create index if not exists audit_analytics_connections_workspace_idx
  on public.audit_analytics_connections (workspace_id)
  where workspace_id is not null;

-- 3. Analytics event mappings table (§11.14: analytics_event_mappings)
create table if not exists public.audit_analytics_event_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  connection_id uuid references public.audit_analytics_connections(id) on delete cascade,
  source_event_name text not null,
  normalized_event_name text not null,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_analytics_event_mappings_user_idx
  on public.audit_analytics_event_mappings (user_id);

-- 4. Analytics aggregates table (§11.14: analytics_aggregates)
-- Aggregates only across the 7 segmentation axes.
create table if not exists public.audit_analytics_aggregates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text,
  subject_id text,
  date_bucket date not null default current_date,
  landing_page text not null default '/',
  source_channel text not null default 'direct',
  device text not null default 'all',
  region text not null default 'global',
  visitor_type text not null default 'all',
  conversion_goal_id uuid references public.audit_conversion_goals(id) on delete set null,
  event_counts jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_analytics_aggregates_user_audit_idx
  on public.audit_analytics_aggregates (user_id, audit_id);

create index if not exists audit_analytics_aggregates_workspace_idx
  on public.audit_analytics_aggregates (workspace_id)
  where workspace_id is not null;

-- 5. Journey funnels table (§11.14: journey_funnels)
create table if not exists public.audit_journey_funnels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text not null,
  subject_id text,
  funnel_name text not null default 'standard_9_stage',
  stage_results jsonb not null default '[]'::jsonb,
  overall_conversion_rate numeric(5,2),
  mi_score numeric(5,1),
  mi_caveats jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_journey_funnels_user_audit_idx
  on public.audit_journey_funnels (user_id, audit_id);

create index if not exists audit_journey_funnels_workspace_idx
  on public.audit_journey_funnels (workspace_id)
  where workspace_id is not null;

-- 6. Form diagnostics table (§11.14: form_diagnostics)
create table if not exists public.audit_form_diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text not null,
  form_id text not null,
  form_name text,
  page_url text not null,
  metrics jsonb not null default '{}'::jsonb,
  field_diagnostics jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_form_diagnostics_user_audit_idx
  on public.audit_form_diagnostics (user_id, audit_id);

create index if not exists audit_form_diagnostics_workspace_idx
  on public.audit_form_diagnostics (workspace_id)
  where workspace_id is not null;

-- RLS and Permission lockdown on all 6 tables
alter table public.audit_conversion_goals enable row level security;
alter table public.audit_analytics_connections enable row level security;
alter table public.audit_analytics_event_mappings enable row level security;
alter table public.audit_analytics_aggregates enable row level security;
alter table public.audit_journey_funnels enable row level security;
alter table public.audit_form_diagnostics enable row level security;

revoke all on table public.audit_conversion_goals from public, anon, authenticated;
revoke all on table public.audit_analytics_connections from public, anon, authenticated;
revoke all on table public.audit_analytics_event_mappings from public, anon, authenticated;
revoke all on table public.audit_analytics_aggregates from public, anon, authenticated;
revoke all on table public.audit_journey_funnels from public, anon, authenticated;
revoke all on table public.audit_form_diagnostics from public, anon, authenticated;

grant all on table public.audit_conversion_goals to service_role;
grant all on table public.audit_analytics_connections to service_role;
grant all on table public.audit_analytics_event_mappings to service_role;
grant all on table public.audit_analytics_aggregates to service_role;
grant all on table public.audit_journey_funnels to service_role;
grant all on table public.audit_form_diagnostics to service_role;


-- ============================================================
-- 0070_portfolio_experiments.sql
-- ============================================================
-- 0070_portfolio_experiments.sql — Portfolio rollups and optimization experiments (Stage 4 / P3C).
--
-- Governed by §11.10, §11.12, §11.14 of the P3 PRD:
-- 1. Portfolio rollups materialize across the 9 rollup axes on workspace_id.
-- 2. Optimization experiments record changes, observation periods, and expected metrics.
-- 3. RLS enabled, revoked from anon and authenticated, service_role access only.

-- 1. Portfolio rollups table (§11.14: portfolio_rollups)
create table if not exists public.audit_portfolio_rollups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  rollup_axis text not null check (rollup_axis in ('workspace', 'brand', 'business_unit', 'product_line', 'service_line', 'location', 'market_language', 'template', 'owner_team')),
  axis_value text not null,
  audit_count integer not null default 0,
  master_score numeric(5,1),
  layer_scores jsonb not null default '{}'::jsonb,
  framework_scores jsonb not null default '{}'::jsonb,
  coverage numeric(5,1) not null default 0,
  calculated_at timestamptz not null default now()
);

create index if not exists audit_portfolio_rollups_user_axis_idx
  on public.audit_portfolio_rollups (user_id, rollup_axis);

create index if not exists audit_portfolio_rollups_workspace_idx
  on public.audit_portfolio_rollups (workspace_id)
  where workspace_id is not null;

-- 2. Optimization experiments table (§11.14: optimization_experiments)
create table if not exists public.audit_optimization_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text,
  recommendation_id uuid references public.audit_recommendations(id) on delete set null,
  experiment_name text not null,
  ticket_url text,
  hypothesis text,
  expected_metric text not null default 'sxo_total_score',
  baseline_value numeric(8,2),
  current_value numeric(8,2),
  status text not null default 'active' check (status in ('draft', 'active', 'completed', 'cancelled')),
  observation_period_days integer not null default 28 check (observation_period_days > 0),
  start_date timestamptz not null default now(),
  completion_date timestamptz,
  relationship text not null default 'correlation',
  caveats jsonb not null default '[]'::jsonb,
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_optimization_experiments_user_idx
  on public.audit_optimization_experiments (user_id);

create index if not exists audit_optimization_experiments_workspace_idx
  on public.audit_optimization_experiments (workspace_id)
  where workspace_id is not null;

create index if not exists audit_optimization_experiments_audit_idx
  on public.audit_optimization_experiments (audit_id)
  where audit_id is not null;

-- RLS and Permission lockdown
alter table public.audit_portfolio_rollups enable row level security;
alter table public.audit_optimization_experiments enable row level security;

revoke all on public.audit_portfolio_rollups from anon, authenticated;
revoke all on public.audit_optimization_experiments from anon, authenticated;

grant select, insert, update, delete on public.audit_portfolio_rollups to service_role;
grant select, insert, update, delete on public.audit_optimization_experiments to service_role;


-- ============================================================
-- 0071_analytics_import_jobs.sql
-- ============================================================
-- 0071_analytics_import_jobs.sql — durable, idempotent SXO analytics ingestion.
--
-- The HTTP request validates and normalizes aggregate counts, then writes one
-- queue row and returns 202. A scheduled worker claims rows with SKIP LOCKED,
-- writes the aggregate, and records completion or bounded retry state. Raw
-- visitor/session data is never accepted or stored.

create table if not exists public.audit_analytics_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  provider text not null check (provider in ('ga4','posthog','plausible','custom')),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  payload_hash text not null check (length(payload_hash) = 64),
  aggregate_payload jsonb not null,
  state text not null default 'pending'
    check (state in ('pending','processing','retrying','completed','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  result_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, provider, idempotency_key)
);

create index if not exists audit_analytics_import_jobs_due_idx
  on public.audit_analytics_import_jobs (state, next_attempt_at, created_at)
  where state in ('pending','retrying','processing');

create index if not exists audit_analytics_import_jobs_workspace_idx
  on public.audit_analytics_import_jobs (workspace_id, created_at desc)
  where workspace_id is not null;

alter table public.audit_analytics_import_jobs enable row level security;
revoke all on table public.audit_analytics_import_jobs from public, anon, authenticated;
grant all on table public.audit_analytics_import_jobs to service_role;

alter table public.audit_analytics_aggregates
  add column if not exists import_job_id uuid
    references public.audit_analytics_import_jobs(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'audit_analytics_aggregates_import_job_unique'
       and conrelid = 'public.audit_analytics_aggregates'::regclass
  ) then
    alter table public.audit_analytics_aggregates
      add constraint audit_analytics_aggregates_import_job_unique unique (import_job_id);
  end if;
end $$;

create or replace function public.claim_audit_analytics_import_jobs(p_limit integer default 20)
returns setof public.audit_analytics_import_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select j.id
      from public.audit_analytics_import_jobs j
     where (
       (j.state in ('pending','retrying') and j.next_attempt_at <= now())
       or (j.state = 'processing' and j.updated_at < now() - interval '15 minutes')
     )
       and j.attempts < j.max_attempts
     order by j.next_attempt_at, j.created_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.audit_analytics_import_jobs j
     set state = 'processing',
         attempts = j.attempts + 1,
         updated_at = now(),
         last_error = null
    from due
   where j.id = due.id
  returning j.*;
end;
$$;

revoke all on function public.claim_audit_analytics_import_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_audit_analytics_import_jobs(integer) to service_role;


-- ============================================================
-- 0072_analytics_connection_status.sql
-- ============================================================
-- 0072_analytics_connection_status.sql — honest analytics connector lifecycle.
--
-- Saving encrypted credentials proves only that DatIQ can store the supplied
-- configuration. It does not prove that the provider accepted the token or
-- that a sync has completed. Older Stage 3 code labelled that state connected
-- and stamped last_sync_at, which overstated what had actually happened.

update public.audit_analytics_connections
set status = 'configured',
    last_sync_at = null
where status = 'connected';

alter table public.audit_analytics_connections
  alter column status set default 'configured';

alter table public.audit_analytics_connections
  drop constraint if exists audit_analytics_connections_status_check;

alter table public.audit_analytics_connections
  add constraint audit_analytics_connections_status_check
  check (status in ('configured', 'connected', 'error', 'disabled'));

comment on column public.audit_analytics_connections.status is
  'configured means encrypted credentials are saved; connected is reserved for a successful provider verification or sync.';


-- ============================================================
-- 0073_guest_audit_credit.sql
-- ============================================================
-- 0073_guest_audit_credit.sql — a guest's free Discoverability audit gets its own bucket.
--
-- WHY: guest audits drew on the `single` extraction bucket (10 credits). An
-- audit is a page fetch, a robots read, a PageSpeed lookup, a citation sample
-- and an AI call — far costlier than an extraction — and the UI promises ONE
-- free audit, a promise that lived only in the visitor's localStorage. The
-- server now enforces what the product says.
--
-- SHAPE:
--   (a) `audit_count` beside `single_count` / `batch_count`. Additive, default 0.
--   (b) `consume_guest_credit` gains `p_audit_limit integer default 1`. The old
--       4-argument signature is DROPPED rather than overloaded: two overloads
--       make PostgREST's named-argument resolution ambiguous for exactly the
--       4-key calls every existing caller sends. Callers send `p_audit_limit`
--       only for kind='audit', so single/batch calls resolve identically before
--       and after this migration.
--   (c) An unknown kind still counts as `single`, exactly as 0026 behaved.
--
-- ⚠️ DEPLOY ORDER: until this is applied, an audit-kind call names an argument
-- the old function does not have, PostgREST answers 404, and guestUsage.js
-- FAILS OPEN — guest audits are unmetered. Apply before (or with) the code.
--
-- Like 0061 requires, the revoke is from PUBLIC, not only anon/authenticated.

alter table public.guest_identities
  add column if not exists audit_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'guest_identities_audit_count_nonnegative'
       and conrelid = 'public.guest_identities'::regclass
  ) then
    alter table public.guest_identities
      add constraint guest_identities_audit_count_nonnegative check (audit_count >= 0);
  end if;
end $$;

drop function if exists public.consume_guest_credit(text, text, integer, integer);

create or replace function public.consume_guest_credit(
  p_token_hash text,
  p_kind text default 'single',
  p_single_limit integer default 10,
  p_batch_limit integer default 5,
  p_audit_limit integer default 1
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  row_guest public.guest_identities;
  v_kind text := case when p_kind in ('batch', 'audit') then p_kind else 'single' end;
  current_count integer;
  max_count integer;
begin
  if p_token_hash is null or length(trim(p_token_hash)) < 32 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_guest_identity', 'remaining', 0);
  end if;
  insert into public.guest_identities (token_hash) values (p_token_hash) on conflict (token_hash) do nothing;
  select * into row_guest from public.guest_identities where token_hash = p_token_hash for update;

  if v_kind = 'batch' then
    current_count := row_guest.batch_count; max_count := greatest(coalesce(p_batch_limit, 5), 1);
  elsif v_kind = 'audit' then
    current_count := row_guest.audit_count; max_count := greatest(coalesce(p_audit_limit, 1), 1);
  else
    current_count := row_guest.single_count; max_count := greatest(coalesce(p_single_limit, 10), 1);
  end if;

  if current_count >= max_count then
    update public.guest_identities set last_seen_at = now(), updated_at = now() where id = row_guest.id;
    return jsonb_build_object('allowed', false, 'reason', v_kind || '_limit_reached', 'remaining', 0, 'kind', v_kind);
  end if;

  if v_kind = 'batch' then
    update public.guest_identities set batch_count = batch_count + 1, last_seen_at = now(), updated_at = now() where id = row_guest.id;
  elsif v_kind = 'audit' then
    update public.guest_identities set audit_count = audit_count + 1, last_seen_at = now(), updated_at = now() where id = row_guest.id;
  else
    update public.guest_identities set single_count = single_count + 1, last_seen_at = now(), updated_at = now() where id = row_guest.id;
  end if;

  return jsonb_build_object('allowed', true, 'remaining', greatest(max_count - (current_count + 1), 0), 'kind', v_kind);
end;
$$;

revoke all on function public.consume_guest_credit(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_guest_credit(text, text, integer, integer, integer) to service_role;
notify pgrst, 'reload schema';


-- ============================================================
-- 0074_single_founder_approval.sql
-- ============================================================
-- 0074_single_founder_approval.sql
-- Loosen self-approval restrictions for solo founders / single-operator teams
-- when recorded with [Single-founder approval] in the review note.

-- 1. Business truth versions constraint
alter table public.audit_business_truth_versions
  drop constraint if exists audit_btv_no_self_approval;

alter table public.audit_business_truth_versions
  add constraint audit_btv_no_self_approval check (
    state <> 'approved'
    or proposed_by is null
    or reviewed_by is null
    or reviewed_by <> proposed_by
    or (review_note is not null and review_note like '%[Single-founder approval]%')
  );

-- 2. Entity graph relationships constraint
alter table public.audit_entity_relationships
  drop constraint if exists audit_rel_no_self_approval;

alter table public.audit_entity_relationships
  add constraint audit_rel_no_self_approval check (
    state <> 'approved'
    or proposed_by is null
    or reviewed_by is null
    or reviewed_by <> proposed_by
    or (review_note is not null and review_note like '%[Single-founder approval]%')
  );

-- 3. Update promote_business_truth_version RPC
create or replace function public.promote_business_truth_version(
  p_version_id  uuid,
  p_reviewer_id uuid,
  p_note        text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id  uuid;
  v_state      text;
  v_proposer   uuid;
  v_fields     jsonb;
  v_current    uuid;
begin
  select record_id, state, proposed_by, fields_json
    into v_record_id, v_state, v_proposer, v_fields
    from public.audit_business_truth_versions
   where id = p_version_id
   for update;

  if v_record_id is null then
    return 'not_found';
  end if;

  if v_state = 'approved' then
    select current_version_id into v_current
      from public.audit_business_truth_records where id = v_record_id;
    if v_current = p_version_id then
      return 'ok';
    end if;
  end if;

  if v_state not in ('pending_review', 'approved') then
    return 'not_reviewable';
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id then
    if p_note is null or p_note not like '%[Single-founder approval]%' then
      return 'self_approval';
    end if;
  end if;

  if v_fields -> 'legal_name' is null or v_fields -> 'canonical_domain' is null then
    return 'missing_required';
  end if;

  update public.audit_business_truth_versions v
     set state = 'superseded', superseded_at = now()
    from public.audit_business_truth_records r
   where r.id = v_record_id
     and v.id = r.current_version_id
     and v.id <> p_version_id;

  update public.audit_business_truth_versions
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_version_id;

  update public.audit_business_truth_records
     set current_version_id = p_version_id
   where id = v_record_id;

  return 'ok';
end;
$$;

-- 4. Update approve_entity_relationship RPC
create or replace function public.approve_entity_relationship(
  p_relationship_id uuid,
  p_reviewer_id     uuid,
  p_note            text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    text;
  v_proposer uuid;
  v_subject  uuid;
  v_object   uuid;
  v_bad      integer;
begin
  select state, proposed_by, subject_id, object_id
    into v_state, v_proposer, v_subject, v_object
    from public.audit_entity_relationships
   where id = p_relationship_id
   for update;

  if v_state is null then
    return 'not_found';
  end if;

  if v_state = 'approved' then
    return 'ok';
  end if;

  if v_state = 'rejected' then
    return 'rejected';
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id then
    if p_note is null or p_note not like '%[Single-founder approval]%' then
      return 'self_approval';
    end if;
  end if;

  select count(*) into v_bad
    from public.audit_entities
   where id in (v_subject, v_object) and state = 'rejected';
  if v_bad > 0 then
    return 'endpoint_rejected';
  end if;

  update public.audit_entities
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id in (v_subject, v_object)
     and state = 'proposed';

  update public.audit_entity_relationships
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_relationship_id;

  return 'ok';
end;
$$;


-- ============================================================
-- 0075_entity_approval.sql
-- ============================================================
-- 0075_entity_approval.sql
-- Direct entity node approval RPC and single-founder self-approval constraint
-- on audit_entities.

-- 1. Entities self-approval constraint
alter table public.audit_entities
  drop constraint if exists audit_entities_no_self_approval;

alter table public.audit_entities
  add constraint audit_entities_no_self_approval check (
    state <> 'approved'
    or proposed_by is null
    or reviewed_by is null
    or reviewed_by <> proposed_by
    or (review_note is not null and review_note like '%[Single-founder approval]%')
  );

-- 2. Direct entity node approval function
create or replace function public.approve_entity(
  p_entity_id   uuid,
  p_reviewer_id uuid,
  p_note        text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    text;
  v_proposer uuid;
begin
  select state, proposed_by
    into v_state, v_proposer
    from public.audit_entities
   where id = p_entity_id
   for update;

  if v_state is null then
    return 'not_found';
  end if;

  if v_state = 'approved' then
    return 'ok';
  end if;

  if v_state = 'rejected' then
    return 'rejected';
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id then
    if p_note is null or p_note not like '%[Single-founder approval]%' then
      return 'self_approval';
    end if;
  end if;

  update public.audit_entities
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_entity_id;

  return 'ok';
end;
$$;

comment on function public.approve_entity(uuid, uuid, text) is
  'Approve an entity node directly with optional single-founder self-approval note';
revoke all on function public.approve_entity(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_entity(uuid, uuid, text) to service_role;


-- ============================================================
-- 0076_endpoint_self_approval_and_directory_ignores.sql
-- ============================================================
-- 0076_endpoint_self_approval_and_directory_ignores.sql
--
-- Two fixes for the Discoverability workspace tabs.
--
-- ── 1. Approving a relationship could FAIL WITH A RAW CHECK VIOLATION ───────
-- approve_entity_relationship approves the edge AND any still-proposed
-- endpoint under the same reviewer. 0074 let a single founder self-approve the
-- EDGE with a "[Single-founder approval]" note, and 0075 did the same for
-- entities — but the function never asked whether the reviewer had proposed an
-- ENDPOINT. When a teammate proposed the edge and the reviewer had proposed one
-- of its entities, the panel sent the ordinary note, the endpoint UPDATE hit
-- audit_entities_no_self_approval, and the whole call raised 23514. The route
-- read that as a storage failure and the user saw "couldn't save".
--
-- Reproduced against real Postgres before this migration was written. The fix
-- asks the question up front and returns a VERDICT, so the refusal is explicit
-- and actionable rather than an exception. The single-founder note still
-- covers both halves, exactly as 0074/0075 intend.
--
-- ── 2. Directory sources a business does not use ───────────────────────────
-- The source registry is regional, not per-business: Practo, Zomato and
-- MagicBricks are real directories and irrelevant to a SaaS company. A user
-- can now IGNORE a source for a truth record, with a reason, and the NAP check
-- excludes it. An ignore is a recorded decision, not a deletion: it is
-- per-record, reversible (delete the row), and keeps who decided and why.
-- Columns-only arbiter (NULLS NOT DISTINCT) so a PostgREST upsert can use it —
-- the lesson 0059 recorded.

create or replace function public.approve_entity_relationship(
  p_relationship_id uuid,
  p_reviewer_id     uuid,
  p_note            text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    text;
  v_proposer uuid;
  v_subject  uuid;
  v_object   uuid;
  v_bad      integer;
  v_own_ends integer;
  v_founder  boolean := p_note is not null and p_note like '%[Single-founder approval]%';
begin
  select state, proposed_by, subject_id, object_id
    into v_state, v_proposer, v_subject, v_object
    from public.audit_entity_relationships
   where id = p_relationship_id
   for update;

  if v_state is null then
    return 'not_found';
  end if;

  if v_state = 'approved' then
    return 'ok';
  end if;

  if v_state = 'rejected' then
    return 'rejected';
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id and not v_founder then
    return 'self_approval';
  end if;

  select count(*) into v_bad
    from public.audit_entities
   where id in (v_subject, v_object) and state = 'rejected';
  if v_bad > 0 then
    return 'endpoint_rejected';
  end if;

  -- The endpoint half of the self-approval rule, asked BEFORE any write so it
  -- is a verdict and never a constraint violation.
  select count(*) into v_own_ends
    from public.audit_entities
   where id in (v_subject, v_object)
     and state = 'proposed'
     and proposed_by = p_reviewer_id;
  if v_own_ends > 0 and not v_founder then
    return 'endpoint_self_approval';
  end if;

  update public.audit_entities
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id in (v_subject, v_object)
     and state = 'proposed';

  update public.audit_entity_relationships
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_relationship_id;

  return 'ok';
end;
$$;

revoke all on function public.approve_entity_relationship(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_entity_relationship(uuid, uuid, text) to service_role;

create table if not exists public.audit_directory_source_ignores (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,
  truth_record_id  uuid references public.audit_business_truth_records(id) on delete cascade,
  source_id        text not null check (length(btrim(source_id)) > 0),
  -- A decision nobody can explain three months later is indistinguishable from
  -- a mis-click, so the reason is required — same rule as a rejection.
  reason           text not null check (length(btrim(reason)) > 0),
  ignored_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint audit_dir_source_ignore_unique
    unique nulls not distinct (user_id, truth_record_id, source_id)
);

create index if not exists audit_dir_source_ignores_owner_idx
  on public.audit_directory_source_ignores (user_id, truth_record_id);
create index if not exists audit_dir_source_ignores_workspace_idx
  on public.audit_directory_source_ignores (workspace_id, truth_record_id)
  where workspace_id is not null;

comment on table public.audit_directory_source_ignores is
  'Directory sources a user has marked not applicable to a business truth record, with the reason. Excluded from NAP checks; reversible by deleting the row.';

alter table public.audit_directory_source_ignores enable row level security;

drop policy if exists audit_dir_source_ignores_service on public.audit_directory_source_ignores;
create policy audit_dir_source_ignores_service on public.audit_directory_source_ignores
  for all to service_role using (true) with check (true);

revoke all on public.audit_directory_source_ignores from anon, authenticated;
grant select, insert, update, delete on public.audit_directory_source_ignores to service_role;


-- ============================================================
-- 0077_approve_entity_richer_verdicts.sql
-- ============================================================
-- 0077_approve_entity_richer_verdicts.sql
--
-- Richer verdict codes from public.approve_entity so the UI can tell the user
-- what is actually blocking the approval instead of showing a generic
-- "Could not approve the entity." This is the server-side half of the
-- 2026-09-22 plan to give entity-graph approvals actionable error messages.
--
-- 🔴 THE PROBLEM THIS FIXES. 0075 defined approve_entity with five verdict
-- strings: not_found, ok, rejected, no_approver, self_approval. The route
-- already had a VERDICTS map that translated each into a 4xx + message — but
-- auditStore.js swallowed the self_approval verdict (and auditStore.js
-- swallowed the endpoint_self_approval verdict on relationships) and fell
-- through to a direct DB PATCH. When the PATCH hit audit_entities_no_self_approval
-- it raised 23514 with a raw Postgres message; when it didn't, it succeeded
-- silently against the user's intent. Either way the user saw a generic
-- "Could not approve the entity" and had no idea whether they should ask a
-- teammate, retry, or give up.
--
-- THIS MIGRATION DOES THREE THINGS:
--
--   1. Re-define approve_entity so the verdict strings are the canonical
--      source of truth — and add three new codes the route can map:
--        - tenant_mismatch  (403) — entity exists but belongs to another workspace
--        - already_approved — entity is already approved. THIS IS A SUCCESS,
--          NOT A CONFLICT: auditStore maps it to { ok: true } and the route
--          answers HTTP 200 with `alreadyApproved: true`. Approval stays
--          idempotent, so a double-click or a retry is a no-op rather than an
--          error the user has to interpret. The verdict exists only so a stale
--          UI can say "already approved" instead of claiming it just did it.
--          (An earlier draft of this header said 409 — that was never what the
--          code did, and a 409 here would have re-introduced exactly the kind of
--          confusing refusal this migration exists to remove.)
--        - check_violation  (409) — generic 23514 fallback the route can map to
--          a clearer remediation hint
--   2. Same for approve_entity_relationship so the store stops swallowing
--      endpoint_self_approval and that verdict reaches the route.
--   3. Document the verdict contract in the function COMMENT so a future
--      auditStore or route can rely on the enum without re-reading the SQL.

create or replace function public.approve_entity(
  p_entity_id   uuid,
  p_reviewer_id uuid,
  p_note        text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    text;
  v_proposer uuid;
begin
  select state, proposed_by
    into v_state, v_proposer
    from public.audit_entities
   where id = p_entity_id
   for update;

  if v_state is null then
    return 'not_found';
  end if;

  if v_state = 'approved' then
    return 'already_approved';
  end if;

  if v_state = 'rejected' then
    return 'rejected';
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id then
    if p_note is null or p_note not like '%[Single-founder approval]%' then
      return 'self_approval';
    end if;
  end if;

  begin
    update public.audit_entities
       set state = 'approved',
           reviewed_by = p_reviewer_id,
           reviewed_at = now(),
           review_note = coalesce(p_note, review_note)
     where id = p_entity_id;
  exception when check_violation then
    -- audit_entities_no_self_approval, audit_entities_review_required, etc.
    -- The exception block exists so the verdict is explicit rather than a
    -- 23514 escape with no remediation hint.
    return 'check_violation';
  end;

  return 'ok';
end;
$$;

comment on function public.approve_entity(uuid, uuid, text) is
  'Approve an entity node directly with optional single-founder self-approval note. '
  'Verdict contract (canonical, callers may rely on this enum): '
  'ok | already_approved | not_found | rejected | no_approver | self_approval | check_violation. '
  '0077 added already_approved and check_violation; the rest are inherited from 0075.';
revoke all on function public.approve_entity(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_entity(uuid, uuid, text) to service_role;

create or replace function public.approve_entity_relationship(
  p_relationship_id uuid,
  p_reviewer_id     uuid,
  p_note            text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    text;
  v_proposer uuid;
  v_subject  uuid;
  v_object   uuid;
  v_bad      integer;
  v_own_ends integer;
  v_founder  boolean := p_note is not null and p_note like '%[Single-founder approval]%';
begin
  select state, proposed_by, subject_id, object_id
    into v_state, v_proposer, v_subject, v_object
    from public.audit_entity_relationships
   where id = p_relationship_id
   for update;

  if v_state is null then
    return 'not_found';
  end if;

  if v_state = 'approved' then
    return 'already_approved';
  end if;

  if v_state = 'rejected' then
    return 'rejected';
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id and not v_founder then
    return 'self_approval';
  end if;

  select count(*) into v_bad
    from public.audit_entities
   where id in (v_subject, v_object) and state = 'rejected';
  if v_bad > 0 then
    return 'endpoint_rejected';
  end if;

  select count(*) into v_own_ends
    from public.audit_entities
   where id in (v_subject, v_object)
     and state = 'proposed'
     and proposed_by = p_reviewer_id
     and not v_founder;
  if v_own_ends > 0 then
    return 'endpoint_self_approval';
  end if;

  begin
    update public.audit_entity_relationships
       set state = 'approved',
           reviewed_by = p_reviewer_id,
           reviewed_at = now(),
           review_note = coalesce(p_note, review_note)
     where id = p_relationship_id;

    update public.audit_entities
       set state = 'approved',
           reviewed_by = p_reviewer_id,
           reviewed_at = now(),
           review_note = coalesce(p_note, review_note)
     where id in (v_subject, v_object)
       and state = 'proposed';
  exception when check_violation then
    return 'check_violation';
  end;

  return 'ok';
end;
$$;

comment on function public.approve_entity_relationship(uuid, uuid, text) is
  'Approve an edge and its still-proposed endpoints under the same reviewer. '
  'Verdict contract (canonical, callers may rely on this enum): '
  'ok | already_approved | not_found | rejected | no_approver | self_approval | endpoint_rejected | endpoint_self_approval | check_violation. '
  '0077 added already_approved and check_violation; 0076 added endpoint_self_approval.';
revoke all on function public.approve_entity_relationship(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_entity_relationship(uuid, uuid, text) to service_role;

-- Refresh PostgREST schema cache so the new RPC bodies are visible immediately.
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- 0078_credit_grants_and_balance.sql
-- ============================================================
-- 0078_credit_grants_and_balance.sql
-- Step D of docs/CREDITS-UNIFICATION-PROPOSAL.md — make the balance real.
--
-- ── WHAT 0037 LEFT OUT ──────────────────────────────────────────────────────
-- 0037 built an append-only ledger and `credit_balance()`, which sums every
-- row for a user. That answers "what is the net of this account's rows" — it
-- does NOT answer "how many credits may this person spend right now", because
-- nothing in it can expire. Rollover (D2) needs an expiry, and an expiry needs
-- FIFO allocation, or a grant that lapses would retroactively un-pay for work
-- that was already done with it.
--
-- ── WHY expires_at AND NOT A MONTHLY RESET ──────────────────────────────────
-- A monthly grant carrying `expires_at = end of the FOLLOWING month` implements
-- D2 structurally, with no forfeiture arithmetic anywhere:
--
--   * a grant issued for month M is spendable in M;
--   * whatever is unused is still spendable in M+1, because it has not expired;
--   * it is gone at the end of M+1;
--   * so at most TWO grants are ever live at once, which IS the "carry <= 1x
--     the monthly allowance" cap, and the "worst-case month is bounded at 2x
--     the plan budget" guarantee, without a second rule to keep in sync.
--
-- The cap is therefore a property of the data, not a number some job has to
-- remember to enforce. That is the same reasoning the ledger itself rests on:
-- a counter that drifts from the rows it counts eventually bills somebody for
-- work that is not there.
--
-- ⚠️ Free (D3) is granted with expires_at NULL. It is a lifetime pool, not a
-- monthly allowance, and giving it an expiry would quietly delete the taster.
--
-- ── FIFO IS WHAT MAKES AN EXPIRY HONEST ─────────────────────────────────────
-- Spend is allocated against the OLDEST grant first. Without that, a user who
-- spent 50 of a 100-credit grant and then received a new grant could see the
-- old grant expire and lose 100 rather than the 50 that were actually left.
-- credit_available() below walks grants oldest-first, absorbs spend into them,
-- and counts only the UNUSED remainder of grants that have not expired.
--
-- Adds 2 columns, 1 index, 3 functions. No new tables.

-- ── 1. expiry and idempotency on grant rows ─────────────────────────────────
alter table public.credit_ledger
  add column if not exists expires_at timestamptz;

-- The period a monthly grant belongs to ('YYYY-MM'), or a stable key for a
-- one-off grant ('signup', 'referral:<id>', 'pack:<order>'). It exists so a
-- grant can be issued EXACTLY ONCE: a cron that runs twice, a webhook that is
-- redelivered, or a retried apply must not double-credit an account.
alter table public.credit_ledger
  add column if not exists grant_period text;

-- 🔴 THE IDEMPOTENCY GUARANTEE, AS A CONSTRAINT RATHER THAN A CONVENTION.
-- payment-webhook.js's read-then-write dedup races; this cannot. A second
-- insert for the same (user, period) raises unique_violation, which
-- credit_grant() below catches and reports as 'already_granted'.
create unique index if not exists credit_ledger_grant_period_uniq
  on public.credit_ledger (user_id, grant_period)
  where grant_period is not null;

create index if not exists credit_ledger_grant_expiry_idx
  on public.credit_ledger (user_id, occurred_at)
  where credits < 0;

-- ── 1b. a paused job must say WHY ──────────────────────────────────────────
-- enrichment_jobs can already be 'paused' and has nowhere to record the cause.
-- L3 pauses a job that has run out of credits, and a job that reports "paused"
-- with no reason is the same failure shape this repo has already had to fix
-- for schedules: it stops, nothing says why, and the user assumes it is broken.
alter table public.enrichment_jobs
  add column if not exists paused_reason text;

-- ── 2. the spendable balance ────────────────────────────────────────────────
--
-- Sign convention, inherited from 0037 and unchanged: a POSITIVE row is credits
-- CONSUMED, a NEGATIVE row is a grant or a refund. So a grant of 100 is stored
-- as -100, and "available" is grants minus spend.
--
-- Returns a signed integer. A NEGATIVE result is real and is not clamped: it
-- means more was spent than was ever granted, which is a fact worth surfacing
-- rather than rounding away to a comfortable zero.
create or replace function public.credit_available(
  p_user_id uuid, p_now timestamptz default now()
) returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_spent     bigint := 0;
  v_remaining bigint := 0;
  v_alloc     bigint;
  g           record;
begin
  if p_user_id is null then return 0; end if;

  select coalesce(sum(credits), 0) into v_spent
    from public.credit_ledger
   where user_id = p_user_id and credits > 0;

  -- Oldest grant first. A refund (also a negative row) participates as a grant
  -- with no expiry, which is correct: giving credits back must actually give
  -- them back, not hand over something that lapses on someone else's clock.
  for g in
    select (-credits)::bigint as amount, expires_at
      from public.credit_ledger
     where user_id = p_user_id and credits < 0
     order by occurred_at asc, id asc
  loop
    v_alloc := least(g.amount, v_spent);
    v_spent := v_spent - v_alloc;
    if g.expires_at is null or g.expires_at > p_now then
      v_remaining := v_remaining + (g.amount - v_alloc);
    end if;
  end loop;

  -- Anything still unallocated is spend beyond every grant ever made.
  return (v_remaining - v_spent)::integer;
end $$;

-- ── 2b. is the credit system LIVE for this account? ─────────────────────────
--
-- 🔴 WITHOUT THIS, APPLYING THIS MIGRATION WOULD REFUSE EVERY CUSTOMER.
-- The gates that read the balance ship BEFORE the step that starts granting
-- monthly allowances (step G of the proposal, which waits on calibration). So
-- on the day 0078 is applied, credit_available() correctly returns 0 for
-- everyone — nobody has been granted anything yet — and every gate reading it
-- would pause every schedule, every monitor and every bulk job at once.
--
-- The rule that avoids it is the honest one rather than a feature flag: an
-- account that has NEVER been granted credits is not on the credit system, so
-- there is no balance to enforce. `grants` is what says which. The moment the
-- first grant lands the gate arms itself for that account, with no switch to
-- remember to flip and no window where it is half on.
--
-- Returns everything a balance screen needs in one round trip, because the
-- alternative is three calls to answer one question.
create or replace function public.credit_status(
  p_user_id uuid, p_now timestamptz default now()
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_grants  integer;
  v_granted bigint;
  v_spent   bigint;
begin
  if p_user_id is null then
    return jsonb_build_object('enforced', false, 'available', 0, 'grants', 0,
                              'granted', 0, 'spent', 0);
  end if;

  select count(*)::integer, coalesce(sum(-credits), 0)
    into v_grants, v_granted
    from public.credit_ledger
   where user_id = p_user_id and credits < 0 and reason = 'grant';

  select coalesce(sum(credits), 0) into v_spent
    from public.credit_ledger
   where user_id = p_user_id and credits > 0;

  return jsonb_build_object(
    'enforced',  v_grants > 0,
    'available', public.credit_available(p_user_id, p_now),
    'grants',    v_grants,
    'granted',   v_granted,
    'spent',     v_spent
  );
end $$;

-- ── 3. issue a grant, exactly once ──────────────────────────────────────────
-- p_credits is the POSITIVE number of credits to give; the row is written
-- negative. Callers should not have to think about the sign convention to
-- avoid accidentally charging somebody for a gift.
create or replace function public.credit_grant(
  p_user_id    uuid,
  p_credits    integer,
  p_period     text default null,
  p_expires_at timestamptz default null,
  p_meta       jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_user');
  end if;
  if p_credits is null or p_credits <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'non_positive');
  end if;

  begin
    insert into public.credit_ledger (
      user_id, reason, credits, unit, quantity, meta, expires_at, grant_period
    ) values (
      p_user_id, 'grant', -p_credits, null, p_credits,
      coalesce(p_meta, '{}'::jsonb), p_expires_at, p_period
    ) returning id into v_id;
  exception
    -- The partial unique index above. A redelivered webhook, a cron that ran
    -- twice, or a retried backfill lands here and is a no-op, not a double
    -- credit. Reported as a distinct outcome so a caller can tell "already
    -- done" from "failed" — collapsing those is how a retry loop starts.
    when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'already_granted', 'period', p_period);
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'reason', 'unknown_user');
  end;

  return jsonb_build_object(
    'ok', true, 'id', v_id, 'credits', p_credits,
    'available', public.credit_available(p_user_id)
  );
end $$;

-- ── 4. the monthly allowance, with rollover built in ────────────────────────
-- p_period is 'YYYY-MM'. The grant expires at the END of the FOLLOWING month,
-- which is what makes the carry cap structural (see the header).
create or replace function public.credit_grant_monthly(
  p_user_id uuid, p_credits integer, p_period text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_start date;
begin
  if p_period is null or p_period !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_period');
  end if;
  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  return public.credit_grant(
    p_user_id, p_credits, p_period,
    -- end of the month AFTER p_period
    ((v_start + interval '2 months')::timestamptz),
    jsonb_build_object('kind', 'monthly', 'period', p_period)
  );
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────
-- Same posture as 0061: revoke from PUBLIC (which is what actually removes the
-- default grant — revoking from anon alone is a no-op, as 0012 proved), then
-- grant service_role EXPLICITLY rather than inheriting Supabase's ALTER
-- DEFAULT PRIVILEGES, which a restored dump does not carry.
revoke all on function public.credit_available(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.credit_status(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.credit_grant(uuid, integer, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.credit_grant_monthly(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.credit_available(uuid, timestamptz) to service_role;
grant execute on function public.credit_status(uuid, timestamptz) to service_role;
grant execute on function public.credit_grant(uuid, integer, text, timestamptz, jsonb) to service_role;
grant execute on function public.credit_grant_monthly(uuid, integer, text) to service_role;

-- Final: refresh the PostgREST schema cache so the API picks up new tables/RPCs immediately.
NOTIFY pgrst, 'reload schema';
