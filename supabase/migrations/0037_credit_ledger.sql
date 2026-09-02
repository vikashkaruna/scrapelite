-- 0037_credit_ledger.sql
-- Phase 0 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md — the spine.
--
-- ── WHY A LEDGER AND NOT A COUNTER COLUMN ───────────────────────────────────
-- CLAUDE.md already records this decision once, for audits:
--
--   "audits are counted from the audits table (status != 'failed', current
--    month) with NO counter column, deliberately, because a counter that
--    drifts from the rows it counts eventually bills somebody for work that
--    is not there."
--
-- The same reasoning applies with more force here, because PRD 3 requires us to
-- show an ESTIMATE before a run and the ACTUAL after it. Those two numbers only
-- mean anything if the actual is derived from the individual cost-bearing
-- events, not from a number some code path remembered to increment. So:
--   credit_ledger  = append-only truth
--   usage_records  = cache, may be rebuilt from the ledger at any time
--
-- ── APPEND-ONLY IS ENFORCED, NOT DOCUMENTED ─────────────────────────────────
-- A ledger you can UPDATE is not a ledger. A correction is a COMPENSATING
-- NEGATIVE ROW, exactly as 0016_invoices.sql makes a correction a credit note
-- rather than an edit. The trigger below refuses both UPDATE and DELETE.
--
-- ── NEVER CHARGE FOR A REFUSED REQUEST ──────────────────────────────────────
-- extract.js already orders its gates SSRF -> entitlement -> compliance ->
-- guest charge -> rate limiter precisely so nothing above the charge can bill.
-- Callers of credit_spend() inherit that rule: a run refused before any
-- provider call writes NO ledger row. A run killed mid-flight writes rows only
-- for the items that actually completed — which is why the bulk worker
-- (§1.3a) charges per completed item rather than per job.
--
-- ── run_id CARRIES NO FOREIGN KEY, ON PURPOSE ───────────────────────────────
-- The ledger is billing evidence and must outlive the run it describes.
-- billing-purge.js already keeps invoices and payment_events when it deletes a
-- user's content for the same reason. An FK with ON DELETE CASCADE would let a
-- content purge silently erase the record of what was charged.
--
-- Adds 2 tables, 2 functions, 1 trigger.

-- ── the append-only ledger ──────────────────────────────────────────────────
create table if not exists public.credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users,          -- nullable: guest / system
  workspace_id  uuid references public.workspaces(id) on delete set null,
  run_id        text,                                 -- template_runs.id; deliberately no FK
  reason        text not null,
  -- Positive = credits consumed. Negative = refund or grant. A correction is a
  -- new negative row, never an edit to the row being corrected.
  credits       integer not null,
  unit          text,                                 -- what was actually metered
  quantity      integer,
  meta          jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint credit_ledger_reason_chk check (reason in (
    'page_fetch', 'ai_call', 'enrichment', 'audit', 'monitor_check',
    'template_run', 'refund', 'grant', 'adjustment'
  )),
  constraint credit_ledger_unit_chk check (unit is null or unit in (
    'page', 'ai_call', 'enrichment', 'audit', 'monitor_check', 'run'
  )),
  constraint credit_ledger_credits_chk check (credits <> 0)
);

-- The hot path is "what has this user spent this month" — a range scan on
-- (user_id, occurred_at), which is exactly how credit_balance() reads it.
create index if not exists credit_ledger_user_time_idx
  on public.credit_ledger (user_id, occurred_at desc);
create index if not exists credit_ledger_run_idx
  on public.credit_ledger (run_id) where run_id is not null;
create index if not exists credit_ledger_workspace_time_idx
  on public.credit_ledger (workspace_id, occurred_at desc) where workspace_id is not null;

-- ── the estimate shown before the user confirms a run ───────────────────────
-- Kept as its own row rather than a column on template_runs so that estimate
-- drift is MEASURABLE: a template whose estimate is routinely half its actual
-- is mispriced, and that is only visible if both numbers survive independently.
create table if not exists public.credit_estimates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users,
  run_id            text,
  template_key      text,
  template_version  integer,
  estimated_credits integer not null,
  breakdown         jsonb not null default '[]'::jsonb,
  accepted_at       timestamptz,                      -- null = shown, never confirmed
  created_at        timestamptz not null default now(),
  constraint credit_estimates_credits_chk check (estimated_credits >= 0)
);

create index if not exists credit_estimates_run_idx
  on public.credit_estimates (run_id) where run_id is not null;
create index if not exists credit_estimates_user_idx
  on public.credit_estimates (user_id, created_at desc);

-- ── append a spend ──────────────────────────────────────────────────────────
create or replace function public.credit_spend(
  p_user_id  uuid,
  p_run_id   text,
  p_reason   text,
  p_credits  integer,
  p_unit     text default null,
  p_quantity integer default null,
  p_meta     jsonb default '{}'::jsonb,
  p_workspace_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_credits is null or p_credits = 0 then
    -- Zero-cost work is real (a cache hit, a skipped unchanged page) and must
    -- not create a row — an all-zero ledger is noise that hides real spend.
    return jsonb_build_object('ok', false, 'reason', 'zero_credits');
  end if;

  begin
    insert into public.credit_ledger (
      user_id, workspace_id, run_id, reason, credits, unit, quantity, meta
    ) values (
      p_user_id, p_workspace_id, p_run_id, p_reason, p_credits, p_unit, p_quantity,
      coalesce(p_meta, '{}'::jsonb)
    ) returning id into v_id;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'reason', 'invalid_reason_or_unit');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'reason', 'unknown_user');
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ── derive the balance; never store it ──────────────────────────────────────
-- p_month is 'YYYY-MM' (the same key usageService.js uses). NULL = all time.
create or replace function public.credit_balance(
  p_user_id uuid, p_month text default null
) returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(credits), 0)::integer
    from public.credit_ledger
   where user_id = p_user_id
     and (p_month is null or to_char(occurred_at, 'YYYY-MM') = p_month);
$$;

-- ── append-only enforcement ─────────────────────────────────────────────────
create or replace function public.credit_ledger_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'credit_ledger is append-only — record a compensating entry (reason=''refund'' or ''adjustment'') instead of a % ', tg_op;
end $$;

drop trigger if exists credit_ledger_append_only_trg on public.credit_ledger;
create trigger credit_ledger_append_only_trg
  before update or delete on public.credit_ledger
  for each row execute function public.credit_ledger_append_only();

-- ── RLS: service key only ───────────────────────────────────────────────────
alter table public.credit_ledger    enable row level security;
alter table public.credit_estimates enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'credit_ledger' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.credit_ledger
             for all to service_role using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'credit_estimates' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.credit_estimates
             for all to service_role using (true) with check (true)';
  end if;
end $$;
