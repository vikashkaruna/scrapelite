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
