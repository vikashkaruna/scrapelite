-- 0079_referral_rewards_as_credits.sql
-- §4.6 of docs/CREDITS-UNIFICATION-PROPOSAL.md — required work, not follow-up.
--
-- ── WHY THIS MIGRATION EXISTS ───────────────────────────────────────────────
-- Deleting the Extractions Bundle from TOPUP_BUNDLES is one line. The field it
-- granted is NOT the bundle's: `entitlements.bonus_extractions` has three
-- other writers, and the referral programme is the one that matters most.
--
-- 🔴 REMOVING THE BUNDLE WITHOUT THIS WOULD HAVE SILENTLY KILLED THE REFERRAL
-- REWARD. Both sides would still get a row written, the reader that turned it
-- into quota would be gone, and nothing would error — the exact
-- declared-and-never-read failure this schema has already produced four times
-- (audit_signals.raw_value, .evidence_json, audit_recommendations.issue_id,
-- audit_entity_evidence). A referral programme that rewards nobody, with no
-- error anywhere, is the worst available version of this change.
--
-- ⚠️ THE REWARD'S VALUE IS UNCHANGED — 25 stays 25. One page read costs one
-- credit, so "25 bonus extractions" translates to "25 credits" exactly.
-- Re-pricing the referral reward is a business decision and is deliberately
-- NOT being made here under cover of a technical migration.
--
-- ⚠️ `bonus_extractions` IS NOT DROPPED. Historical rows are evidence of what
-- was granted before the switch, and a column dropped in the same change that
-- stops writing it leaves no way to audit the transition. It is simply no
-- longer written or read.
--
-- Adds 0 tables, replaces 1 function.

-- 🔴 THE SIGNATURE MUST MATCH 0029's EXACTLY: (p_invitee_id, p_code, p_bonus),
-- in that order, with no default. A "tidier" ordering here does not replace
-- the function — PostgreSQL overloads on the argument list, so it would have
-- created a SECOND redeem_referral_code while the original carried on writing
-- bonus_extractions, and the only symptom would have been a referral
-- programme that quietly rewarded nothing. Caught by db-verify, which called
-- it and got "function is not unique".
create or replace function public.redeem_referral_code(
  p_invitee_id uuid, p_code text, p_bonus integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_referrer uuid;
  v_clean    text;
begin
  -- ⚠️ EVERY REFUSAL STRING IS 0029's, VERBATIM. `reason` travels to the
  -- client (referralService reads it) and a renamed code is a silent
  -- behaviour change for a caller that still matches the old one — the same
  -- public-contract rule the audit signal codes are held to. In particular an
  -- unknown code is 'invalid', not 'unknown'.
  if p_invitee_id is null or p_code is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  v_clean := upper(btrim(p_code));

  select user_id into v_referrer from public.referral_codes where code = v_clean;
  if v_referrer is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_referrer = p_invitee_id then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;

  -- The unique constraint on invitee_user_id is the real guard; catching it is
  -- what makes a double-submit idempotent rather than a 500.
  begin
    insert into public.referral_redemptions (code, referrer_user_id, invitee_user_id, bonus_granted)
    values (v_clean, v_referrer, p_invitee_id, p_bonus);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end;

  -- ── THE REWARD, AS CREDITS ────────────────────────────────────────────────
  -- Both sides, atomically with the redemption row, inside the same
  -- transaction — so a reward can never exist without its redemption, nor a
  -- redemption without its reward.
  --
  -- ⚠️ NO EXPIRY. A referral reward was EARNED, not allowanced; expiring it on
  -- the monthly clock would delete something somebody did work for. That is
  -- why credit_grant takes the expiry as a parameter rather than assuming the
  -- rollover one.
  --
  -- The period keys make each side idempotent independently: a referrer who
  -- invites twenty people gets twenty distinct grants, and the same invitee
  -- can never be rewarded twice.
  perform public.credit_grant(
    p_invitee_id, p_bonus, 'referral-in:' || v_clean, null,
    jsonb_build_object('kind', 'referral', 'side', 'invitee', 'code', v_clean)
  );
  perform public.credit_grant(
    v_referrer, p_bonus, 'referral-out:' || p_invitee_id::text, null,
    jsonb_build_object('kind', 'referral', 'side', 'referrer', 'code', v_clean)
  );

  -- 🔴 THE VERSION BUMP IS KEPT, AND DROPPING IT WOULD HAVE BEEN A REAL
  -- REGRESSION. entitlements.version is what busts the client's 60s
  -- entitlement cache; without it the invitee is told they have just earned
  -- 25 credits while the app carries on serving the pre-reward state for up
  -- to a minute. The row no longer carries the reward — the ledger does — but
  -- it is still the cache generation, and that job did not move.
  insert into public.entitlements (user_id) values (p_invitee_id)
  on conflict (user_id) do update
    set version = public.entitlements.version + 1, updated_at = now();

  insert into public.entitlements (user_id) values (v_referrer)
  on conflict (user_id) do update
    set version = public.entitlements.version + 1, updated_at = now();

  return jsonb_build_object('ok', true, 'bonus', p_bonus, 'referrer', v_referrer, 'unit', 'credits');
end $$;

-- 0061's rule: revoking from anon alone is a no-op because PUBLIC holds the
-- default grant. `create or replace` preserves the existing ACL, but restating
-- it costs nothing and survives a restored dump that carries no defaults.
revoke all on function public.redeem_referral_code(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.redeem_referral_code(uuid, text, integer) to service_role;
