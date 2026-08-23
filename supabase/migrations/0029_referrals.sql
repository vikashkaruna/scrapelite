-- 0029_referrals.sql
-- Referral codes and redemptions ("invite a friend, you both get 25").
--
-- ── Why this exists ──────────────────────────────────────────────────────
-- The referral feature shipped as a UI shell over localStorage, and every part
-- of it that mattered was broken:
--
--   1. Codes were derived by an LCG whose multiply overflowed
--      Number.MAX_SAFE_INTEGER, zeroing the low bits, so `% 32` was always 0
--      and EVERY user got the same code, "AAAAAAAA". Attribution was
--      impossible even in principle.
--   2. The redeemed bonus was written to `datiq.referralBonus`, which nothing
--      reads except the banner's own label. The quota reads
--      `subscription.bonusExtractions`. So the banner said "you have 25 bonus
--      extractions" on the same screen that refused to extract.
--   3. Redemption happened entirely in the INVITEE's browser, so the referrer
--      — the person the reward is supposed to motivate — was never credited,
--      despite the copy promising both sides get 25.
--   4. The self-referral check compared against the code in the same
--      localStorage, so any second browser farmed it without limit.
--
-- Codes and rewards are therefore server-issued and server-granted. A referral
-- grants real paid quota; it cannot live in a store the beneficiary can write.
--
-- ── Signed-in only ───────────────────────────────────────────────────────
-- Both columns are NOT NULL uuids referencing auth.users. Same reasoning as
-- 0028_scrape_consent.sql: an anonymous identity can be cleared and re-made
-- without limit, so it is not something a reward can be attributed to. The
-- advertised flow already says "when they sign up with your link".
--
-- RLS is enabled with NO anon and NO authenticated policy: these rows are read
-- and written only by the service key via netlify/functions/referral.js, which
-- resolves the user from the JWT. A client that could write here could grant
-- itself unlimited extractions.

create table if not exists public.referral_codes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);

-- Lookup by code is the redemption hot path.
create index if not exists referral_codes_code_idx on public.referral_codes (code);

create table if not exists public.referral_redemptions (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  referrer_user_id  uuid not null references auth.users(id) on delete cascade,
  -- UNIQUE, not just indexed: one redemption per invitee ACCOUNT, ever. This is
  -- the constraint that makes the reward finite — without it a new browser
  -- profile is a new 25 extractions, forever.
  invitee_user_id   uuid not null unique references auth.users(id) on delete cascade,
  bonus_granted     integer not null,
  created_at        timestamptz not null default now(),
  -- Belt and braces alongside the handler's own check: the database itself
  -- refuses a self-referral, so a future handler bug cannot reintroduce it.
  constraint referral_no_self check (referrer_user_id <> invitee_user_id)
);

create index if not exists referral_redemptions_referrer_idx
  on public.referral_redemptions (referrer_user_id, created_at desc);

alter table public.referral_codes       enable row level security;
alter table public.referral_redemptions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'referral_codes' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.referral_codes
             for all to service_role using (true) with check (true)';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'referral_redemptions' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.referral_redemptions
             for all to service_role using (true) with check (true)';
  end if;
end $$;

-- ── Code issuance ────────────────────────────────────────────────────────
-- Idempotent: returns the caller's existing code, or mints one.
--
-- The alphabet excludes 0/O/1/I because these codes get read aloud and typed
-- by hand. Uniqueness comes from the UNIQUE constraint plus a retry loop, NOT
-- from hoping a hash does not collide — which is exactly what the broken
-- client-side derivation assumed.
create or replace function public.issue_referral_code(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_existing text;
  i          integer;
  attempt    integer := 0;
begin
  if p_user_id is null then
    raise exception 'issue_referral_code requires a user id';
  end if;

  select code into v_existing from public.referral_codes where user_id = p_user_id;
  if v_existing is not null then
    return v_existing;
  end if;

  loop
    attempt := attempt + 1;
    v_code := '';
    for i in 1..8 loop
      -- floor(random()*32) is uniform over 0..31; length() keeps it honest if
      -- the alphabet is ever edited.
      v_code := v_code || substr(v_alphabet, floor(random() * length(v_alphabet))::int + 1, 1);
    end loop;

    begin
      insert into public.referral_codes (user_id, code) values (p_user_id, v_code);
      return v_code;
    exception
      when unique_violation then
        -- Either the code collided, or this user raced another request and
        -- already has one. Re-read before retrying: if the row now exists the
        -- race is resolved, not an error.
        select code into v_existing from public.referral_codes where user_id = p_user_id;
        if v_existing is not null then
          return v_existing;
        end if;
        if attempt >= 12 then
          raise exception 'could not allocate a unique referral code after % attempts', attempt;
        end if;
    end;
  end loop;
end $$;

-- ── Redemption ───────────────────────────────────────────────────────────
-- Atomic, and credits BOTH sides in the same transaction. Returns a jsonb
-- verdict rather than raising, so the handler can report a reason without
-- distinguishing exception classes:
--
--   {"ok": true,  "bonus": 25, "referrer": "<uuid>"}
--   {"ok": false, "reason": "invalid"}   — no such code
--   {"ok": false, "reason": "self"}      — your own code
--   {"ok": false, "reason": "already"}   — this account already redeemed one
--
-- Note it upserts into `entitlements`: a brand-new invitee may have no row yet,
-- and the reward must not depend on one existing. `version` is bumped so the
-- 60s client entitlement cache busts rather than serving a stale limit.
create or replace function public.redeem_referral_code(
  p_invitee_id uuid, p_code text, p_bonus integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_referrer uuid;
  v_clean    text;
begin
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

  insert into public.entitlements (user_id, bonus_extractions)
  values (p_invitee_id, p_bonus)
  on conflict (user_id) do update
    set bonus_extractions = public.entitlements.bonus_extractions + p_bonus,
        version           = public.entitlements.version + 1,
        updated_at        = now();

  insert into public.entitlements (user_id, bonus_extractions)
  values (v_referrer, p_bonus)
  on conflict (user_id) do update
    set bonus_extractions = public.entitlements.bonus_extractions + p_bonus,
        version           = public.entitlements.version + 1,
        updated_at        = now();

  return jsonb_build_object('ok', true, 'bonus', p_bonus, 'referrer', v_referrer);
end $$;
