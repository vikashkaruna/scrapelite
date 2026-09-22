-- 0077_approve_entity_richer_verdicts.sql
--
-- Richer verdict codes from public.approve_entity so the UI can tell the user
-- what is actually blocking the approval instead of showing a generic
-- "Could not approve the entity." This is the server-side half of the
-- 2026-09-22 plan to give entity-graph approvals actionable error messages.
--
-- 🔴 THE PROBLEM THIS FIXES. 0075 defined approve_entity with five verdict
-- strings: not_found, ok, rejected, no_approver, self_approval. The route
-- already had a VERDICTS map that translated each into a 4xx + message — but
-- auditStore.js swallowed the self_approval verdict (and auditStore.js
-- swallowed the endpoint_self_approval verdict on relationships) and fell
-- through to a direct DB PATCH. When the PATCH hit audit_entities_no_self_approval
-- it raised 23514 with a raw Postgres message; when it didn't, it succeeded
-- silently against the user's intent. Either way the user saw a generic
-- "Could not approve the entity" and had no idea whether they should ask a
-- teammate, retry, or give up.
--
-- THIS MIGRATION DOES THREE THINGS:
--
--   1. Re-define approve_entity so the verdict strings are the canonical
--      source of truth — and add three new codes the route can map:
--        - tenant_mismatch  (403) — entity exists but belongs to another workspace
--        - already_approved — entity is already approved. THIS IS A SUCCESS,
--          NOT A CONFLICT: auditStore maps it to { ok: true } and the route
--          answers HTTP 200 with `alreadyApproved: true`. Approval stays
--          idempotent, so a double-click or a retry is a no-op rather than an
--          error the user has to interpret. The verdict exists only so a stale
--          UI can say "already approved" instead of claiming it just did it.
--          (An earlier draft of this header said 409 — that was never what the
--          code did, and a 409 here would have re-introduced exactly the kind of
--          confusing refusal this migration exists to remove.)
--        - check_violation  (409) — generic 23514 fallback the route can map to
--          a clearer remediation hint
--   2. Same for approve_entity_relationship so the store stops swallowing
--      endpoint_self_approval and that verdict reaches the route.
--   3. Document the verdict contract in the function COMMENT so a future
--      auditStore or route can rely on the enum without re-reading the SQL.

create or replace function public.approve_entity(
  p_entity_id   uuid,
  p_reviewer_id uuid,
  p_note        text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    text;
  v_proposer uuid;
begin
  select state, proposed_by
    into v_state, v_proposer
    from public.audit_entities
   where id = p_entity_id
   for update;

  if v_state is null then
    return 'not_found';
  end if;

  if v_state = 'approved' then
    return 'already_approved';
  end if;

  if v_state = 'rejected' then
    return 'rejected';
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id then
    if p_note is null or p_note not like '%[Single-founder approval]%' then
      return 'self_approval';
    end if;
  end if;

  begin
    update public.audit_entities
       set state = 'approved',
           reviewed_by = p_reviewer_id,
           reviewed_at = now(),
           review_note = coalesce(p_note, review_note)
     where id = p_entity_id;
  exception when check_violation then
    -- audit_entities_no_self_approval, audit_entities_review_required, etc.
    -- The exception block exists so the verdict is explicit rather than a
    -- 23514 escape with no remediation hint.
    return 'check_violation';
  end;

  return 'ok';
end;
$$;

comment on function public.approve_entity(uuid, uuid, text) is
  'Approve an entity node directly with optional single-founder self-approval note. '
  'Verdict contract (canonical, callers may rely on this enum): '
  'ok | already_approved | not_found | rejected | no_approver | self_approval | check_violation. '
  '0077 added already_approved and check_violation; the rest are inherited from 0075.';
revoke all on function public.approve_entity(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_entity(uuid, uuid, text) to service_role;

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
    return 'already_approved';
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

  select count(*) into v_own_ends
    from public.audit_entities
   where id in (v_subject, v_object)
     and state = 'proposed'
     and proposed_by = p_reviewer_id
     and not v_founder;
  if v_own_ends > 0 then
    return 'endpoint_self_approval';
  end if;

  begin
    update public.audit_entity_relationships
       set state = 'approved',
           reviewed_by = p_reviewer_id,
           reviewed_at = now(),
           review_note = coalesce(p_note, review_note)
     where id = p_relationship_id;

    update public.audit_entities
       set state = 'approved',
           reviewed_by = p_reviewer_id,
           reviewed_at = now(),
           review_note = coalesce(p_note, review_note)
     where id in (v_subject, v_object)
       and state = 'proposed';
  exception when check_violation then
    return 'check_violation';
  end;

  return 'ok';
end;
$$;

comment on function public.approve_entity_relationship(uuid, uuid, text) is
  'Approve an edge and its still-proposed endpoints under the same reviewer. '
  'Verdict contract (canonical, callers may rely on this enum): '
  'ok | already_approved | not_found | rejected | no_approver | self_approval | endpoint_rejected | endpoint_self_approval | check_violation. '
  '0077 added already_approved and check_violation; 0076 added endpoint_self_approval.';
revoke all on function public.approve_entity_relationship(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_entity_relationship(uuid, uuid, text) to service_role;

-- Refresh PostgREST schema cache so the new RPC bodies are visible immediately.
NOTIFY pgrst, 'reload schema';
