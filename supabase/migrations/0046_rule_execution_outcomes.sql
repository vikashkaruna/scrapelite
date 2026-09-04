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
--
-- ── 3. Why the constraint is dropped BY LOOKUP, not by name ─────────────────
--
-- 0043 declares the CHECK inline on the column, so its name is whatever Postgres
-- auto-generated — conventionally `rule_executions_status_check`, but that is a
-- convention this migration would be betting the fix on. Dropping an ASSUMED
-- name with `if exists` fails open twice over: if the live name differs at all
-- (a hand-applied constraint, a table rebuilt out of band, a second CHECK added
-- later and auto-suffixed `..._check1`), the DROP matches nothing, the ADD then
-- succeeds under a free name, and the table ends up carrying BOTH constraints.
--
-- Postgres ANDs CHECK constraints. Two of them means the old, narrower list is
-- still in force, so `refused` and `retrying` are still rejected — and the
-- migration reports success while fixing nothing. That is the same silent
-- failure this file exists to repair, reintroduced by the repair itself.
--
-- So: find every CHECK that actually constrains the `status` column (by attnum,
-- not by text matching, so a constraint on some future `http_status` is never
-- collateral), drop those, add exactly one, then ASSERT exactly one remains.
-- The assertion is the point — it converts a silent no-op into a failed
-- migration, which is the only way anyone finds out.

do $$
declare
  c        record;
  status_a smallint;
begin
  select attnum into status_a
    from pg_attribute
   where attrelid = 'public.rule_executions'::regclass
     and attname  = 'status'
     and not attisdropped;

  if status_a is null then
    raise exception '0046: public.rule_executions has no status column';
  end if;

  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.rule_executions'::regclass
       and con.contype  = 'c'
       and con.conkey   @> array[status_a]
  loop
    execute format('alter table public.rule_executions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.rule_executions
  add constraint rule_executions_status_check
  check (status in ('success', 'failed', 'skipped', 'refused', 'retrying'));

-- Fail loudly if anything but exactly one status CHECK survived. A second one
-- would silently re-narrow the set; zero would mean the ADD did not take.
do $$
declare n integer;
begin
  select count(*) into n
    from pg_constraint con
   where con.conrelid = 'public.rule_executions'::regclass
     and con.contype  = 'c'
     and con.conkey   @> array[(
           select attnum from pg_attribute
            where attrelid = 'public.rule_executions'::regclass
              and attname  = 'status'
              and not attisdropped)];

  if n <> 1 then
    raise exception
      '0046: expected exactly 1 CHECK on rule_executions.status, found %', n;
  end if;
end $$;

-- Keep the 0044 posture. Adding a constraint cannot change a policy, but
-- asserting it here means a reader sees the invariant rather than going to look.
alter table public.rule_executions enable row level security;
revoke all on public.rule_executions from anon;
revoke all on public.rule_executions from authenticated;
grant  all on public.rule_executions to service_role;
