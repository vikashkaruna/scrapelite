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
