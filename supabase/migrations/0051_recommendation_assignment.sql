-- 0051_recommendation_assignment.sql — W5.5. The assign verb.
--
-- §7.6 lists the Recommendation Studio's acceptance verbs: copy, export,
-- accept, dismiss, mark implemented — all shipped — and **assign**, which was
-- not. A queue you cannot hand to anybody is a personal to-do list.
--
-- ── WHY A USER AND NOT A ROLE ──────────────────────────────────────────────
-- W4 added `audit_issues.owner_role`, which says a fix belongs to Engineering
-- or Content. That is a CLASSIFICATION, and it is per issue CODE — every
-- noindex finding everywhere has the same owner role. It cannot answer "who is
-- doing this one", which is the question a queue exists to settle.
--
-- Decision D6 defers the PRD's seven-role RBAC to P2, so this deliberately adds
-- no role system. It adds one nullable pointer to a real person, reusing
-- `workspace_members` (migration 0031). When P2's RBAC arrives it layers on
-- top of an assignee that already exists, rather than having to backfill one.
--
-- ── on delete set null, NOT cascade ────────────────────────────────────────
-- A person leaving must not delete the recommendation they were holding. It
-- becomes unassigned and returns to the queue, which is what actually happens
-- in the room. `on delete cascade` here would quietly destroy audit findings
-- as a side effect of offboarding.

alter table public.audit_recommendations
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

comment on column public.audit_recommendations.assigned_to is
  'The person holding this fix. NULL means unassigned, which is the default and the resting state. Set only to a user who shares a workspace with the owner (enforced by assign_recommendation); nulled automatically if that account is deleted, so offboarding never destroys a finding.';

alter table public.audit_recommendations
  add column if not exists assigned_at timestamptz;

comment on column public.audit_recommendations.assigned_at is
  'When the current assignee took it. NULL whenever assigned_to is NULL. Kept beside the pointer rather than derived from the event log so the queue can sort by it without a join.';

-- Partial: the overwhelming majority of rows are unassigned, and "show me what
-- I am holding" is the only query this index has to serve.
create index if not exists audit_recommendations_assignee_idx
  on public.audit_recommendations (assigned_to)
  where assigned_to is not null;

-- ── The assignment itself ──────────────────────────────────────────────────
--
-- 🔴 THE SHARED-WORKSPACE CHECK LIVES HERE, NOT ONLY IN THE HANDLER.
-- Without it, `assigned_to` accepts any uuid in auth.users, which turns the
-- endpoint into a membership oracle: assign, read back the result, and learn
-- whether an id is a real account. This repo has already shipped that class of
-- defect — four IDORs in Phases 4-6, one of which took no user id at all — and
-- the fix that stuck was the one the database enforced.
--
-- Returns 'ok' | 'not_found' | 'not_a_member'. Callers map not_found to 404 and
-- never to 403: a 403 confirms the id is real, which is how an id space gets
-- enumerated.
create or replace function public.assign_recommendation(
  p_user_id uuid,
  p_rec_id uuid,
  p_assignee uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner
    from public.audit_recommendations
   where id = p_rec_id and user_id = p_user_id;

  if v_owner is null then
    return 'not_found';
  end if;

  -- Unassigning is always allowed: you can always put work down.
  if p_assignee is null then
    update public.audit_recommendations
       set assigned_to = null, assigned_at = null
     where id = p_rec_id;
    return 'ok';
  end if;

  -- Assigning to yourself needs no workspace at all. A solo operator has no
  -- workspace rows, and refusing them their own queue would be absurd.
  if p_assignee <> p_user_id then
    if not exists (
      select 1
        from public.workspace_members me
        join public.workspace_members them
          on them.workspace_id = me.workspace_id
       where me.user_id = p_user_id
         and them.user_id = p_assignee
    ) then
      return 'not_a_member';
    end if;
  end if;

  update public.audit_recommendations
     set assigned_to = p_assignee, assigned_at = now()
   where id = p_rec_id;

  return 'ok';
end;
$$;

comment on function public.assign_recommendation(uuid, uuid, uuid) is
  'Assign a recommendation to a person who shares a workspace with its owner, or to the owner themselves. Returns ok | not_found | not_a_member. The membership check is here rather than only in the handler so the column cannot be set to an arbitrary account id by any path.';

revoke all on function public.assign_recommendation(uuid, uuid, uuid) from public, anon, authenticated;
