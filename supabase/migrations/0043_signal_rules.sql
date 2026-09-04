-- 0043_signal_rules.sql
-- Phase 6 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md —
-- PRD 5: Native Signal Routing.
--
-- Adds 2 tables:
--   1. signal_rules: if-this-then-that routing rules (Slack, Email, Webhook, HubSpot)
--   2. rule_executions: audit trail of rule evaluations and action dispatches
--
-- Adds 1 function (signal_rules_touch_updated_at) and 1 trigger.

-- ── 1. signal_rules ─────────────────────────────────────────────────────────
create table if not exists public.signal_rules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  workspace_id    uuid references public.workspaces(id) on delete cascade,
  name            text not null,
  status          text not null default 'active' check (status in ('active', 'paused')),
  trigger_source  text not null check (trigger_source in ('watchlist', 'bulk_enrichment', 'workflow_run')),
  conditions      jsonb not null default '[]'::jsonb,
  action_type     text not null check (action_type in ('slack', 'email', 'webhook', 'hubspot')),
  action_config   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists signal_rules_user_idx on public.signal_rules (user_id, created_at desc);
create index if not exists signal_rules_source_idx on public.signal_rules (trigger_source, status);

-- ── 2. rule_executions ──────────────────────────────────────────────────────
create table if not exists public.rule_executions (
  id              uuid primary key default gen_random_uuid(),
  rule_id         uuid not null references public.signal_rules(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'success' check (status in ('success', 'failed', 'skipped')),
  event_payload   jsonb not null default '{}'::jsonb,
  action_response jsonb not null default '{}'::jsonb,
  error           text,
  latency_ms      integer,
  executed_at     timestamptz not null default now()
);

create index if not exists rule_executions_rule_idx on public.rule_executions (rule_id, executed_at desc);
create index if not exists rule_executions_user_idx on public.rule_executions (user_id, executed_at desc);

-- ── helper trigger function ─────────────────────────────────────────────────
create or replace function public.signal_rules_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists signal_rules_touch_updated_at_trg on public.signal_rules;
create trigger signal_rules_touch_updated_at_trg
  before update on public.signal_rules
  for each row execute function public.signal_rules_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.signal_rules enable row level security;
alter table public.rule_executions enable row level security;

-- signal_rules policies
create policy signal_rules_owner_access on public.signal_rules
  for all using (user_id = auth.uid() or auth.uid() is null);

-- rule_executions policies
create policy rule_executions_owner_access on public.rule_executions
  for all using (user_id = auth.uid() or auth.uid() is null);

grant all on public.signal_rules to anon, authenticated, service_role;
grant all on public.rule_executions to anon, authenticated, service_role;
