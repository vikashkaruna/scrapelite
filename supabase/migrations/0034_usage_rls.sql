-- 0034_usage_rls.sql — lock down usage_records and usage_alerts.
--
-- 0014_billing_rls.sql locked subscriptions/payment_events but deliberately
-- left these two tables on their original `anon full access` policy from
-- 0001_core_tables_and_billing.sql, with a comment explaining exactly why:
-- locking them would break guest usage sync, which wrote directly to
-- Supabase with the anon key from src/lib/usageRepo.js, and that write path
-- needed to move behind a server function FIRST.
--
-- netlify/functions/usage-sync.js is that function (service key only).
-- usageRepo.js now calls it instead of the Supabase client directly. This
-- migration is the second half: with no browser code left holding the anon
-- key to talk to these tables, the anon-full-access policy can finally go.
--
-- ── WHY THIS ISN'T THE subscriptions/payment_events PATTERN ─────────────────
-- Those two lock to `auth.uid() = user_id` — an authenticated SELECT-own
-- policy. `usage_records` DOES carry a `user_id` column too (0012_billing_
-- identity.sql backfills it from session_id via stamp_user_id_from_session),
-- but `usage_alerts` never got one — both tables are primarily keyed on
-- `session_id`, a client-generated identifier that exists for guests too,
-- who have no `auth.uid()` to match against.
--
-- Rather than give the two tables asymmetric policies (one authenticated-
-- readable, one not), both go straight to service-key-only, same as the
-- 0029/0030/0031 pattern (referrals, discoverability, workspaces): every
-- read and write goes through a Netlify function (usage-sync.js), never a
-- direct anon or authenticated Supabase query. usage-sync.js already serves
-- every read this app makes, guest or signed-in, so no client code loses
-- anything it could do a moment ago.
--
-- End state: no anon or authenticated policy on either table at all. Every
-- access goes through usage-sync.js (browser reads/writes for the current
-- session) or admin-revenue.js (server-side aggregation, already uses the
-- service key and was never affected by this gap).

drop policy if exists "anon full access" on public.usage_records;
drop policy if exists "anon full access" on public.usage_alerts;

revoke all on public.usage_records from anon;
revoke all on public.usage_records from authenticated;
revoke all on public.usage_alerts  from anon;
revoke all on public.usage_alerts  from authenticated;

notify pgrst, 'reload schema';
