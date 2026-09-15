-- 0076_endpoint_self_approval_and_directory_ignores.sql
--
-- Two fixes for the Discoverability workspace tabs.
--
-- ── 1. Approving a relationship could FAIL WITH A RAW CHECK VIOLATION ───────
-- approve_entity_relationship approves the edge AND any still-proposed
-- endpoint under the same reviewer. 0074 let a single founder self-approve the
-- EDGE with a "[Single-founder approval]" note, and 0075 did the same for
-- entities — but the function never asked whether the reviewer had proposed an
-- ENDPOINT. When a teammate proposed the edge and the reviewer had proposed one
-- of its entities, the panel sent the ordinary note, the endpoint UPDATE hit
-- audit_entities_no_self_approval, and the whole call raised 23514. The route
-- read that as a storage failure and the user saw "couldn't save".
--
-- Reproduced against real Postgres before this migration was written. The fix
-- asks the question up front and returns a VERDICT, so the refusal is explicit
-- and actionable rather than an exception. The single-founder note still
-- covers both halves, exactly as 0074/0075 intend.
--
-- ── 2. Directory sources a business does not use ───────────────────────────
-- The source registry is regional, not per-business: Practo, Zomato and
-- MagicBricks are real directories and irrelevant to a SaaS company. A user
-- can now IGNORE a source for a truth record, with a reason, and the NAP check
-- excludes it. An ignore is a recorded decision, not a deletion: it is
-- per-record, reversible (delete the row), and keeps who decided and why.
-- Columns-only arbiter (NULLS NOT DISTINCT) so a PostgREST upsert can use it —
-- the lesson 0059 recorded.

create or replace function public.approve_entity_relationship(
  p_relationship_id uuid,
  p_reviewer_id     uuid,
  p_note            text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    text;
  v_proposer uuid;
  v_subject  uuid;
  v_object   uuid;
  v_bad      integer;
  v_own_ends integer;
  v_founder  boolean := p_note is not null and p_note like '%[Single-founder approval]%';
begin
  select state, proposed_by, subject_id, object_id
    into v_state, v_proposer, v_subject, v_object
    from public.audit_entity_relationships
   where id = p_relationship_id
   for update;

  if v_state is null then
    return 'not_found';
  end if;

  if v_state = 'approved' then
    return 'ok';
  end if;

  if v_state = 'rejected' then
    return 'rejected';
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id and not v_founder then
    return 'self_approval';
  end if;

  select count(*) into v_bad
    from public.audit_entities
   where id in (v_subject, v_object) and state = 'rejected';
  if v_bad > 0 then
    return 'endpoint_rejected';
  end if;

  -- The endpoint half of the self-approval rule, asked BEFORE any write so it
  -- is a verdict and never a constraint violation.
  select count(*) into v_own_ends
    from public.audit_entities
   where id in (v_subject, v_object)
     and state = 'proposed'
     and proposed_by = p_reviewer_id;
  if v_own_ends > 0 and not v_founder then
    return 'endpoint_self_approval';
  end if;

  update public.audit_entities
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id in (v_subject, v_object)
     and state = 'proposed';

  update public.audit_entity_relationships
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_relationship_id;

  return 'ok';
end;
$$;

revoke all on function public.approve_entity_relationship(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_entity_relationship(uuid, uuid, text) to service_role;

create table if not exists public.audit_directory_source_ignores (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,
  truth_record_id  uuid references public.audit_business_truth_records(id) on delete cascade,
  source_id        text not null check (length(btrim(source_id)) > 0),
  -- A decision nobody can explain three months later is indistinguishable from
  -- a mis-click, so the reason is required — same rule as a rejection.
  reason           text not null check (length(btrim(reason)) > 0),
  ignored_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint audit_dir_source_ignore_unique
    unique nulls not distinct (user_id, truth_record_id, source_id)
);

create index if not exists audit_dir_source_ignores_owner_idx
  on public.audit_directory_source_ignores (user_id, truth_record_id);
create index if not exists audit_dir_source_ignores_workspace_idx
  on public.audit_directory_source_ignores (workspace_id, truth_record_id)
  where workspace_id is not null;

comment on table public.audit_directory_source_ignores is
  'Directory sources a user has marked not applicable to a business truth record, with the reason. Excluded from NAP checks; reversible by deleting the row.';

alter table public.audit_directory_source_ignores enable row level security;

drop policy if exists audit_dir_source_ignores_service on public.audit_directory_source_ignores;
create policy audit_dir_source_ignores_service on public.audit_directory_source_ignores
  for all to service_role using (true) with check (true);

revoke all on public.audit_directory_source_ignores from anon, authenticated;
grant select, insert, update, delete on public.audit_directory_source_ignores to service_role;
