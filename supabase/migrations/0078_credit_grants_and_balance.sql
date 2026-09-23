-- 0078_credit_grants_and_balance.sql
-- Step D of docs/CREDITS-UNIFICATION-PROPOSAL.md — make the balance real.
--
-- ── WHAT 0037 LEFT OUT ──────────────────────────────────────────────────────
-- 0037 built an append-only ledger and `credit_balance()`, which sums every
-- row for a user. That answers "what is the net of this account's rows" — it
-- does NOT answer "how many credits may this person spend right now", because
-- nothing in it can expire. Rollover (D2) needs an expiry, and an expiry needs
-- FIFO allocation, or a grant that lapses would retroactively un-pay for work
-- that was already done with it.
--
-- ── WHY expires_at AND NOT A MONTHLY RESET ──────────────────────────────────
-- A monthly grant carrying `expires_at = end of the FOLLOWING month` implements
-- D2 structurally, with no forfeiture arithmetic anywhere:
--
--   * a grant issued for month M is spendable in M;
--   * whatever is unused is still spendable in M+1, because it has not expired;
--   * it is gone at the end of M+1;
--   * so at most TWO grants are ever live at once, which IS the "carry <= 1x
--     the monthly allowance" cap, and the "worst-case month is bounded at 2x
--     the plan budget" guarantee, without a second rule to keep in sync.
--
-- The cap is therefore a property of the data, not a number some job has to
-- remember to enforce. That is the same reasoning the ledger itself rests on:
-- a counter that drifts from the rows it counts eventually bills somebody for
-- work that is not there.
--
-- ⚠️ Free (D3) is granted with expires_at NULL. It is a lifetime pool, not a
-- monthly allowance, and giving it an expiry would quietly delete the taster.
--
-- ── FIFO IS WHAT MAKES AN EXPIRY HONEST ─────────────────────────────────────
-- Spend is allocated against the OLDEST grant first. Without that, a user who
-- spent 50 of a 100-credit grant and then received a new grant could see the
-- old grant expire and lose 100 rather than the 50 that were actually left.
-- credit_available() below walks grants oldest-first, absorbs spend into them,
-- and counts only the UNUSED remainder of grants that have not expired.
--
-- Adds 2 columns, 1 index, 3 functions. No new tables.

-- ── 1. expiry and idempotency on grant rows ─────────────────────────────────
alter table public.credit_ledger
  add column if not exists expires_at timestamptz;

-- The period a monthly grant belongs to ('YYYY-MM'), or a stable key for a
-- one-off grant ('signup', 'referral:<id>', 'pack:<order>'). It exists so a
-- grant can be issued EXACTLY ONCE: a cron that runs twice, a webhook that is
-- redelivered, or a retried apply must not double-credit an account.
alter table public.credit_ledger
  add column if not exists grant_period text;

-- 🔴 THE IDEMPOTENCY GUARANTEE, AS A CONSTRAINT RATHER THAN A CONVENTION.
-- payment-webhook.js's read-then-write dedup races; this cannot. A second
-- insert for the same (user, period) raises unique_violation, which
-- credit_grant() below catches and reports as 'already_granted'.
create unique index if not exists credit_ledger_grant_period_uniq
  on public.credit_ledger (user_id, grant_period)
  where grant_period is not null;

create index if not exists credit_ledger_grant_expiry_idx
  on public.credit_ledger (user_id, occurred_at)
  where credits < 0;

-- ── 1b. a paused job must say WHY ──────────────────────────────────────────
-- enrichment_jobs can already be 'paused' and has nowhere to record the cause.
-- L3 pauses a job that has run out of credits, and a job that reports "paused"
-- with no reason is the same failure shape this repo has already had to fix
-- for schedules: it stops, nothing says why, and the user assumes it is broken.
alter table public.enrichment_jobs
  add column if not exists paused_reason text;

-- ── 2. the spendable balance ────────────────────────────────────────────────
--
-- Sign convention, inherited from 0037 and unchanged: a POSITIVE row is credits
-- CONSUMED, a NEGATIVE row is a grant or a refund. So a grant of 100 is stored
-- as -100, and "available" is grants minus spend.
--
-- Returns a signed integer. A NEGATIVE result is real and is not clamped: it
-- means more was spent than was ever granted, which is a fact worth surfacing
-- rather than rounding away to a comfortable zero.
create or replace function public.credit_available(
  p_user_id uuid, p_now timestamptz default now()
) returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_spent     bigint := 0;
  v_remaining bigint := 0;
  v_alloc     bigint;
  g           record;
begin
  if p_user_id is null then return 0; end if;

  select coalesce(sum(credits), 0) into v_spent
    from public.credit_ledger
   where user_id = p_user_id and credits > 0;

  -- Oldest grant first. A refund (also a negative row) participates as a grant
  -- with no expiry, which is correct: giving credits back must actually give
  -- them back, not hand over something that lapses on someone else's clock.
  for g in
    select (-credits)::bigint as amount, expires_at
      from public.credit_ledger
     where user_id = p_user_id and credits < 0
     order by occurred_at asc, id asc
  loop
    v_alloc := least(g.amount, v_spent);
    v_spent := v_spent - v_alloc;
    if g.expires_at is null or g.expires_at > p_now then
      v_remaining := v_remaining + (g.amount - v_alloc);
    end if;
  end loop;

  -- Anything still unallocated is spend beyond every grant ever made.
  return (v_remaining - v_spent)::integer;
