-- scripts/billing-identity.sql — PR1 (billing identity + server-authoritative entitlements).
-- Run in: Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- WHY THIS EXISTS
-- Billing rows have always been keyed on `session_id` — a random UUID kept in
-- the browser's localStorage (`datiq.sessionId`, see src/lib/usageRepo.js).
-- That means: clearing site data orphans a paying customer's history, two
-- people sharing a browser share a subscription, and nothing can be tied to
-- the signed-in user. Invoices carry names, addresses and amounts, so before
-- any of that exists the billing tables have to hang off `auth.users.id`.
--
-- This migration is deliberately ADDITIVE ONLY — every column is nullable and
-- nothing reads them yet. Behaviour is unchanged until 0013 (backfill) and
-- 0014 (RLS lockdown) land. See the ordering note at the bottom.

-- ── 1. user_id on the session-keyed billing tables ────────────────────────────
-- Nullable on purpose: genuine logged-out purchases keep working and simply
-- carry a null user_id until the buyer signs in and claims the session.
alter table public.subscriptions  add column if not exists user_id uuid references auth.users;
alter table public.payment_events add column if not exists user_id uuid references auth.users;
alter table public.usage_records  add column if not exists user_id uuid references auth.users;

create index if not exists subscriptions_user_idx  on public.subscriptions  (user_id);
create index if not exists payment_events_user_idx on public.payment_events (user_id);
create index if not exists usage_records_user_idx  on public.usage_records  (user_id);

-- ── 2. session → user link table ──────────────────────────────────────────────
-- A link table rather than a bare backfill because one browser session id can
-- legitimately be presented by two different humans (shared machine), and this
-- is money — we want the audit row saying who claimed what and when.
create table if not exists public.billing_identity_links (
  session_id text primary key,
  user_id    uuid not null references auth.users on delete cascade,
  linked_at  timestamptz not null default now(),
  source     text                                  -- 'signin' | 'checkout' | 'admin'
);
create index if not exists billing_identity_links_user_idx
  on public.billing_identity_links (user_id);

alter table public.billing_identity_links enable row level security;
-- RLS on with no policy = service key only. The claim RPC below is SECURITY
-- DEFINER, so the browser never needs direct access to this table.

-- ── 3. entitlements — the resolved answer, one row per user ───────────────────
-- Kept SEPARATE from `subscriptions` on purpose. `subscriptions` is provider-
-- shaped and is clobbered on every purchase by the onConflict:session_id upsert
-- in src/lib/paymentRepo.js. `entitlements` is the single resolved answer to
-- "what may this user do right now" — a primary-key lookup, cheap to cache.
--
-- TWO AXES, NEVER CONFLATED: `plan_id` is what they bought, `status` is where
-- they are in the lifecycle. A suspended Pro user stays plan_id='pro' with
-- status='suspended'. Encoding lifecycle into plan_id (a "suspended" pseudo
-- plan) would be silently DANGEROUS: getEffectivePlanById() in
-- src/lib/pricingOverrides.js falls back to `free` for unknown ids, so a
-- suspended user would be granted the Free tier instead of being denied.
create table if not exists public.entitlements (
  user_id              uuid primary key references auth.users on delete cascade,
  plan_id              text not null default 'free',
  status               text not null default 'active',   -- active|suspended|deactivated|purged
  billing_period       text,                             -- monthly|annual|once
  period_start         timestamptz,
  period_end           timestamptz,
  scheduled_plan_id    text,                             -- pending downgrade target
  scheduled_at         timestamptz,
  bonus_extractions    integer not null default 0,
  bonus_batch_urls     integer not null default 0,
  credit_balance_minor bigint  not null default 0,
  suspended_at         timestamptz,
  deactivated_at       timestamptz,
  purge_after          timestamptz,
  comp_until           timestamptz,                      -- admin grace; suppresses notices
  last_notice_kind     text,                             -- purge interlock reads this
  source               text,                             -- 'payment'|'admin'|'migration'
  version              bigint  not null default 1,       -- bumped on write; drives cache busting
  updated_at           timestamptz not null default now()
);

create index if not exists entitlements_period_end_idx on public.entitlements (period_end)
  where period_end is not null;                          -- the daily lifecycle cron's scan
create index if not exists entitlements_status_idx on public.entitlements (status);

alter table public.entitlements enable row level security;

drop policy if exists "entitlements select own" on public.entitlements;
create policy "entitlements select own" on public.entitlements
  for select to authenticated using (auth.uid() = user_id);

