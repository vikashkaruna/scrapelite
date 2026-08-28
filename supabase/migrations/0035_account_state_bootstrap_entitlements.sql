-- 0035_account_state_bootstrap_entitlements.sql
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG: freezing or deleting a free account failed with "we could not find a
-- billing record for this account" — reported live, reproduced below.
-- ═══════════════════════════════════════════════════════════════════════════
-- `entitlements` only ever gets a row for a user through a billing event:
-- claiming a paid session (0012's merge_entitlement_from_subscriptions), a
-- referral bonus (0029), or an admin coupon grant (0027). A user who signs up
-- and never buys anything, is never referred, and never receives a coupon has
-- NO entitlements row at all — which on the free plan is the overwhelmingly
-- common case, not an edge case.
--
-- `set_account_frozen` and `request_account_deletion` (0032, refined by 0033)
-- both do a plain `UPDATE ... WHERE user_id = p_user_id` and report
-- `not_found` when zero rows match. For a real signed-in user with no billing
-- history, that `not_found` became account-state.js's "we could not find a
-- billing record for this account" — a billing-shaped error surfacing from an
-- action (freeze / delete-my-own-account) that has nothing to do with billing
-- history. Every free user who never triggered one of the three row-creating
-- events was silently unable to freeze OR delete their own account.
--
-- FIX: both functions now bootstrap a default row (`plan_id='free',
-- status='active'` — the table's own column defaults, nothing invented here)
-- for the target user before acting, so freeze/delete work for every real
-- signed-in user regardless of billing history. A `p_user_id` that is not a
-- real `auth.users` row at all still reports `not_found` — the bootstrap
-- insert hits entitlements' FK on `auth.users` and that violation is caught
-- and reported the same way as before this migration, so the existing
-- "freezing an unknown user" contract in scripts/db-verify.mjs is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_account_frozen(
  p_user_id uuid, p_frozen boolean, p_reason text default null, p_actor uuid default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return 'invalid'; end if;

  begin
    insert into public.entitlements (user_id) values (p_user_id)
      on conflict (user_id) do nothing;
  exception when foreign_key_violation then
    return 'not_found';
  end;

  if p_frozen then
    update public.entitlements
       set frozen_at     = coalesce(frozen_at, now()),
           frozen_by     = coalesce(p_actor, p_user_id),
           frozen_reason = coalesce(p_reason, frozen_reason),
           version       = version + 1,
           updated_at    = now()
     where user_id = p_user_id;
  else
    -- ⚠️ An account awaiting deletion may NOT simply be unfrozen. The freeze is
    -- part of that state; lifting it alone would leave an account consuming
    -- units while a purge date sits on it. Cancelling the deletion is what
    -- unfreezes, and that is a different, deliberate call.
    if exists (select 1 from public.entitlements
                where user_id = p_user_id and deletion_requested_at is not null) then
      return 'deletion_pending';
    end if;
    update public.entitlements
       set frozen_at = null, frozen_by = null, frozen_reason = null,
           version = version + 1, updated_at = now()
     where user_id = p_user_id;
  end if;

  return 'ok';
end; $$;

create or replace function public.request_account_deletion(
  p_user_id uuid, p_grace_days integer default 30
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_after      timestamptz;
  v_grace_end  timestamptz;
  v_plan_id    text;
  v_status     text;
  v_period_end timestamptz;
begin
  if p_user_id is null then return null; end if;

  begin
    insert into public.entitlements (user_id) values (p_user_id)
      on conflict (user_id) do nothing;
  exception when foreign_key_violation then
    return null;
  end;

  select plan_id, status, period_end
    into v_plan_id, v_status, v_period_end
    from public.entitlements
   where user_id = p_user_id;

  -- Clamped: a 0-day grace period is an immediate irreversible delete wearing
  -- this function's name, and the whole point of the grace period is that no
  -- caller can opt out of it.
  v_grace_end := now() + make_interval(days => greatest(1, least(coalesce(p_grace_days, 30), 90)));

  v_after := case
    when v_plan_id is not null and v_plan_id <> 'free' and v_status = 'active' and v_period_end is not null
      then greatest(v_period_end, v_grace_end)
    else v_grace_end
  end;

  update public.entitlements
     set deletion_requested_at = coalesce(deletion_requested_at, now()),
         deletion_purge_after  = coalesce(deletion_purge_after, v_after),
         frozen_at             = coalesce(frozen_at, now()),
         frozen_reason         = coalesce(frozen_reason, 'deletion_requested'),
         version               = version + 1,
         updated_at            = now()
   where user_id = p_user_id;

  select deletion_purge_after into v_after from public.entitlements where user_id = p_user_id;
  return v_after;
end; $$;
