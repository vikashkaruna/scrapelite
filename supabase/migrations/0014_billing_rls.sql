-- scripts/billing-rls.sql — PR1 step 3 of 3 (lock down the billing tables).
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- WHAT THIS FIXES
-- 0001_core_tables_and_billing.sql created `subscriptions` and `payment_events`
-- with the policy:
--     create policy "anon full access" ... for all using (true) with check (true)
-- i.e. anyone holding the PUBLIC anon key — which ships in the browser bundle —
-- can read every customer's payment history, and can run
--     update subscriptions set plan_id = 'agency';
-- That was survivable only because entitlements were decided client-side and
-- the server never trusted these tables. The moment a server reads them for
-- authorization it becomes a privilege-escalation path, so this MUST land
-- before any entitlement enforcement ships.
--
-- End state: authenticated users may SELECT their own rows and nothing else.
-- Every write goes through the service key (create-checkout, verify-payment,
-- payment-webhook, the crons, admin). Guest/unclaimed rows (user_id is null)
-- become service-key-only, which is intended — they are reachable through the
-- signed link in the invoice email.

-- ── subscriptions ─────────────────────────────────────────────────────────────
drop policy if exists "anon full access"      on public.subscriptions;
drop policy if exists "subscriptions select own" on public.subscriptions;
create policy "subscriptions select own" on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

revoke all                      on public.subscriptions from anon;
revoke insert, update, delete   on public.subscriptions from authenticated;
grant  select                   on public.subscriptions to authenticated;

-- ── payment_events ────────────────────────────────────────────────────────────
drop policy if exists "anon full access"        on public.payment_events;
drop policy if exists "payment_events select own" on public.payment_events;
create policy "payment_events select own" on public.payment_events
  for select to authenticated using (auth.uid() = user_id);

revoke all                      on public.payment_events from anon;
revoke insert, update, delete   on public.payment_events from authenticated;
grant  select                   on public.payment_events to authenticated;

-- ── Deliberately NOT changed here ─────────────────────────────────────────────
-- `usage_records` and `usage_alerts` keep their `anon full access` policy for
-- now. Locking them breaks guest usage sync from src/lib/usageRepo.js, which
-- writes with the anon key for signed-out visitors. That is a privacy leak but
-- NOT an entitlement-escalation path (nothing authorizes off usage rows), so it
-- is tracked as its own follow-up rather than bundled into this change.
-- Do not "tidy" them into this file without first moving guest usage writes
-- behind a server function.

notify pgrst, 'reload schema';
