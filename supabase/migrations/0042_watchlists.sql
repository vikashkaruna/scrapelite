-- 0042_watchlists.sql
-- Phase 5 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md —
-- PRD 4: Competitor Watchlists & Change Intelligence.
--
-- Adds 6 tables:
--   1. watchlists: named competitor tracking lists with cadence
--   2. watchlist_targets: monitored competitor domains
--   3. monitored_pages: discovered category pages (pricing, product, positioning)
--   4. entity_snapshots: structured snapshots (not bare HTML hashes)
--   5. field_changes: detected field deltas with materiality & fact vs interpretation
--   6. change_feedback: human signal tuning (useful / not_useful / mute_field)
--
-- Adds 1 function (watchlists_touch_updated_at) and 1 trigger.

-- ── 1. watchlists ───────────────────────────────────────────────────────────
create table if not exists public.watchlists (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  name          text not null,
  description   text,
  cadence       text not null default 'daily' check (cadence in ('hourly', 'daily', 'weekly')),
  status        text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists watchlists_user_idx on public.watchlists (user_id, created_at desc);
create index if not exists watchlists_workspace_idx on public.watchlists (workspace_id) where workspace_id is not null;

-- ── 2. watchlist_targets ───────────────────────────────────────────────────
create table if not exists public.watchlist_targets (
  id              uuid primary key default gen_random_uuid(),
  watchlist_id    uuid not null references public.watchlists(id) on delete cascade,
  domain          text not null,
  company_name    text,
  status          text not null default 'active' check (status in ('active', 'paused', 'error')),
  last_checked_at timestamptz,
  created_at      timestamptz not null default now(),
  constraint watchlist_targets_unique_domain unique (watchlist_id, domain)
);

create index if not exists watchlist_targets_watchlist_idx on public.watchlist_targets (watchlist_id);
create index if not exists watchlist_targets_domain_idx on public.watchlist_targets (domain);

-- ── 3. monitored_pages ─────────────────────────────────────────────────────
create table if not exists public.monitored_pages (
  id              uuid primary key default gen_random_uuid(),
  target_id       uuid not null references public.watchlist_targets(id) on delete cascade,
  url             text not null,
  category        text not null check (category in ('pricing', 'product', 'positioning', 'terms', 'other')),
  content_hash    text,
  last_fetched_at timestamptz,
  http_status     integer,
  created_at      timestamptz not null default now(),
  constraint monitored_pages_unique_url unique (target_id, url)
);

create index if not exists monitored_pages_target_idx on public.monitored_pages (target_id);

-- ── 4. entity_snapshots ────────────────────────────────────────────────────
create table if not exists public.entity_snapshots (
  id              uuid primary key default gen_random_uuid(),
  target_id       uuid not null references public.watchlist_targets(id) on delete cascade,
  page_id         uuid not null references public.monitored_pages(id) on delete cascade,
  snapshot_type   text not null check (snapshot_type in ('pricing', 'product', 'positioning')),
  extracted_data  jsonb not null default '{}'::jsonb,
  content_hash    text not null,
  created_at      timestamptz not null default now()
);

create index if not exists entity_snapshots_target_idx on public.entity_snapshots (target_id, created_at desc);

-- ── 5. field_changes ───────────────────────────────────────────────────────
create table if not exists public.field_changes (
  id                uuid primary key default gen_random_uuid(),
  target_id         uuid not null references public.watchlist_targets(id) on delete cascade,
  watchlist_id      uuid not null references public.watchlists(id) on delete cascade,
  field_name        text not null,
  category          text not null check (category in ('pricing', 'product', 'positioning', 'other')),
  old_value         text,
  new_value         text,
  materiality       text not null default 'medium' check (materiality in ('critical', 'high', 'medium', 'low', 'unknown')),
  fact_summary      text not null,
  ai_interpretation text,
  detected_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists field_changes_watchlist_idx on public.field_changes (watchlist_id, detected_at desc);
create index if not exists field_changes_target_idx on public.field_changes (target_id, detected_at desc);
create index if not exists field_changes_materiality_idx on public.field_changes (materiality);

-- ── 6. change_feedback ─────────────────────────────────────────────────────
create table if not exists public.change_feedback (
  id              uuid primary key default gen_random_uuid(),
  field_change_id uuid not null references public.field_changes(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  feedback        text not null check (feedback in ('useful', 'not_useful', 'mute_field')),
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists change_feedback_change_idx on public.change_feedback (field_change_id);
create index if not exists change_feedback_user_idx on public.change_feedback (user_id);

-- ── helper trigger function ─────────────────────────────────────────────────
create or replace function public.watchlists_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists watchlists_touch_updated_at_trg on public.watchlists;
create trigger watchlists_touch_updated_at_trg
  before update on public.watchlists
  for each row execute function public.watchlists_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.watchlists enable row level security;
alter table public.watchlist_targets enable row level security;
alter table public.monitored_pages enable row level security;
alter table public.entity_snapshots enable row level security;
alter table public.field_changes enable row level security;
alter table public.change_feedback enable row level security;

-- watchlists policies
create policy watchlists_owner_access on public.watchlists
  for all using (user_id = auth.uid() or auth.uid() is null);

-- watchlist_targets policies
create policy watchlist_targets_owner_access on public.watchlist_targets
  for all using (
    auth.uid() is null or exists (
      select 1 from public.watchlists w where w.id = watchlist_targets.watchlist_id and w.user_id = auth.uid()
    )
  );

-- monitored_pages policies
create policy monitored_pages_owner_access on public.monitored_pages
  for all using (
    auth.uid() is null or exists (
      select 1 from public.watchlist_targets t
      join public.watchlists w on w.id = t.watchlist_id
      where t.id = monitored_pages.target_id and w.user_id = auth.uid()
    )
  );

-- entity_snapshots policies
create policy entity_snapshots_owner_access on public.entity_snapshots
  for all using (
    auth.uid() is null or exists (
      select 1 from public.watchlist_targets t
      join public.watchlists w on w.id = t.watchlist_id
      where t.id = entity_snapshots.target_id and w.user_id = auth.uid()
    )
  );

-- field_changes policies
create policy field_changes_owner_access on public.field_changes
  for all using (
    auth.uid() is null or exists (
      select 1 from public.watchlists w where w.id = field_changes.watchlist_id and w.user_id = auth.uid()
    )
  );

-- change_feedback policies
create policy change_feedback_owner_access on public.change_feedback
  for all using (user_id = auth.uid() or auth.uid() is null);

grant all on public.watchlists to anon, authenticated, service_role;
grant all on public.watchlist_targets to anon, authenticated, service_role;
grant all on public.monitored_pages to anon, authenticated, service_role;
grant all on public.entity_snapshots to anon, authenticated, service_role;
grant all on public.field_changes to anon, authenticated, service_role;
grant all on public.change_feedback to anon, authenticated, service_role;