-- No insert/update/delete policy for ANYONE. Every write goes through the
-- service key (checkout, verify-payment, webhook, crons, admin). A user must
-- never be able to write their own entitlement row.
revoke insert, update, delete on public.entitlements from authenticated, anon;

-- ── 4. plan ranking (used by the merge rule) ──────────────────────────────────
create or replace function public.plan_rank(p_plan text)
returns integer language sql immutable as $$
  select case lower(coalesce(p_plan, 'free'))
    when 'agency'    then 6
    when 'business'  then 5
    when 'developer' then 4
    when 'pro'       then 4
    when 'select'    then 3
    when 'go'        then 2
    when 'free'      then 1
    else 0                              -- unknown plan ranks LOWEST, never wins a merge
  end;
$$;

-- ── 5. merge subscriptions → entitlements for one user ────────────────────────
-- Called after a claim. Rule: NEVER DOWNGRADE. Later period_end wins; on a tie
-- (or when both are null, which is the norm today because the one-time-order
-- path never sets current_period_end) the higher plan rank wins. Bonuses sum.
--
-- Deliberate safety choice: rows migrated from `subscriptions` land with
-- source='migration' and period_end=null, which means computeLifecycle() can
-- never suspend them. Existing customers are not retro-suspended by this
-- migration; the lifecycle only starts at their next real payment.
create or replace function public.merge_entitlement_from_subscriptions(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare best record;
begin
  if p_user is null then return; end if;

  select s.plan_id, s.current_period_start, s.current_period_end
    into best
    from public.subscriptions s
   where s.user_id = p_user
     and coalesce(s.status, 'active') <> 'cancelled'
   order by s.current_period_end desc nulls last,
            public.plan_rank(s.plan_id) desc,
            s.updated_at desc nulls last
   limit 1;

  if not found then return; end if;

  insert into public.entitlements (user_id, plan_id, period_start, period_end, source)
  values (p_user, coalesce(best.plan_id, 'free'), best.current_period_start,
          best.current_period_end, 'migration')
  on conflict (user_id) do update
    set plan_id = case
          when public.plan_rank(excluded.plan_id) > public.plan_rank(public.entitlements.plan_id)
          then excluded.plan_id else public.entitlements.plan_id end,
        period_end = greatest(
          coalesce(public.entitlements.period_end, '-infinity'::timestamptz),
          coalesce(excluded.period_end,            '-infinity'::timestamptz)),
        version    = public.entitlements.version + 1,
        updated_at = now()
    where public.entitlements.status = 'active';   -- never resurrect a purged row
end $$;

-- ── 6. claim_billing_session — the browser-callable claim RPC ─────────────────
-- SECURITY DEFINER + auth.uid() read INTERNALLY, so it is safe to call directly
-- from the client with the user's JWT: the caller cannot name a different user.
-- Refuses if the session is already linked to somebody else — that is the
-- anti-theft check (a shared/guessed session id must not transfer a paid plan).
create or replace function public.claim_billing_session(p_session_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); owner uuid;
begin
  if uid is null or p_session_id is null or p_session_id = '' then
    return jsonb_build_object('claimed', false, 'reason', 'no_auth');
  end if;

  select user_id into owner from public.billing_identity_links
   where session_id = p_session_id;

  if owner is not null and owner <> uid then
    return jsonb_build_object('claimed', false, 'reason', 'already_linked');
  end if;

  insert into public.billing_identity_links (session_id, user_id, source)
  values (p_session_id, uid, 'signin')
  on conflict (session_id) do nothing;

  update public.subscriptions  set user_id = uid where session_id = p_session_id and user_id is null;
  update public.payment_events set user_id = uid where session_id = p_session_id and user_id is null;
  update public.usage_records  set user_id = uid where session_id = p_session_id and user_id is null;

  perform public.merge_entitlement_from_subscriptions(uid);

  return jsonb_build_object('claimed', true);
end $$;

revoke execute on function public.claim_billing_session(text) from anon;
grant   execute on function public.claim_billing_session(text) to authenticated;
revoke execute on function public.merge_entitlement_from_subscriptions(uuid) from anon, authenticated;

-- ── Ordering note ─────────────────────────────────────────────────────────────
-- This file is step 1 of 3 and is behaviour-neutral on its own.
--   0012 (this)  nullable columns + link table + entitlements. Deploy alone.
--   ...          ship the dual-write release (claim on sign-in, user_id on all
--                new rows) and let it run for at least one release.
--   0013         backfill user_id from billing_identity_links; report orphans.
--   0014         flip RLS: drop `anon full access` on subscriptions/payment_events.
-- Only after 0014 may any server read entitlements for authorization.

notify pgrst, 'reload schema';
