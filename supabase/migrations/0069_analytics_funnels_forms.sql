-- 0069_analytics_funnels_forms.sql — Analytics, Journey Funnels, Form Diagnostics & Goals (Stage 3 / P3B).
--
-- Governed by §11.8, §11.9, §11.14 & §13 of the P3 PRD:
-- 1. Aggregates ONLY. No raw session rows, IP addresses, or visitor PII (§10 / §11.8).
-- 2. Credentials and OAuth tokens in audit_analytics_connections are encrypted at rest.
-- 3. RLS enabled, revoked from anon and authenticated, service_role access only.

-- 1. Conversion goals table (§11.14: conversion_goals)
create table if not exists public.audit_conversion_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text,
  subject_id text,
  name text not null,
  outcome_type text not null,
  target_url text,
  target_selector text,
  target_event text,
  value_cents integer default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_conversion_goals_user_idx
  on public.audit_conversion_goals (user_id);

create index if not exists audit_conversion_goals_workspace_idx
  on public.audit_conversion_goals (workspace_id)
  where workspace_id is not null;

-- 2. Analytics connections table (§11.14: analytics_connections)
create table if not exists public.audit_analytics_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  provider text not null,
  provider_account_id text,
  encrypted_token text,
  token_fingerprint text not null,
  status text not null default 'connected',
  settings jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_analytics_connections_user_idx
  on public.audit_analytics_connections (user_id);

create index if not exists audit_analytics_connections_workspace_idx
  on public.audit_analytics_connections (workspace_id)
  where workspace_id is not null;

-- 3. Analytics event mappings table (§11.14: analytics_event_mappings)
create table if not exists public.audit_analytics_event_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  connection_id uuid references public.audit_analytics_connections(id) on delete cascade,
  source_event_name text not null,
  normalized_event_name text not null,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_analytics_event_mappings_user_idx
  on public.audit_analytics_event_mappings (user_id);

-- 4. Analytics aggregates table (§11.14: analytics_aggregates)
-- Aggregates only across the 7 segmentation axes.
create table if not exists public.audit_analytics_aggregates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text,
  subject_id text,
  date_bucket date not null default current_date,
  landing_page text not null default '/',
  source_channel text not null default 'direct',
  device text not null default 'all',
  region text not null default 'global',
  visitor_type text not null default 'all',
  conversion_goal_id uuid references public.audit_conversion_goals(id) on delete set null,
  event_counts jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_analytics_aggregates_user_audit_idx
  on public.audit_analytics_aggregates (user_id, audit_id);

create index if not exists audit_analytics_aggregates_workspace_idx
  on public.audit_analytics_aggregates (workspace_id)
  where workspace_id is not null;

-- 5. Journey funnels table (§11.14: journey_funnels)
create table if not exists public.audit_journey_funnels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text not null,
  subject_id text,
  funnel_name text not null default 'standard_9_stage',
  stage_results jsonb not null default '[]'::jsonb,
  overall_conversion_rate numeric(5,2),
  mi_score numeric(5,1),
  mi_caveats jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_journey_funnels_user_audit_idx
  on public.audit_journey_funnels (user_id, audit_id);

create index if not exists audit_journey_funnels_workspace_idx
  on public.audit_journey_funnels (workspace_id)
  where workspace_id is not null;

-- 6. Form diagnostics table (§11.14: form_diagnostics)
create table if not exists public.audit_form_diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text not null,
  form_id text not null,
  form_name text,
  page_url text not null,
  metrics jsonb not null default '{}'::jsonb,
  field_diagnostics jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_form_diagnostics_user_audit_idx
  on public.audit_form_diagnostics (user_id, audit_id);

create index if not exists audit_form_diagnostics_workspace_idx
  on public.audit_form_diagnostics (workspace_id)
  where workspace_id is not null;

-- RLS and Permission lockdown on all 6 tables
alter table public.audit_conversion_goals enable row level security;
alter table public.audit_analytics_connections enable row level security;
alter table public.audit_analytics_event_mappings enable row level security;
alter table public.audit_analytics_aggregates enable row level security;
alter table public.audit_journey_funnels enable row level security;
alter table public.audit_form_diagnostics enable row level security;

revoke all on table public.audit_conversion_goals from public, anon, authenticated;
revoke all on table public.audit_analytics_connections from public, anon, authenticated;
revoke all on table public.audit_analytics_event_mappings from public, anon, authenticated;
revoke all on table public.audit_analytics_aggregates from public, anon, authenticated;
revoke all on table public.audit_journey_funnels from public, anon, authenticated;
revoke all on table public.audit_form_diagnostics from public, anon, authenticated;

grant all on table public.audit_conversion_goals to service_role;
grant all on table public.audit_analytics_connections to service_role;
grant all on table public.audit_analytics_event_mappings to service_role;
grant all on table public.audit_analytics_aggregates to service_role;
grant all on table public.audit_journey_funnels to service_role;
grant all on table public.audit_form_diagnostics to service_role;
