-- DatIQ helper: permanently delete one user and related records.
-- Run in Supabase SQL Editor as an owner/service-role administrator.
-- The function refuses to delete until p_confirm => true is supplied.
--
-- select * from public.delete_user_account(p_email := 'person@example.com', p_confirm := true);
-- select * from public.delete_user_account(p_phone := '+15551234567', p_confirm := true);

create table if not exists public.account_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  deleted_user_id uuid not null,
  email_snapshot text,
  phone_snapshot text,
  deleted_at timestamptz not null default now(),
  requested_by text not null default current_user,
  matched_by text not null,
  deleted_rows jsonb not null default '{}'::jsonb
);

revoke all on public.account_deletion_audit from public, anon, authenticated;

create or replace function public.delete_user_account(
  p_email text default null,
  p_phone text default null,
  p_confirm boolean default false
)
returns table (audit_id uuid, deleted_user_id uuid, deleted_email text, deleted_phone text, deleted_rows jsonb)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target auth.users%rowtype;
  match_count integer;
  matched_by_value text;
  row_count bigint;
  row_counts jsonb := '{}'::jsonb;
  session_ids text[] := '{}';
  table_name text;
  audit_row public.account_deletion_audit%rowtype;
begin
  if (nullif(trim(p_email), '') is null) = (nullif(trim(p_phone), '') is null) then
    raise exception 'Supply exactly one of p_email or p_phone';
  end if;
  if not p_confirm then
    raise exception 'Refusing deletion: call again with p_confirm => true';
  end if;

  if p_email is not null then
    select count(*) into match_count from auth.users where lower(email) = lower(trim(p_email));
    matched_by_value := 'email';
  else
    select count(*) into match_count from auth.users where phone = trim(p_phone);
    matched_by_value := 'phone';
  end if;
  if match_count = 0 then raise exception 'No user matched the supplied %', matched_by_value; end if;
  if match_count > 1 then raise exception 'More than one user matched; refusing deletion'; end if;

  if p_email is not null then
    select * into target from auth.users where lower(email) = lower(trim(p_email));
  else
    select * into target from auth.users where phone = trim(p_phone);
  end if;

  if to_regclass('public.billing_identity_links') is not null then
    select coalesce(array_agg(session_id), '{}') into session_ids
      from public.billing_identity_links where user_id = target.id;
  end if;

  -- Keep existing operator/billing audit history, but remove foreign-key
  -- ownership pointers that would otherwise prevent auth.users deletion.
  if to_regclass('public.billing_audit_log') is not null then
    update public.billing_audit_log set user_id = null where user_id = target.id;
    if to_regclass('public.invoices') is not null then
      update public.billing_audit_log set invoice_id = null
        where invoice_id in (select id from public.invoices where user_id = target.id);
    end if;
  end if;

  foreach table_name in array[
    'extractions', 'scheduled_tasks', 'api_keys',
    'integration_connections', 'zapier_events', 'workflow_subscriptions',
    'workflow_events', 'consent_records', 'public_reports',
    'summary_feedback', 'billing_notice_log', 'billing_identity_links',
    'entitlements', 'invoice_drafts',
    'invoices', 'payment_events', 'subscriptions', 'usage_records',
    'analytics_events'
  ] loop
    if to_regclass('public.' || table_name) is not null
       and exists (
         select 1 from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = table_name
           and a.attname = 'user_id' and not a.attisdropped
       ) then
      execute format('delete from public.%I where user_id::text = $1::text', table_name) using target.id;
      get diagnostics row_count = row_count;
      row_counts := row_counts || jsonb_build_object(table_name, row_count);
    end if;
  end loop;

  foreach table_name in array['subscriptions', 'payment_events', 'usage_records', 'coupon_redemptions'] loop
    if to_regclass('public.' || table_name) is not null and cardinality(session_ids) > 0 then
      execute format('delete from public.%I where session_id = any($1)', table_name) using session_ids;
      get diagnostics row_count = row_count;
      row_counts := row_counts || jsonb_build_object(table_name || '_by_session', row_count);
    end if;
  end loop;

  insert into public.account_deletion_audit
    (deleted_user_id, email_snapshot, phone_snapshot, matched_by, deleted_rows)
  values (target.id, target.email, target.phone, matched_by_value, row_counts)
  returning * into audit_row;

  delete from auth.users where id = target.id;
  return query select audit_row.id, audit_row.deleted_user_id, audit_row.email_snapshot,
    audit_row.phone_snapshot, audit_row.deleted_rows;
end;
$$;

revoke all on function public.delete_user_account(text, text, boolean) from public, anon, authenticated;
grant execute on function public.delete_user_account(text, text, boolean) to service_role;

comment on function public.delete_user_account(text, text, boolean) is
  'Permanently deletes one auth user and user-owned data, preserving an account_deletion_audit record. Service role only.';
