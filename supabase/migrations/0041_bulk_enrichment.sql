-- 0041_bulk_enrichment.sql
-- Phase 4 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md —
-- PRD 3: Bulk Account Intelligence.
--
-- Adds 7 tables:
--   1. lists: workspace/user account lists
--   2. canonical_entities: deduplicated normalized company entities
--   3. list_records: per-account rows inside a list with ICP score & status
--   4. icp_score_rules: customer-editable ICP weighting criteria
--   5. enrichment_jobs: durable chunked runner jobs
--   6. enrichment_job_items: individual record execution states
--   7. review_queue: human confirmation queue for low-confidence facts
--
-- Adds 1 function (bulk_touch_updated_at) and 3 triggers.

-- ── 1. lists ────────────────────────────────────────────────────────────────
create table if not exists public.lists (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  workspace_id          uuid references public.workspaces(id) on delete cascade,
  name                  text not null,
  description           text,
  template_key          text not null default 'bulk_icp_enrichment',
  status                text not null default 'pending'
    check (status in ('pending', 'running', 'complete', 'partial', 'failed', 'paused')),
  total_records         integer not null default 0 check (total_records >= 0),
  completed_records     integer not null default 0 check (completed_records >= 0),
  failed_records        integer not null default 0 check (failed_records >= 0),
  needs_review_records  integer not null default 0 check (needs_review_records >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists lists_user_idx on public.lists (user_id, created_at desc);
create index if not exists lists_workspace_idx on public.lists (workspace_id) where workspace_id is not null;

-- ── 2. canonical_entities ───────────────────────────────────────────────────
create table if not exists public.canonical_entities (
  id                    uuid primary key default gen_random_uuid(),
  canonical_domain      text not null unique,
  company_name          text,
  normalized_name       text,
  industry              text,
  employee_range        text,
  hq_country            text,
  overview              text,
  enriched_payload      jsonb not null default '{}'::jsonb,
  last_enriched_at      timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists canonical_entities_domain_idx on public.canonical_entities (canonical_domain);

-- ── 3. list_records ─────────────────────────────────────────────────────────
create table if not exists public.list_records (
  id                    uuid primary key default gen_random_uuid(),
  list_id               uuid not null references public.lists(id) on delete cascade,
  raw_input             text not null,
  canonical_domain      text,
  status                text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'partial', 'failed', 'needs_review')),
  icp_score             numeric(5,2) check (icp_score is null or (icp_score >= 0 and icp_score <= 100)),
  icp_reasons           jsonb not null default '[]'::jsonb,
  enriched_data         jsonb not null default '{}'::jsonb,
  confidence_score      numeric(4,3) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  error                 text,
  credits_used          integer not null default 0 check (credits_used >= 0),
  run_id                text references public.template_runs(id) on delete set null,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz
);

create index if not exists list_records_list_idx on public.list_records (list_id, created_at asc);
create index if not exists list_records_status_idx on public.list_records (list_id, status);
create index if not exists list_records_domain_idx on public.list_records (canonical_domain) where canonical_domain is not null;

-- ── 4. icp_score_rules ──────────────────────────────────────────────────────
create table if not exists public.icp_score_rules (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references auth.users(id) on delete cascade,
  workspace_id          uuid references public.workspaces(id) on delete cascade,
  persona               text not null default 'default',
  name                  text not null,
  criteria              jsonb not null default '[]'::jsonb,
  threshold             numeric(5,2) not null default 50.00
    check (threshold >= 0 and threshold <= 100),
  is_default            boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists icp_score_rules_user_idx on public.icp_score_rules (user_id);
create index if not exists icp_score_rules_persona_idx on public.icp_score_rules (persona);

-- Seed default persona rules
insert into public.icp_score_rules (persona, name, criteria, threshold, is_default)
values
  ('sales', 'B2B Tech ICP Baseline', '[
    {"field": "industry", "operator": "in", "value": ["Software", "SaaS", "Fintech", "Technology"], "weight": 35},
    {"field": "employee_count", "operator": "gte", "value": 20, "weight": 25},
    {"field": "has_pricing", "operator": "equals", "value": true, "weight": 20},
    {"field": "has_contact", "operator": "equals", "value": true, "weight": 20}
  ]'::jsonb, 60.00, true),
  ('revops', 'Mid-Market Qualified ICP', '[
    {"field": "industry", "operator": "not_in", "value": ["Consumer", "Retail"], "weight": 30},
    {"field": "employee_count", "operator": "gte", "value": 50, "weight": 40},
    {"field": "hq_country", "operator": "in", "value": ["US", "CA", "GB", "EU"], "weight": 30}
  ]'::jsonb, 65.00, true),
  ('ci', 'Competitive Intelligence Monitor', '[
    {"field": "has_pricing", "operator": "equals", "value": true, "weight": 50},
    {"field": "has_product_tour", "operator": "equals", "value": true, "weight": 50}
  ]'::jsonb, 50.00, true),
  ('default', 'General ICP Criteria', '[
    {"field": "industry", "operator": "not_empty", "weight": 40},
    {"field": "employee_count", "operator": "gte", "value": 10, "weight": 30},
    {"field": "has_pricing", "operator": "equals", "value": true, "weight": 30}
  ]'::jsonb, 50.00, true)
on conflict do nothing;

-- ── 5. enrichment_jobs ──────────────────────────────────────────────────────
create table if not exists public.enrichment_jobs (
  id                    uuid primary key default gen_random_uuid(),
  list_id               uuid not null references public.lists(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  status                text not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'completed', 'failed')),
  batch_size            integer not null default 25 check (batch_size > 0),
  cursor                integer not null default 0 check (cursor >= 0),
  total_items           integer not null default 0 check (total_items >= 0),
  processed_items       integer not null default 0 check (processed_items >= 0),
  estimated_credits     integer not null default 0 check (estimated_credits >= 0),
  actual_credits        integer not null default 0 check (actual_credits >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists enrichment_jobs_list_idx on public.enrichment_jobs (list_id);
create index if not exists enrichment_jobs_status_idx on public.enrichment_jobs (status);

-- ── 6. enrichment_job_items ─────────────────────────────────────────────────
create table if not exists public.enrichment_job_items (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references public.enrichment_jobs(id) on delete cascade,
  record_id             uuid not null references public.list_records(id) on delete cascade,
  status                text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'skipped')),
  attempts              integer not null default 0 check (attempts >= 0),
  error                 text,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists enrichment_job_items_job_idx on public.enrichment_job_items (job_id, status);

-- ── 7. review_queue ─────────────────────────────────────────────────────────
create table if not exists public.review_queue (
  id                    uuid primary key default gen_random_uuid(),
  record_id             uuid not null references public.list_records(id) on delete cascade,
  list_id               uuid not null references public.lists(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  field_name            text not null,
  candidate_value       text,
  confidence            numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status                text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'edited')),
  resolved_value        text,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists review_queue_user_idx on public.review_queue (user_id, status);
create index if not exists review_queue_record_idx on public.review_queue (record_id);

-- ── helper trigger function ─────────────────────────────────────────────────
create or replace function public.bulk_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lists_touch_updated_at_trg on public.lists;
create trigger lists_touch_updated_at_trg
  before update on public.lists
  for each row execute function public.bulk_touch_updated_at();

drop trigger if exists icp_rules_touch_updated_at_trg on public.icp_score_rules;
create trigger icp_rules_touch_updated_at_trg
  before update on public.icp_score_rules
  for each row execute function public.bulk_touch_updated_at();

drop trigger if exists enrichment_jobs_touch_updated_at_trg on public.enrichment_jobs;
create trigger enrichment_jobs_touch_updated_at_trg
  before update on public.enrichment_jobs
  for each row execute function public.bulk_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.lists enable row level security;
alter table public.canonical_entities enable row level security;
alter table public.list_records enable row level security;
alter table public.icp_score_rules enable row level security;
alter table public.enrichment_jobs enable row level security;
alter table public.enrichment_job_items enable row level security;
alter table public.review_queue enable row level security;

-- lists policies
create policy lists_owner_access on public.lists
  for all using (user_id = auth.uid() or auth.uid() is null);

-- canonical_entities policies
create policy canonical_entities_select on public.canonical_entities
  for select using (true);

create policy canonical_entities_insert on public.canonical_entities
  for insert with check (auth.uid() is null or auth.uid() is not null);

create policy canonical_entities_update on public.canonical_entities
  for update using (auth.uid() is null or auth.uid() is not null);

-- list_records policies
create policy list_records_owner_access on public.list_records
  for all using (
    auth.uid() is null or exists (
      select 1 from public.lists l where l.id = list_records.list_id and l.user_id = auth.uid()
    )
  );

-- icp_score_rules policies
create policy icp_score_rules_select on public.icp_score_rules
  for select using (is_default = true or user_id = auth.uid() or auth.uid() is null);

create policy icp_score_rules_write on public.icp_score_rules
  for all using (user_id = auth.uid() or auth.uid() is null);

-- enrichment_jobs policies
create policy enrichment_jobs_owner_access on public.enrichment_jobs
  for all using (user_id = auth.uid() or auth.uid() is null);

-- enrichment_job_items policies
create policy enrichment_job_items_owner_access on public.enrichment_job_items
  for all using (
    auth.uid() is null or exists (
      select 1 from public.enrichment_jobs j where j.id = enrichment_job_items.job_id and j.user_id = auth.uid()
    )
  );

-- review_queue policies
create policy review_queue_owner_access on public.review_queue
  for all using (user_id = auth.uid() or auth.uid() is null);

grant all on public.lists to anon, authenticated, service_role;
grant all on public.canonical_entities to anon, authenticated, service_role;
grant all on public.list_records to anon, authenticated, service_role;
grant all on public.icp_score_rules to anon, authenticated, service_role;
grant all on public.enrichment_jobs to anon, authenticated, service_role;
grant all on public.enrichment_job_items to anon, authenticated, service_role;
grant all on public.review_queue to anon, authenticated, service_role;
