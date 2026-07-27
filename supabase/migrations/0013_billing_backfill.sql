-- scripts/billing-backfill.sql — PR1 step 2 of 3 (backfill user_id).
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run (idempotent by
-- construction: every UPDATE is guarded by `user_id is null`).
--
-- RUN THIS ONLY AFTER the dual-write release has been live for at least one
-- release cycle. Before then, billing_identity_links is empty and this file is
-- a no-op — harmless, but pointless.
--
-- What it does: every session that has been claimed by a signed-in user gets
-- its historical billing rows stamped with that user_id. Rows that remain null
-- afterwards are genuine logged-out purchases; they stay session-keyed and are
-- reachable only via the emailed invoice link. We do NOT try to adopt them by
-- matching email addresses — that would be an account-takeover vector.

update public.subscriptions s
   set user_id = l.user_id
  from public.billing_identity_links l
 where l.session_id = s.session_id
   and s.user_id is null;

update public.payment_events p
   set user_id = l.user_id
  from public.billing_identity_links l
 where l.session_id = p.session_id
   and p.user_id is null;

update public.usage_records u
   set user_id = l.user_id
  from public.billing_identity_links l
 where l.session_id = u.session_id
   and u.user_id is null;

-- Rebuild entitlements for every user touched above, applying the never-
-- downgrade merge rule. Cheap: one row per linked user.
do $$
declare r record;
begin
  for r in select distinct user_id from public.billing_identity_links loop
    perform public.merge_entitlement_from_subscriptions(r.user_id);
  end loop;
end $$;

-- ── Orphan report ─────────────────────────────────────────────────────────────
-- Not an error. These are unclaimed guest purchases. Review the count before
-- running 0014 — after the RLS flip they are service-key-only, which is the
-- intended end state, but you want to know how many exist first.
do $$
declare orphan_subs int; orphan_events int;
begin
  select count(*) into orphan_subs   from public.subscriptions  where user_id is null;
  select count(*) into orphan_events from public.payment_events where user_id is null;
  raise notice 'billing backfill: % unclaimed subscription rows, % unclaimed payment_event rows',
    orphan_subs, orphan_events;
end $$;

notify pgrst, 'reload schema';
