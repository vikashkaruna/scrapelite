-- ScrapeLite V5 + V5c database migrations
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- All statements are idempotent (safe to run multiple times).

-- ── V2: extractions table columns (safe if already exist) ─────────────────────
alter table public.extractions add column if not exists custom_extraction jsonb;
alter table public.extractions add column if not exists domain_map        jsonb;
alter table public.extractions add column if not exists enrichments       jsonb;

-- ── V5: Usage tracking ────────────────────────────────────────────────────────
create table if not exists public.usage_records (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  month       text not null,
  extractions integer not null default 0,
  enrichments integer not null default 0,
  plan_id     text not null default 'free',
  updated_at  timestamptz not null default now(),
  unique(session_id, month)
);
alter table public.usage_records enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'usage_records' and policyname = 'anon full access'
  ) then
    execute 'create policy "anon full access" on public.usage_records
             for all using (true) with check (true)';
  end if;
end $$;

-- ── V5: Alert preferences ─────────────────────────────────────────────────────
create table if not exists public.usage_alerts (
  id               uuid primary key default gen_random_uuid(),
  session_id       text not null unique,
  email            text not null,
  thresholds       integer[] not null default '{80,95}',
  enabled          boolean not null default true,
  last_notified_at timestamptz
);
alter table public.usage_alerts enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'usage_alerts' and policyname = 'anon full access'
  ) then
    execute 'create policy "anon full access" on public.usage_alerts
             for all using (true) with check (true)';
  end if;
end $$;

-- ── V5c: Payment subscriptions ────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  session_id               text not null unique,
  plan_id                  text,
  status                   text,
  provider                 text,
  provider_subscription_id text,
  provider_customer_id     text,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);
alter table public.subscriptions enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'subscriptions' and policyname = 'anon full access'
  ) then
    execute 'create policy "anon full access" on public.subscriptions
             for all using (true) with check (true)';
  end if;
end $$;

-- ── V5c: Payment event audit log ──────────────────────────────────────────────
create table if not exists public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  session_id        text,
  event_type        text,
  provider          text,
  provider_event_id text,
  plan_id           text,
  amount_cents      integer,
  currency          text,
  status            text,
  created_at        timestamptz default now()
);
alter table public.payment_events enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'payment_events' and policyname = 'anon full access'
  ) then
    execute 'create policy "anon full access" on public.payment_events
             for all using (true) with check (true)';
  end if;
end $$;
