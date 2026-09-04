-- 0046_rule_execution_outcomes.sql
--
-- Two fixes to `rule_executions`, both about the audit trail PRD 5 requires
-- being able to record what actually happened.
--
-- ── 1. `refused` was not an allowed status ──────────────────────────────────
--
-- 0043 constrained status to ('success','failed','skipped'), but the dispatcher
-- added in this cycle also produces `refused` — the verdict when a rule's
-- destination is rejected at dispatch time, which is the SSRF guard firing.
--
-- The insert therefore violated the CHECK, and `dispatchSignal` catches
-- bookkeeping errors so it never breaks a dispatch — so the row was silently
-- dropped with a console.error. The net effect: **every security refusal was
-- missing from the audit trail**, which is precisely the event an operator most
-- needs to see. Verified against the real schema before this migration.
--
-- `refused` is kept DISTINCT from `failed` rather than folded into it. They mean
-- different things to the person reading the history: `failed` is "we tried and
-- the destination did not answer", `refused` is "we would not send this at all".
-- Collapsing them would tell a user their webhook is flaky when in fact we are
-- refusing to call it.
--
-- ── 2. `retrying` is a real state ───────────────────────────────────────────
--
-- PRD 5 lists "retry failed actions" as a Must. A row awaiting its next attempt
-- is neither a settled failure nor a success, and reporting it as `failed` would
-- make the change feed show a permanent failure for something still in flight.

alter table public.rule_executions
  drop constraint if exists rule_executions_status_check;

alter table public.rule_executions
  add constraint rule_executions_status_check
  check (status in ('success', 'failed', 'skipped', 'refused', 'retrying'));

-- Keep the 0044 posture. Adding a constraint cannot change a policy, but
-- asserting it here means a reader sees the invariant rather than going to look.
do $$ begin
  execute 'alter table public.rule_executions enable row level security';
  execute 'revoke all on public.rule_executions from anon';
  execute 'revoke all on public.rule_executions from authenticated';
  execute 'grant all on public.rule_executions to service_role';
end $$;
