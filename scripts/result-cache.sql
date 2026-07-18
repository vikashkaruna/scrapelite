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
