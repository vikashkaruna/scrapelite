-- 0074_single_founder_approval.sql
-- Loosen self-approval restrictions for solo founders / single-operator teams
-- when recorded with [Single-founder approval] in the review note.

-- 1. Business truth versions constraint
alter table public.audit_business_truth_versions
  drop constraint if exists audit_btv_no_self_approval;

alter table public.audit_business_truth_versions
  add constraint audit_btv_no_self_approval check (
    state <> 'approved'
    or proposed_by is null
    or reviewed_by is null
    or reviewed_by <> proposed_by
    or (review_note is not null and review_note like '%[Single-founder approval]%')
  );

-- 2. Entity graph relationships constraint
alter table public.audit_entity_relationships
  drop constraint if exists audit_rel_no_self_approval;

alter table public.audit_entity_relationships
  add constraint audit_rel_no_self_approval check (
    state <> 'approved'
    or proposed_by is null
    or reviewed_by is null
    or reviewed_by <> proposed_by
    or (review_note is not null and review_note like '%[Single-founder approval]%')
  );

-- 3. Update promote_business_truth_version RPC
create or replace function public.promote_business_truth_version(
  p_version_id  uuid,
  p_reviewer_id uuid,
  p_note        text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id  uuid;
  v_state      text;
  v_proposer   uuid;
  v_fields     jsonb;
  v_current    uuid;
begin
  select record_id, state, proposed_by, fields_json
    into v_record_id, v_state, v_proposer, v_fields
    from public.audit_business_truth_versions
   where id = p_version_id
   for update;

  if v_record_id is null then
    return 'not_found';
  end if;

  if v_state = 'approved' then
    select current_version_id into v_current
      from public.audit_business_truth_records where id = v_record_id;
    if v_current = p_version_id then
      return 'ok';
    end if;
  end if;

  if v_state not in ('pending_review', 'approved') then
    return 'not_reviewable';
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id then
    if p_note is null or p_note not like '%[Single-founder approval]%' then
      return 'self_approval';
    end if;
  end if;

  if v_fields -> 'legal_name' is null or v_fields -> 'canonical_domain' is null then
    return 'missing_required';
  end if;

  update public.audit_business_truth_versions v
     set state = 'superseded', superseded_at = now()
    from public.audit_business_truth_records r
   where r.id = v_record_id
     and v.id = r.current_version_id
     and v.id <> p_version_id;

  update public.audit_business_truth_versions
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_version_id;

  update public.audit_business_truth_records
     set current_version_id = p_version_id
   where id = v_record_id;

  return 'ok';
end;
$$;

-- 4. Update approve_entity_relationship RPC
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

  if v_proposer is not null and v_proposer = p_reviewer_id then
    if p_note is null or p_note not like '%[Single-founder approval]%' then
      return 'self_approval';
    end if;
  end if;

  select count(*) into v_bad
    from public.audit_entities
   where id in (v_subject, v_object) and state = 'rejected';
  if v_bad > 0 then
    return 'endpoint_rejected';
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
