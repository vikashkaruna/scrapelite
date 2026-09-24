-- 0085_rule_sources.sql — real links between signal rules and the lists /
-- watchlists they listen to (docs/ENGAGEMENT-AND-WORKFLOWS-UX-PLAN.md §6b).
--
-- Until now a rule listened to a KIND of event — every watchlist, or every
-- list — so "this rule is for these two watchlists" could not be expressed and
-- deleting a watchlist could not say which rules used it.
--
--   signal_rules.source_scope   'all' (today's behaviour; every existing rule
--                               keeps it) | 'selected' (only linked sources)
--   signal_rules.paused_reason  why the platform paused a rule ('no_sources')
--   signal_rule_sources         one row per (rule, list | watchlist)
--
-- ── TWO REAL FOREIGN KEYS, NOT A POLYMORPHIC UUID ───────────────────────────
-- A bare (source_type, source_id) pair is a pointer Postgres cannot check.
-- Each link carries list_id OR watchlist_id, exactly one, both real FKs, so a
-- link can never point at a row that does not exist.
--
-- ── A RULE NEVER WIDENS SILENTLY ────────────────────────────────────────────
-- If a scoped rule loses its last linked source — by an unlink, or because the
-- list/watchlist was deleted — it must not fall back to "all". The dispatcher
-- already matches nothing for a scoped rule with no sources; this trigger also
-- PAUSES it with a reason the UI shows, so nobody wonders why it stopped.
--
-- Additive: two columns with defaults, one table, one function, one trigger.
-- Re-runnable.

alter table public.signal_rules
  add column if not exists source_scope text not null default 'all',
  add column if not exists paused_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'signal_rules_source_scope_check') then
    alter table public.signal_rules
      add constraint signal_rules_source_scope_check check (source_scope in ('all', 'selected'));
  end if;
end $$;

create table if not exists public.signal_rule_sources (
  id            uuid primary key default gen_random_uuid(),
  rule_id       uuid not null references public.signal_rules(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  list_id       uuid references public.lists(id) on delete cascade,
  watchlist_id  uuid references public.watchlists(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint signal_rule_sources_exactly_one check (num_nonnulls(list_id, watchlist_id) = 1),
  constraint signal_rule_sources_unique unique nulls not distinct (rule_id, list_id, watchlist_id)
);

create index if not exists signal_rule_sources_list_idx on public.signal_rule_sources (list_id) where list_id is not null;
create index if not exists signal_rule_sources_watchlist_idx on public.signal_rule_sources (watchlist_id) where watchlist_id is not null;
create index if not exists signal_rule_sources_user_idx on public.signal_rule_sources (user_id);

-- Service-role only, the 0044 pattern: the browser reaches this through
-- Netlify Functions, never directly.
revoke all on public.signal_rule_sources from anon;
revoke all on public.signal_rule_sources from authenticated;
grant all on public.signal_rule_sources to service_role;
alter table public.signal_rule_sources enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'signal_rule_sources' and policyname = 'service full access') then
    create policy "service full access" on public.signal_rule_sources
      for all to service_role using (true) with check (true);
  end if;
end $$;

-- ── No silent widening ──────────────────────────────────────────────────────
create or replace function public.signal_rule_sources_pause_orphans()
returns trigger language plpgsql as $$
begin
  update public.signal_rules r
     set status = 'paused', paused_reason = 'no_sources'
   where r.id = old.rule_id
     and r.source_scope = 'selected'
     and r.status = 'active'
     and not exists (select 1 from public.signal_rule_sources s where s.rule_id = r.id);
  return null;
end $$;

drop trigger if exists signal_rule_sources_pause_orphans on public.signal_rule_sources;
create trigger signal_rule_sources_pause_orphans
  after delete on public.signal_rule_sources
  for each row execute function public.signal_rule_sources_pause_orphans();
