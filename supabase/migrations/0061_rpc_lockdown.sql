-- 0061_rpc_lockdown.sql — take ten SECURITY DEFINER functions away from `anon`.
--
-- 🔴 THIS IS THE 0044 DEFECT AGAIN, ONE LAYER DOWN. 0041-0043 shipped fifteen
-- TABLES readable and writable by anyone holding the public anon key, and 0044
-- locked them. Nobody checked the FUNCTIONS — and PostgreSQL grants EXECUTE on
-- a new function to PUBLIC by default, so every migration that created one and
-- did not revoke left it callable by `anon` through PostgREST's `/rpc/<name>`.
-- The publishable key is committed in `public/runtime-config.js` on purpose:
-- as that file's own comment says, "RLS protects data, not the key".
--
-- SECURITY DEFINER runs as the owner and BYPASSES RLS. So a function that is
-- anon-executable, takes a caller-supplied `p_user_id`, and never consults
-- `auth.uid()` is not merely over-permissive — it is an impersonation
-- primitive. All ten below are exactly that shape:
--
--   set_account_frozen           freeze ANY account — denial of service per user
--   request_account_deletion     schedule ANY account for deletion (and freeze it)
--   cancel_account_deletion      silently undo a user's own deletion request
--   credit_spend                 drain ANY user's credit ledger
--   credit_balance               read ANY user's balance — information disclosure
--   redeem_admin_coupon          grant plan value to an arbitrary account
--   create_admin_coupon_assignment  mint a coupon assignment
--   issue_referral_code          mint referral codes for arbitrary accounts
--   accept_workspace_invite      consume an invite as somebody else
--   upsert_audit_target          write rows attributed to another tenant
--
-- ⚠️ NOTHING LEGITIMATE CALLS THESE FROM A BROWSER, and that is what makes the
-- revoke safe rather than a behaviour change. The architecture rule is that the
-- browser reaches Supabase only through `apiClient.js` → Netlify Functions;
-- verified by grep, the only direct `supabase.rpc(...)` in `src/` is
-- `claim_billing_session`, which is deliberately NOT in this list because it is
-- already the correct shape: it derives `uid := auth.uid()`, takes no user id
-- from the caller, and 0012 already revoked it from anon and granted it to
-- authenticated. It is the model the other ten should have followed.
--
-- Every caller of all ten lives in `netlify/functions/`, which holds the
-- service key, and `service_role` keeps EXECUTE throughout — so this closes the
-- hole without touching a single working code path.
--
-- ⚠️ REVOKE FROM `public` IS THE LOAD-BEARING CLAUSE. Revoking from `anon` and
-- `authenticated` alone leaves the default PUBLIC grant in place, which both
-- roles inherit — the revoke would appear to succeed and change nothing.
--
-- Forward-only, and deliberately not folded into the migrations that created
-- these functions: several are already applied to production, so rewriting
-- their history would repair nothing that is actually running.

revoke all on function public.set_account_frozen(uuid, boolean, text, uuid)              from public, anon, authenticated;
revoke all on function public.request_account_deletion(uuid, integer)                    from public, anon, authenticated;
revoke all on function public.cancel_account_deletion(uuid)                              from public, anon, authenticated;
revoke all on function public.credit_spend(uuid, text, text, integer, text, integer, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.credit_balance(uuid, text)                                 from public, anon, authenticated;
revoke all on function public.redeem_admin_coupon(uuid, text)                            from public, anon, authenticated;
revoke all on function public.create_admin_coupon_assignment(uuid, text, text, integer, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.issue_referral_code(uuid)                                  from public, anon, authenticated;
revoke all on function public.accept_workspace_invite(text, uuid, text)                  from public, anon, authenticated;
revoke all on function public.upsert_audit_target(uuid, text, text, text)                from public, anon, authenticated;

grant execute on function public.set_account_frozen(uuid, boolean, text, uuid)              to service_role;
grant execute on function public.request_account_deletion(uuid, integer)                    to service_role;
grant execute on function public.cancel_account_deletion(uuid)                              to service_role;
grant execute on function public.credit_spend(uuid, text, text, integer, text, integer, jsonb, uuid) to service_role;
grant execute on function public.credit_balance(uuid, text)                                 to service_role;
grant execute on function public.redeem_admin_coupon(uuid, text)                            to service_role;
grant execute on function public.create_admin_coupon_assignment(uuid, text, text, integer, timestamptz, text, text) to service_role;
grant execute on function public.issue_referral_code(uuid)                                  to service_role;
grant execute on function public.accept_workspace_invite(text, uuid, text)                  to service_role;
grant execute on function public.upsert_audit_target(uuid, text, text, text)                to service_role;

-- ── The one correct function, whose revoke was a no-op ─────────────────────
-- 🔴 `claim_billing_session` is the SHAPE the ten above should have had — it
-- derives `uid := auth.uid()` and takes no user id — and it is the only
-- function the browser calls directly, so `authenticated` must keep it. But
-- 0012 wrote `revoke execute ... from anon` and nothing else, and that is a
-- NO-OP: the ACL still reads `=X/postgres`, the default PUBLIC grant, which
-- anon inherits. The function has therefore been anon-reachable since 0012
-- despite a line that reads as though it were not.
--
-- Low severity by itself — `auth.uid()` is NULL for anon, so an anon caller
-- claims nothing — but a revoke that silently fails is worth correcting
-- wherever it appears, because the next one may not be harmless.
revoke all on function public.claim_billing_session(text) from public, anon;
grant execute on function public.claim_billing_session(text) to authenticated, service_role;

-- ── Three definer functions that revoke without granting ───────────────────
-- These revoke from `public, anon, authenticated` and never name service_role,
-- so they depend entirely on Supabase's `ALTER DEFAULT PRIVILEGES ... GRANT ALL
-- ON FUNCTIONS TO service_role` having been in force when they were created.
-- That is true on a stock Supabase project and NOT true anywhere else — a
-- self-hosted Postgres, a restored dump, or PGlite leaves the server unable to
-- call its own RPC. `assign_recommendation` is reached from
-- `auditStore.js` → `/rpc/assign_recommendation` on every assignment, so the
-- failure mode is a working feature that stops working on a different host.
-- Stating the grant costs nothing and removes the environmental assumption.
grant execute on function public.assign_recommendation(uuid, uuid, uuid)                          to service_role;
grant execute on function public.prune_ops_history(integer)                                       to service_role;
grant execute on function public.record_pql_score(uuid, integer, numeric, boolean, boolean, text, jsonb, text[]) to service_role;