end $$;

-- ── 2b. is the credit system LIVE for this account? ─────────────────────────
--
-- 🔴 WITHOUT THIS, APPLYING THIS MIGRATION WOULD REFUSE EVERY CUSTOMER.
-- The gates that read the balance ship BEFORE the step that starts granting
-- monthly allowances (step G of the proposal, which waits on calibration). So
-- on the day 0078 is applied, credit_available() correctly returns 0 for
-- everyone — nobody has been granted anything yet — and every gate reading it
-- would pause every schedule, every monitor and every bulk job at once.
--
-- The rule that avoids it is the honest one rather than a feature flag: an
-- account that has NEVER been granted credits is not on the credit system, so
-- there is no balance to enforce. `grants` is what says which. The moment the
-- first grant lands the gate arms itself for that account, with no switch to
-- remember to flip and no window where it is half on.
--
-- Returns everything a balance screen needs in one round trip, because the
-- alternative is three calls to answer one question.
create or replace function public.credit_status(
  p_user_id uuid, p_now timestamptz default now()
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_grants  integer;
  v_granted bigint;
  v_spent   bigint;
begin
  if p_user_id is null then
    return jsonb_build_object('enforced', false, 'available', 0, 'grants', 0,
                              'granted', 0, 'spent', 0);
  end if;

  select count(*)::integer, coalesce(sum(-credits), 0)
    into v_grants, v_granted
    from public.credit_ledger
   where user_id = p_user_id and credits < 0 and reason = 'grant';

  select coalesce(sum(credits), 0) into v_spent
    from public.credit_ledger
   where user_id = p_user_id and credits > 0;

  return jsonb_build_object(
    'enforced',  v_grants > 0,
    'available', public.credit_available(p_user_id, p_now),
    'grants',    v_grants,
    'granted',   v_granted,
    'spent',     v_spent
  );
end $$;

-- ── 3. issue a grant, exactly once ──────────────────────────────────────────
-- p_credits is the POSITIVE number of credits to give; the row is written
-- negative. Callers should not have to think about the sign convention to
-- avoid accidentally charging somebody for a gift.
create or replace function public.credit_grant(
  p_user_id    uuid,
  p_credits    integer,
  p_period     text default null,
  p_expires_at timestamptz default null,
  p_meta       jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_user');
  end if;
  if p_credits is null or p_credits <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'non_positive');
  end if;

  begin
    insert into public.credit_ledger (
      user_id, reason, credits, unit, quantity, meta, expires_at, grant_period
    ) values (
      p_user_id, 'grant', -p_credits, null, p_credits,
      coalesce(p_meta, '{}'::jsonb), p_expires_at, p_period
    ) returning id into v_id;
  exception
    -- The partial unique index above. A redelivered webhook, a cron that ran
    -- twice, or a retried backfill lands here and is a no-op, not a double
    -- credit. Reported as a distinct outcome so a caller can tell "already
    -- done" from "failed" — collapsing those is how a retry loop starts.
    when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'already_granted', 'period', p_period);
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'reason', 'unknown_user');
  end;

  return jsonb_build_object(
    'ok', true, 'id', v_id, 'credits', p_credits,
    'available', public.credit_available(p_user_id)
  );
end $$;

-- ── 4. the monthly allowance, with rollover built in ────────────────────────
-- p_period is 'YYYY-MM'. The grant expires at the END of the FOLLOWING month,
-- which is what makes the carry cap structural (see the header).
create or replace function public.credit_grant_monthly(
  p_user_id uuid, p_credits integer, p_period text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_start date;
begin
  if p_period is null or p_period !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_period');
  end if;
  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  return public.credit_grant(
    p_user_id, p_credits, p_period,
    -- end of the month AFTER p_period
    ((v_start + interval '2 months')::timestamptz),
    jsonb_build_object('kind', 'monthly', 'period', p_period)
  );
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────
-- Same posture as 0061: revoke from PUBLIC (which is what actually removes the
-- default grant — revoking from anon alone is a no-op, as 0012 proved), then
-- grant service_role EXPLICITLY rather than inheriting Supabase's ALTER
-- DEFAULT PRIVILEGES, which a restored dump does not carry.
revoke all on function public.credit_available(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.credit_status(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.credit_grant(uuid, integer, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.credit_grant_monthly(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.credit_available(uuid, timestamptz) to service_role;
grant execute on function public.credit_status(uuid, timestamptz) to service_role;
grant execute on function public.credit_grant(uuid, integer, text, timestamptz, jsonb) to service_role;
grant execute on function public.credit_grant_monthly(uuid, integer, text) to service_role;
