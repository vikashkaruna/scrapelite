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
