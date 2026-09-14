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
