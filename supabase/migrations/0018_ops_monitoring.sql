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
