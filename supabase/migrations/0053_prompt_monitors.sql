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
