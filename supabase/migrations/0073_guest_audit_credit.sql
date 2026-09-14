-- 0073_guest_audit_credit.sql — a guest's free Discoverability audit gets its own bucket.
--
-- WHY: guest audits drew on the `single` extraction bucket (10 credits). An
-- audit is a page fetch, a robots read, a PageSpeed lookup, a citation sample
-- and an AI call — far costlier than an extraction — and the UI promises ONE
-- free audit, a promise that lived only in the visitor's localStorage. The
-- server now enforces what the product says.
--
-- SHAPE:
--   (a) `audit_count` beside `single_count` / `batch_count`. Additive, default 0.
--   (b) `consume_guest_credit` gains `p_audit_limit integer default 1`. The old
--       4-argument signature is DROPPED rather than overloaded: two overloads
--       make PostgREST's named-argument resolution ambiguous for exactly the
--       4-key calls every existing caller sends. Callers send `p_audit_limit`
--       only for kind='audit', so single/batch calls resolve identically before
--       and after this migration.
--   (c) An unknown kind still counts as `single`, exactly as 0026 behaved.
--
-- ⚠️ DEPLOY ORDER: until this is applied, an audit-kind call names an argument
-- the old function does not have, PostgREST answers 404, and guestUsage.js
-- FAILS OPEN — guest audits are unmetered. Apply before (or with) the code.
--
-- Like 0061 requires, the revoke is from PUBLIC, not only anon/authenticated.

alter table public.guest_identities
  add column if not exists audit_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'guest_identities_audit_count_nonnegative'
       and conrelid = 'public.guest_identities'::regclass
  ) then
    alter table public.guest_identities
      add constraint guest_identities_audit_count_nonnegative check (audit_count >= 0);
  end if;
end $$;

drop function if exists public.consume_guest_credit(text, text, integer, integer);

create or replace function public.consume_guest_credit(
  p_token_hash text,
  p_kind text default 'single',
  p_single_limit integer default 10,
  p_batch_limit integer default 5,
  p_audit_limit integer default 1
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  row_guest public.guest_identities;
  v_kind text := case when p_kind in ('batch', 'audit') then p_kind else 'single' end;
  current_count integer;
  max_count integer;
begin
  if p_token_hash is null or length(trim(p_token_hash)) < 32 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_guest_identity', 'remaining', 0);
  end if;
  insert into public.guest_identities (token_hash) values (p_token_hash) on conflict (token_hash) do nothing;
  select * into row_guest from public.guest_identities where token_hash = p_token_hash for update;

  if v_kind = 'batch' then
    current_count := row_guest.batch_count; max_count := greatest(coalesce(p_batch_limit, 5), 1);
  elsif v_kind = 'audit' then
    current_count := row_guest.audit_count; max_count := greatest(coalesce(p_audit_limit, 1), 1);
  else
    current_count := row_guest.single_count; max_count := greatest(coalesce(p_single_limit, 10), 1);
  end if;

  if current_count >= max_count then
    update public.guest_identities set last_seen_at = now(), updated_at = now() where id = row_guest.id;
    return jsonb_build_object('allowed', false, 'reason', v_kind || '_limit_reached', 'remaining', 0, 'kind', v_kind);
  end if;

  if v_kind = 'batch' then
    update public.guest_identities set batch_count = batch_count + 1, last_seen_at = now(), updated_at = now() where id = row_guest.id;
  elsif v_kind = 'audit' then
    update public.guest_identities set audit_count = audit_count + 1, last_seen_at = now(), updated_at = now() where id = row_guest.id;
  else
    update public.guest_identities set single_count = single_count + 1, last_seen_at = now(), updated_at = now() where id = row_guest.id;
  end if;

  return jsonb_build_object('allowed', true, 'remaining', greatest(max_count - (current_count + 1), 0), 'kind', v_kind);
end;
$$;

revoke all on function public.consume_guest_credit(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_guest_credit(text, text, integer, integer, integer) to service_role;
notify pgrst, 'reload schema';
