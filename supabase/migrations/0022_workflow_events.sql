-- scripts/workflow-events.sql — v2 plan: workflow_events / workflow_runs / workflow_subscriptions.
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run (every statement is
-- IF NOT EXISTS or guarded).
-- Full context: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §5
--
-- ============================================================================
-- DatIQ — 0018 workflow_events / workflow_runs / workflow_subscriptions
-- ============================================================================
--
-- Three tables that back the n8n + self-hosted-n8n-MCP-server workflow pipeline:
--
--   1. public.workflow_events
--        The queue. One row per automation event. State machine:
--        pending → processing → done | failed | cancelled.
--        Polled every 5 min by netlify/functions/workflow-orchestrator.js
--        and dispatched to self-hosted n8n (Hostinger VPS).
--
--   2. public.workflow_runs
--        Per-attempt log. One row per dispatch attempt of a workflow_event.
--        Lets you answer "what happened on attempt 2 of wfe_xyz?" — without
--        this table, debugging a stuck event means staring at n8n logs.
--
--   3. public.workflow_subscriptions
--        Per-user channel preferences. Powers the "also DM me on Telegram
--        when this changes" idea; today the only implicit subscription is
--        "this user wants email for schedule X" (stored in scheduled_tasks.data).
--
-- RLS posture:
--   • workflow_events        — service key only (no anon policy). Written/read
--                               by Netlify Functions (orchestrator, scheduled-runner)
--                               and the n8n Supabase node (which uses the service key).
--   • workflow_runs          — same. Always joined to an event anyway.
--   • workflow_subscriptions — per-user CRUD for the owning user, service key
--                               for the orchestrator.
--
-- Idempotent (IF NOT EXISTS / OR REPLACE) — safe to re-run.
-- Run after 0011 (last existing migration).
-- ============================================================================


-- ── 1. workflow_events ────────────────────────────────────────────────────
create table if not exists public.workflow_events (
  id              text primary key,                  -- 'wfe_' + nanoid; client-generated
  kind            text not null,                     -- 'schedule.changed' | 'contact.received' |
                                                     -- 'user.lifecycle'  | 'op.alert'
  ref_id          text,                              -- sch_xxx | contact id | user_id (nullable)
  user_id         uuid references auth.users,        -- nullable (guests / system events)
  payload         jsonb not null default '{}'::jsonb,-- full event data, kept as-is for replay
  channels        jsonb not null default '[]'::jsonb,-- [{type:'email'|'slack'|'n8n'|'webhook', target, template}]
  state           text not null default 'pending',   -- pending | processing | done | failed | cancelled
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  started_at      timestamptz,                       -- when state → processing
  finished_at     timestamptz,                       -- when state → done | failed | cancelled
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint workflow_events_state_chk check (
    state in ('pending', 'processing', 'done', 'failed', 'cancelled')
  )
);

-- Indexes for the orchestrator's poll + the diagnostic MCP tools.
create index if not exists workflow_events_state_next_attempt_idx
  on public.workflow_events (state, next_attempt_at);
create index if not exists workflow_events_ref_id_idx
  on public.workflow_events (ref_id);
create index if not exists workflow_events_user_id_idx
  on public.workflow_events (user_id);
create index if not exists workflow_events_kind_idx
  on public.workflow_events (kind);
create index if not exists workflow_events_created_at_idx
  on public.workflow_events (created_at desc);

alter table public.workflow_events enable row level security;
-- No anon policy: service key bypasses RLS; this table is server-side only.


-- ── 2. workflow_runs ──────────────────────────────────────────────────────
create table if not exists public.workflow_runs (
  id              text primary key,                  -- 'wfr_' + nanoid
  event_id        text not null references public.workflow_events(id) on delete cascade,
  attempt_n       integer not null,
  channel         text,                              -- 'n8n' | 'email' | 'slack' | 'webhook' | 'force-dispatch'
  request         jsonb,                             -- the request body sent
  response_status integer,                           -- HTTP status (null if never reached)
  response_body   text,                              -- truncated to 4 KB to keep the table small
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  duration_ms     integer,
  error           text,

  unique (event_id, attempt_n)
);

create index if not exists workflow_runs_event_id_idx
  on public.workflow_runs (event_id, attempt_n desc);

alter table public.workflow_runs enable row level security;
-- No anon policy: server-side only.


-- ── 3. workflow_subscriptions ─────────────────────────────────────────────
create table if not exists public.workflow_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null,                        -- 'schedule' | 'contact' | 'payment' | 'user'
  ref_id      text,                                 -- schedule id, payment id, etc. NULL = applies to all of this kind for the user
  channels    jsonb not null default '[]'::jsonb,  -- [{type:'email'|'slack'|'telegram'|'discord'|'webhook', target, enabled, template?}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (user_id, kind, ref_id)
);

create index if not exists workflow_subscriptions_user_id_idx
  on public.workflow_subscriptions (user_id);

alter table public.workflow_subscriptions enable row level security;

-- Per-user CRUD. The orchestrator uses the service key to read these.
drop policy if exists "users own workflow_subscriptions" on public.workflow_subscriptions;
create policy "users own workflow_subscriptions" on public.workflow_subscriptions
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── 4. updated_at trigger (shared) ────────────────────────────────────────
-- Both workflow_events and workflow_subscriptions have an updated_at column;
-- a tiny trigger keeps it fresh on every UPDATE.
create or replace function public.workflow_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists workflow_events_set_updated_at on public.workflow_events;
create trigger workflow_events_set_updated_at
  before update on public.workflow_events
  for each row execute function public.workflow_set_updated_at();

drop trigger if exists workflow_subscriptions_set_updated_at on public.workflow_subscriptions;
create trigger workflow_subscriptions_set_updated_at
  before update on public.workflow_subscriptions
  for each row execute function public.workflow_set_updated_at();


-- ── Done. Verify: ─────────────────────────────────────────────────────────
--   select count(*) from public.workflow_events;     -- should be 0 on a fresh DB
--   select count(*) from public.workflow_runs;
--   select count(*) from public.workflow_subscriptions;
--   \d public.workflow_events                        -- expect 15 columns + 5 indexes
