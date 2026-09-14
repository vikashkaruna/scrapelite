-- 0068_sxo_static_runs.sql — Search Experience Optimization (SXO) static audit runs (Stage 2 / P3A).
--
-- Governed by §11.14 of the P3 PRD:
-- 1. `sxo_total_score` is NULLABLE — unknown is never 0.
-- 2. `coverage` is NOT NULL — a score without coverage is a different measurement.
-- 3. `model_version` has NO DEFAULT — every writer must explicitly declare the version.
-- 4. RLS enabled, revoked from anon and authenticated, service_role access only.

-- 1. SXO runs table
create table if not exists public.audit_sxo_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text not null,
  subject_id text,
  target_id uuid references public.audit_targets(id) on delete set null,
  sxo_total_score numeric(5,1) check (sxo_total_score is null or (sxo_total_score >= 0 and sxo_total_score <= 100)),
  coverage numeric(5,1) not null check (coverage >= 0 and coverage <= 100),
  layer_scores jsonb not null default '{}'::jsonb,
  layer_results jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  weight_set_id text not null default 'sxo_default_v1',
  model_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_sxo_runs_user_audit_idx
  on public.audit_sxo_runs (user_id, audit_id);

create index if not exists audit_sxo_runs_workspace_idx
  on public.audit_sxo_runs (workspace_id)
  where workspace_id is not null;

create index if not exists audit_sxo_runs_subject_idx
  on public.audit_sxo_runs (subject_id)
  where subject_id is not null;

-- 2. Intent mappings table
create table if not exists public.audit_intent_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  subject_id text,
  intent_class text not null,
  target_url text not null,
  mapped_prompt_kinds jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_intent_mappings_user_subject_idx
  on public.audit_intent_mappings (user_id, subject_id);

-- 3. Page templates table
create table if not exists public.audit_page_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  template_key text not null,
  label text not null,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists audit_page_templates_user_key_idx
  on public.audit_page_templates (user_id, template_key)
  where workspace_id is null;

create unique index if not exists audit_page_templates_workspace_key_idx
  on public.audit_page_templates (workspace_id, template_key)
  where workspace_id is not null;

-- 4. RLS and Security lockdown
alter table public.audit_sxo_runs enable row level security;
alter table public.audit_intent_mappings enable row level security;
alter table public.audit_page_templates enable row level security;

revoke all on public.audit_sxo_runs from anon, authenticated;
revoke all on public.audit_intent_mappings from anon, authenticated;
revoke all on public.audit_page_templates from anon, authenticated;

grant select, insert, update, delete on public.audit_sxo_runs to service_role;
grant select, insert, update, delete on public.audit_intent_mappings to service_role;
grant select, insert, update, delete on public.audit_page_templates to service_role;
