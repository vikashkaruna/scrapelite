-- 0033_deletion_period_end_gate.sql
-- Extends request_account_deletion (0032) so an account on an active PAID
-- plan is never purged before the period they already paid for actually
-- ends.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════════════
-- 0032 always set `deletion_purge_after = now() + grace_days` (30 by
-- default), regardless of plan. That is correct for a free account, but for
-- someone on an active paid plan it could purge them mid-period — deleting an
-- account (and the data they were paying to keep) before the service they
-- already bought was even over.
--
-- v1.0 has no real recurring/auto-renewing billing (one-time Razorpay Orders
-- only — see docs/RECURRING-BILLING-DEFERRAL.md), so there is no "cancel your
-- subscription first" step to build here: nothing auto-renews, so there is
-- nothing to cancel. The only thing that can be computed today is "when does
-- the period they already paid for end", and that is `entitlements.period_end`
-- — set once at purchase, unaffected by anything in this migration.
--
-- The rule: for `plan_id <> 'free' and status = 'active'`, the purge date is
-- `GREATEST(period_end, now() + grace_days)` — whichever is LATER. That means:
--   * an account with months left on its plan is not purged early — the
--     account stays active until period_end, THEN the grace clock (already
--     elapsed by then) lets billing-purge.js act on the very next sweep;
--   * an account whose period is about to end (or already has) still gets
--     the full grace_days window, exactly as a free account would, so nobody
--     loses the "I changed my mind" recovery period just because their plan
--     happened to be expiring anyway.
-- Free-plan and non-active accounts are UNCHANGED — flat `now() + grace_days`,
-- same as 0032.
--
-- account-state.js's GET response now also returns planId/periodEnd (already
-- sitting in `entitlements`, nothing new to compute) so DangerZone.jsx can
-- show the applicable message before the user ever clicks confirm, and the
-- confirmation screen restates the actual computed date.
--
-- billing-purge.js is UNCHANGED by this migration — it already only acts once
-- `deletion_purge_after` is in the past, so a later date computed here is
-- automatically respected with no cron change needed.
-- ═══════════════════════════════════════════════════════════════════════════

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

  select plan_id, status, period_end
    into v_plan_id, v_status, v_period_end
    from public.entitlements
   where user_id = p_user_id;

  if not found then return null; end if;

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
