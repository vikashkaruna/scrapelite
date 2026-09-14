-- 0067_discoverability_governance.sql — P3 scoped roles, shared review and effects.

alter table public.workspace_members add column if not exists discoverability_role text;
update public.workspace_members
   set discoverability_role = case when role in ('owner','admin') then 'admin' else 'viewer' end
 where discoverability_role is null;
alter table public.workspace_members
  alter column discoverability_role set default 'viewer',
  alter column discoverability_role set not null;
alter table public.workspace_members drop constraint if exists workspace_members_discoverability_role_check;
alter table public.workspace_members add constraint workspace_members_discoverability_role_check
  check (discoverability_role in
    ('viewer','analyst','editor','manager','admin','agency_admin','client_viewer'));

alter table public.workspace_invites
  add column if not exists discoverability_role text not null default 'viewer';
alter table public.workspace_invites drop constraint if exists workspace_invites_discoverability_role_check;
alter table public.workspace_invites add constraint workspace_invites_discoverability_role_check
  check (discoverability_role in
    ('viewer','analyst','editor','manager','admin','agency_admin','client_viewer'));

comment on column public.workspace_members.discoverability_role is
  'P3 Discoverability-scoped role, independent of workspace billing/ownership authority.';

create or replace function public.create_workspace(p_owner_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if p_owner_id is null then raise exception 'create_workspace requires an owner id'; end if;
  if v_name = '' then v_name := 'My workspace'; end if;
  insert into public.workspaces (owner_id, name) values (p_owner_id, v_name) returning id into v_id;
  insert into public.workspace_members (workspace_id, user_id, role, discoverability_role)
    values (v_id, p_owner_id, 'owner', 'admin');
  return v_id;
end $$;
revoke all on function public.create_workspace(uuid, text) from public, anon, authenticated;
grant execute on function public.create_workspace(uuid, text) to service_role;

create or replace function public.set_workspace_discoverability_role(
  p_workspace_id uuid, p_actor uuid, p_target_user uuid, p_role text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_actor_role text;
begin
  if p_role not in ('viewer','analyst','editor','manager','admin','agency_admin','client_viewer') then
    return 'invalid_role';
  end if;
  select role into v_actor_role from public.workspace_members
   where workspace_id=p_workspace_id and user_id=p_actor;
  if v_actor_role not in ('owner','admin') then return 'not_authorized'; end if;
  update public.workspace_members set discoverability_role=p_role
   where workspace_id=p_workspace_id and user_id=p_target_user;
  if not found then return 'not_found'; end if;
  return 'ok';
end $$;
revoke all on function public.set_workspace_discoverability_role(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_workspace_discoverability_role(uuid, uuid, uuid, text)
  to service_role;

-- Workspace review must be a real path, not a role label over owner-only rows.
alter table public.audit_entity_relationships
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
update public.audit_entity_relationships r set workspace_id=e.workspace_id
  from public.audit_entities e
 where e.id=r.subject_id and r.workspace_id is null and e.workspace_id is not null;
create index if not exists audit_entity_relationships_workspace_review_idx
  on public.audit_entity_relationships (workspace_id, state, created_at desc)
  where workspace_id is not null;

alter table public.audit_entity_conflicts
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
update public.audit_entity_conflicts c set workspace_id=r.workspace_id
  from public.audit_business_truth_records r
 where r.id=c.truth_record_id and c.workspace_id is null and r.workspace_id is not null;
update public.audit_entity_conflicts c set workspace_id=e.workspace_id
  from public.audit_entities e
 where e.id=c.subject_id and c.workspace_id is null and e.workspace_id is not null;
create index if not exists audit_entity_conflicts_workspace_open_idx
  on public.audit_entity_conflicts (workspace_id, created_at desc)
  where workspace_id is not null and resolved_at is null;

-- §12's measured validation outcomes extend the shared W8 lifecycle.
alter table public.audit_recommendations drop constraint if exists audit_recommendations_status_check;
alter table public.audit_recommendations add constraint audit_recommendations_status_check check (status in (
  'open','accepted','dismissed','done','assigned','in_progress','implemented',
  'validation_scheduled','validated','no_measurable_change','regressed'
));
alter table public.audit_issues drop constraint if exists audit_issues_status_check;
alter table public.audit_issues add constraint audit_issues_status_check check (status in (
  'open','accepted','assigned','in_progress','implemented','validation_scheduled',
  'validated','dismissed','no_measurable_change','regressed'
));
alter table public.audit_issues drop constraint if exists audit_issues_owner_role_check;
alter table public.audit_issues add constraint audit_issues_owner_role_check check (
  owner_role is null or owner_role in (
    'content','seo','engineering','brand','product','growth_cro','product_marketing',
    'analytics','local_ops','design','customer_success','sales','agency'
  )
);

-- Connector delivery is an idempotent effect log, not a second workflow.
create table if not exists public.audit_connector_dispatches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  truth_record_id uuid references public.audit_business_truth_records(id) on delete cascade,
  entity_id uuid references public.audit_entities(id) on delete cascade,
  provider text not null check (provider in ('hubspot','notion','airtable','slack','zapier')),
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  payload_json jsonb not null default '{}'::jsonb,
  status text not null default 'claimed' check (status in ('claimed','delivered','failed')),
  response_json jsonb,
  error text,
  created_at timestamptz not null default now(),
  attempted_at timestamptz,
  delivered_at timestamptz,
  constraint audit_connector_dispatch_one_source check (
    (truth_record_id is not null)::int + (entity_id is not null)::int = 1
  ),
  constraint audit_connector_dispatch_idempotent unique (user_id, provider, idempotency_key)
);
-- A workspace dispatch belongs to the workspace, not whichever admin clicked
-- first. The legacy constraint remains the personal-scope arbiter; this second
-- index prevents two different workspace admins delivering the same effect.
create unique index if not exists audit_connector_dispatch_workspace_idempotent
  on public.audit_connector_dispatches (workspace_id, provider, idempotency_key)
  where workspace_id is not null;
alter table public.audit_connector_dispatches enable row level security;
drop policy if exists audit_connector_dispatches_service on public.audit_connector_dispatches;
create policy audit_connector_dispatches_service on public.audit_connector_dispatches
  for all to service_role using (true) with check (true);
revoke all on public.audit_connector_dispatches from anon, authenticated;

create or replace function public.claim_discoverability_connector_dispatch(
  p_user_id uuid, p_provider text, p_idempotency_key text,
  p_truth_record_id uuid default null, p_entity_id uuid default null,
  p_workspace_id uuid default null, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.audit_connector_dispatches%rowtype;
begin
  if (p_truth_record_id is not null)::int + (p_entity_id is not null)::int <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'one_source_required');
  end if;
  if p_workspace_id is not null and not exists (
    select 1 from public.workspace_members m
     where m.workspace_id=p_workspace_id and m.user_id=p_user_id
       and m.discoverability_role in ('admin','agency_admin')
  ) then return jsonb_build_object('ok', false, 'reason', 'not_authorized'); end if;

  if p_truth_record_id is not null and not exists (
    select 1 from public.audit_business_truth_records r
      join public.audit_business_truth_versions v on v.id=r.current_version_id
     where r.id=p_truth_record_id and r.status='active' and v.state='approved'
       and ((p_workspace_id is null and r.user_id=p_user_id)
         or (p_workspace_id is not null and r.workspace_id=p_workspace_id))
  ) then return jsonb_build_object('ok', false, 'reason', 'source_not_approved'); end if;

  if p_entity_id is not null and not exists (
    select 1 from public.audit_entities e
     where e.id=p_entity_id and e.state='approved'
       and ((p_workspace_id is null and e.user_id=p_user_id)
         or (p_workspace_id is not null and e.workspace_id=p_workspace_id))
  ) then return jsonb_build_object('ok', false, 'reason', 'source_not_approved'); end if;

  insert into public.audit_connector_dispatches
    (user_id, workspace_id, truth_record_id, entity_id, provider, idempotency_key, payload_json)
  values (p_user_id,p_workspace_id,p_truth_record_id,p_entity_id,p_provider,
          btrim(p_idempotency_key),coalesce(p_payload,'{}'::jsonb))
  on conflict do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.audit_connector_dispatches
     where provider=p_provider and idempotency_key=btrim(p_idempotency_key)
       and ((p_workspace_id is null and user_id=p_user_id and workspace_id is null)
         or (p_workspace_id is not null and workspace_id=p_workspace_id));
    return jsonb_build_object('ok',true,'replay',true,'id',v_row.id,'status',v_row.status);
  end if;
  return jsonb_build_object('ok',true,'replay',false,'id',v_row.id,'status',v_row.status);
end $$;
revoke all on function public.claim_discoverability_connector_dispatch(uuid,text,text,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_discoverability_connector_dispatch(uuid,text,text,uuid,uuid,uuid,jsonb)
  to service_role;

create or replace function public.assign_discoverability_recommendation(
  p_user_id uuid, p_workspace_id uuid, p_rec_id uuid, p_assignee uuid default null
) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.workspace_members m
     where m.workspace_id=p_workspace_id and m.user_id=p_user_id
       and m.discoverability_role in ('manager','admin','agency_admin')
  ) then return 'not_authorized'; end if;
  if not exists (
    select 1 from public.audit_recommendations r
     where r.id=p_rec_id and r.workspace_id=p_workspace_id
  ) then return 'not_found'; end if;
  if p_assignee is not null and not exists (
    select 1 from public.workspace_members m
     where m.workspace_id=p_workspace_id and m.user_id=p_assignee and m.paused_at is null
  ) then return 'not_a_member'; end if;
  update public.audit_recommendations
     set assigned_to=p_assignee,
         assigned_at=case when p_assignee is null then null else now() end
   where id=p_rec_id and workspace_id=p_workspace_id;
  return 'ok';
end $$;
revoke all on function public.assign_discoverability_recommendation(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.assign_discoverability_recommendation(uuid,uuid,uuid,uuid)
  to service_role;
