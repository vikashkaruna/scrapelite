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
