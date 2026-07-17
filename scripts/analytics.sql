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
