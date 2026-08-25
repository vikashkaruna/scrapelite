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
