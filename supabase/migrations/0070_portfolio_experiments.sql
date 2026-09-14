-- 0070_portfolio_experiments.sql — Portfolio rollups and optimization experiments (Stage 4 / P3C).
--
-- Governed by §11.10, §11.12, §11.14 of the P3 PRD:
-- 1. Portfolio rollups materialize across the 9 rollup axes on workspace_id.
-- 2. Optimization experiments record changes, observation periods, and expected metrics.
-- 3. RLS enabled, revoked from anon and authenticated, service_role access only.

-- 1. Portfolio rollups table (§11.14: portfolio_rollups)
create table if not exists public.audit_portfolio_rollups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  rollup_axis text not null check (rollup_axis in ('workspace', 'brand', 'business_unit', 'product_line', 'service_line', 'location', 'market_language', 'template', 'owner_team')),
  axis_value text not null,
  audit_count integer not null default 0,
  master_score numeric(5,1),
  layer_scores jsonb not null default '{}'::jsonb,
  framework_scores jsonb not null default '{}'::jsonb,
  coverage numeric(5,1) not null default 0,
  calculated_at timestamptz not null default now()
);

create index if not exists audit_portfolio_rollups_user_axis_idx
  on public.audit_portfolio_rollups (user_id, rollup_axis);

create index if not exists audit_portfolio_rollups_workspace_idx
  on public.audit_portfolio_rollups (workspace_id)
  where workspace_id is not null;

-- 2. Optimization experiments table (§11.14: optimization_experiments)
create table if not exists public.audit_optimization_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  audit_id text,
  recommendation_id uuid references public.audit_recommendations(id) on delete set null,
  experiment_name text not null,
  ticket_url text,
  hypothesis text,
  expected_metric text not null default 'sxo_total_score',
  baseline_value numeric(8,2),
  current_value numeric(8,2),
  status text not null default 'active' check (status in ('draft', 'active', 'completed', 'cancelled')),
  observation_period_days integer not null default 28 check (observation_period_days > 0),
  start_date timestamptz not null default now(),
  completion_date timestamptz,
  relationship text not null default 'correlation',
  caveats jsonb not null default '[]'::jsonb,
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_optimization_experiments_user_idx
  on public.audit_optimization_experiments (user_id);

create index if not exists audit_optimization_experiments_workspace_idx
  on public.audit_optimization_experiments (workspace_id)
  where workspace_id is not null;

create index if not exists audit_optimization_experiments_audit_idx
  on public.audit_optimization_experiments (audit_id)
  where audit_id is not null;

-- RLS and Permission lockdown
alter table public.audit_portfolio_rollups enable row level security;
alter table public.audit_optimization_experiments enable row level security;

revoke all on public.audit_portfolio_rollups from anon, authenticated;
revoke all on public.audit_optimization_experiments from anon, authenticated;

grant select, insert, update, delete on public.audit_portfolio_rollups to service_role;
grant select, insert, update, delete on public.audit_optimization_experiments to service_role;
