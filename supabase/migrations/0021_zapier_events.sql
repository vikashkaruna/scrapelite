-- 0021_zapier_events.sql
-- Event log for the Zapier integration. Triggers (new_extraction,
-- new_enrichment, monitoring_alert) append rows here; Zapier polls them
-- via /api/integrations/zapier/poll.

create table if not exists public.zapier_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_type  text not null check (event_type in ('new_extraction','new_enrichment','monitoring_alert')),
  payload     jsonb not null,
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  unique (user_id, event_type, dedupe_key)
);

create index if not exists zapier_events_user_type_time_idx
  on public.zapier_events (user_id, event_type, created_at desc);

alter table public.zapier_events enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'zapier_events' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.zapier_events
             for all to service_role using (true) with check (true)';
  end if;
end $$;
