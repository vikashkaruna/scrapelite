-- 0075_entity_approval.sql
-- Direct entity node approval RPC and single-founder self-approval constraint
-- on audit_entities.

-- 1. Entities self-approval constraint
alter table public.audit_entities
  drop constraint if exists audit_entities_no_self_approval;

alter table public.audit_entities
  add constraint audit_entities_no_self_approval check (
    state <> 'approved'
    or proposed_by is null
    or reviewed_by is null
    or reviewed_by <> proposed_by
    or (review_note is not null and review_note like '%[Single-founder approval]%')
  );

-- 2. Direct entity node approval function
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
    return 'ok';
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

  update public.audit_entities
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_entity_id;

  return 'ok';
end;
$$;

comment on function public.approve_entity(uuid, uuid, text) is
  'Approve an entity node directly with optional single-founder self-approval note';
revoke all on function public.approve_entity(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_entity(uuid, uuid, text) to service_role;
