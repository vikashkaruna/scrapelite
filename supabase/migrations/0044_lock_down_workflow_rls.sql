-- 0044_lock_down_workflow_rls.sql
--
-- SECURITY FIX. Migrations 0041 (bulk enrichment), 0042 (watchlists) and 0043
-- (signal rules) shipped fifteen tables that are readable AND writable by any
-- anonymous caller holding the publishable anon key — which is committed to
-- this repository and served in every browser bundle by design.
--
-- Two independent mistakes combined, and either alone would have been enough:
--
--   1.  grant all on public.<table> to anon, authenticated, service_role;
--       Phases 0-3 (0036-0040) grant nothing to anon at all.
--
--   2.  create policy ... for all using (user_id = auth.uid() or auth.uid() is null)
--       `auth.uid()` IS null for the anon role. The clause that reads like a
--       local-development convenience is in fact "…or the caller is anonymous",
--       so the policy evaluates TRUE for every row for exactly the caller it
--       was meant to exclude. `canonical_entities_insert`'s
--       `with check (auth.uid() is null or auth.uid() is not null)` is a
--       tautology — literally `true`.
--
-- Verified exploitable against the staging project on 2026-09-04, read-only:
--   GET /rest/v1/lists?select=id&limit=1   with only the public anon key
--   → HTTP 200, real row ids. No Authorization header, no session.
-- Reads were confirmed; the same policy grants insert, update and delete.
--
-- The rule this restores is already locked in this repo (0029_referrals.sql,
-- 0031_team_workspaces.sql, and 0036-0040): the browser NEVER reaches these
-- tables directly — it goes through a Netlify Function, which uses the service
-- key. An anon policy is therefore not a convenience, it is pure unused attack
-- surface. Ownership is enforced in the handler, and RLS is the second line.
--
-- Idempotent and safe to re-run. Drops the permissive policies by name, revokes
-- the grants, and installs the service-role-only policy the rest of the schema
-- uses.

-- ── 1. Drop every permissive policy from 0041-0043 ──────────────────────────
drop policy if exists lists_owner_access                on public.lists;
drop policy if exists canonical_entities_select         on public.canonical_entities;
drop policy if exists canonical_entities_insert         on public.canonical_entities;
drop policy if exists canonical_entities_update         on public.canonical_entities;
drop policy if exists list_records_owner_access         on public.list_records;
drop policy if exists icp_score_rules_select            on public.icp_score_rules;
drop policy if exists icp_score_rules_write             on public.icp_score_rules;
drop policy if exists enrichment_jobs_owner_access      on public.enrichment_jobs;
drop policy if exists enrichment_job_items_owner_access on public.enrichment_job_items;
drop policy if exists review_queue_owner_access         on public.review_queue;

drop policy if exists watchlists_owner_access           on public.watchlists;
drop policy if exists watchlist_targets_owner_access    on public.watchlist_targets;
drop policy if exists monitored_pages_owner_access      on public.monitored_pages;
drop policy if exists entity_snapshots_owner_access     on public.entity_snapshots;
drop policy if exists field_changes_owner_access        on public.field_changes;
drop policy if exists change_feedback_owner_access      on public.change_feedback;

drop policy if exists signal_rules_owner_access         on public.signal_rules;
drop policy if exists rule_executions_owner_access      on public.rule_executions;

-- ── 2. Revoke the anon/authenticated grants ─────────────────────────────────
-- `revoke` on a role that was never granted is a no-op, so this is safe even
-- if a prior partial fix has already run.
do $$
declare t text;
begin
  foreach t in array array[
    'lists','canonical_entities','list_records','icp_score_rules',
    'enrichment_jobs','enrichment_job_items','review_queue',
    'watchlists','watchlist_targets','monitored_pages','entity_snapshots',
    'field_changes','change_feedback',
    'signal_rules','rule_executions'
  ]
  loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ── 3. Re-assert RLS and install service-role-only policies ─────────────────
-- Matches 0036-0040 exactly. `to service_role` is the load-bearing clause: a
-- policy without it applies to PUBLIC, which is every role.
do $$
declare t text;
begin
  foreach t in array array[
    'lists','canonical_entities','list_records','icp_score_rules',
    'enrichment_jobs','enrichment_job_items','review_queue',
    'watchlists','watchlist_targets','monitored_pages','entity_snapshots',
    'field_changes','change_feedback',
    'signal_rules','rule_executions'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t
         and policyname = 'service full access'
    ) then
      execute format(
        'create policy "service full access" on public.%I '
        'for all to service_role using (true) with check (true)', t);
    end if;
  end loop;
end $$;
