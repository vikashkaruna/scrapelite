-- 0066_approved_entity_subjects.sql — CP-1.1's explicit entity → subject link.
-- Approved identity is the source of display facts. No proposed/rejected node
-- is backfilled merely because this migration was applied.

create unique index if not exists audit_subjects_workspace_entity_idx
  on public.audit_subjects (workspace_id, subject_kind, entity_id)
  where workspace_id is not null and entity_id is not null;

create or replace function public.upsert_audit_subject(
  p_user_id uuid,
  p_kind text,
  p_target_id uuid default null,
  p_entity_id uuid default null,
  p_truth_record_id uuid default null,
  p_label text default null,
  p_canonical_domain text default null,
  p_workspace_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_entity public.audit_entities%rowtype;
begin
  if (p_target_id is not null)::int
   + (p_entity_id is not null)::int
   + (p_truth_record_id is not null)::int <> 1 then
    raise exception 'upsert_audit_subject: exactly one reference is required';
  end if;

  if p_entity_id is not null then
    select * into v_entity from public.audit_entities where id = p_entity_id;
    if v_entity.id is null or v_entity.state <> 'approved' then
      raise exception 'upsert_audit_subject: entity not found or not approved';
    end if;
    if not (
      (p_kind = 'brand' and v_entity.entity_type in ('organization','brand'))
      or (p_kind = 'product' and v_entity.entity_type = 'product')
      or (p_kind = 'service' and v_entity.entity_type = 'service')
    ) then
      raise exception 'upsert_audit_subject: subject kind does not match entity type';
    end if;

    if v_entity.workspace_id is null then
      if v_entity.user_id <> p_user_id then
        raise exception 'upsert_audit_subject: entity not found';
      end if;
      insert into public.audit_subjects
        (user_id, workspace_id, subject_kind, entity_id, label, canonical_domain)
      values
        (v_entity.user_id, null, p_kind, p_entity_id,
         v_entity.name, v_entity.canonical_domain)
      on conflict (user_id, subject_kind, entity_id) where entity_id is not null
        do update set
          label = excluded.label,
          canonical_domain = excluded.canonical_domain,
          updated_at = now()
      returning id into v_id;
    else
      if p_workspace_id is distinct from v_entity.workspace_id
         or not exists (
           select 1 from public.workspace_members m
            where m.workspace_id = v_entity.workspace_id and m.user_id = p_user_id
         ) then
        raise exception 'upsert_audit_subject: entity not found';
      end if;
      insert into public.audit_subjects
        (user_id, workspace_id, subject_kind, entity_id, label, canonical_domain)
      values
        (v_entity.user_id, v_entity.workspace_id, p_kind, p_entity_id,
         v_entity.name, v_entity.canonical_domain)
      on conflict (workspace_id, subject_kind, entity_id)
        where workspace_id is not null and entity_id is not null
        do update set
          label = excluded.label,
          canonical_domain = excluded.canonical_domain,
          updated_at = now()
      returning id into v_id;
    end if;
    return v_id;
  end if;

  if p_target_id is not null then
    insert into public.audit_subjects
      (user_id, workspace_id, subject_kind, target_id, label, canonical_domain)
    values
      (p_user_id, p_workspace_id, p_kind, p_target_id,
       coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
    on conflict (user_id, subject_kind, target_id) where target_id is not null
      do update set
        label = coalesce(nullif(btrim(p_label), ''), public.audit_subjects.label),
        canonical_domain = coalesce(p_canonical_domain, public.audit_subjects.canonical_domain),
        workspace_id = coalesce(p_workspace_id, public.audit_subjects.workspace_id),
        updated_at = now()
    returning id into v_id;
  else
    insert into public.audit_subjects
      (user_id, workspace_id, subject_kind, truth_record_id, label, canonical_domain)
    values
      (p_user_id, p_workspace_id, p_kind, p_truth_record_id,
       coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
    on conflict (user_id, subject_kind, truth_record_id) where truth_record_id is not null
      do update set
        label = coalesce(nullif(btrim(p_label), ''), public.audit_subjects.label),
        canonical_domain = coalesce(p_canonical_domain, public.audit_subjects.canonical_domain),
        workspace_id = coalesce(p_workspace_id, public.audit_subjects.workspace_id),
        updated_at = now()
    returning id into v_id;
  end if;
  return v_id;
end $$;

comment on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) is
  'D7/CP-1.1 atomic get-or-create. Entity subjects require approved, type-compatible entities and derive identity from them. Workspace members share one subject; no proposal is backfilled.';

revoke all on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid)
  to service_role;
