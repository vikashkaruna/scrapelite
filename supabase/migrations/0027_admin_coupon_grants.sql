-- 0027_admin_coupon_grants.sql
-- User-specific, one-time, non-recurring complimentary plan grants.
-- These rows are deliberately separate from pricing_config.coupons and
-- coupon_redemptions: an admin grant is not a paid checkout discount.

create table if not exists public.admin_coupon_assignments (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users on delete cascade,
  code                     text not null,
  plan_id                  text not null check (plan_id in ('free', 'go', 'select', 'pro', 'business', 'agency')),
  validity_months          integer not null check (validity_months between 1 and 24),
  claim_expires_at         timestamptz,
  status                   text not null default 'assigned'
                           check (status in ('assigned', 'redeemed', 'revoked', 'expired')),
  assigned_by              text not null,
  reason                   text not null,
  assigned_at              timestamptz not null default now(),
  redeemed_at              timestamptz,
  redemption_period_start  timestamptz,
  redemption_period_end    timestamptz,
  revoked_at               timestamptz,
  created_at               timestamptz not null default now()
);

create unique index if not exists admin_coupon_assignments_code_uq
  on public.admin_coupon_assignments (upper(code));
create index if not exists admin_coupon_assignments_user_idx
  on public.admin_coupon_assignments (user_id, assigned_at desc);
create index if not exists admin_coupon_assignments_status_idx
  on public.admin_coupon_assignments (status, claim_expires_at);

alter table public.admin_coupon_assignments enable row level security;
-- Service-key-only: the admin function and the user redemption function are
-- the only writers/readers. No browser can enumerate another user's grants.

create or replace function public.create_admin_coupon_assignment(
  p_user_id uuid,
  p_code text,
  p_plan_id text,
  p_validity_months integer,
  p_claim_expires_at timestamptz,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare created public.admin_coupon_assignments;
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;
  if p_code is null or trim(p_code) = '' then raise exception 'code_required'; end if;
  if p_plan_id not in ('free', 'go', 'select', 'pro', 'business', 'agency') then
    raise exception 'unknown_plan';
  end if;
  if p_validity_months is null or p_validity_months < 1 or p_validity_months > 24 then
    raise exception 'invalid_validity_months';
  end if;
  if p_reason is null or trim(p_reason) = '' then raise exception 'reason_required'; end if;

  insert into public.admin_coupon_assignments (
    user_id, code, plan_id, validity_months, claim_expires_at,
    assigned_by, reason
  ) values (
    p_user_id, upper(trim(p_code)), p_plan_id, p_validity_months,
    p_claim_expires_at, coalesce(nullif(trim(p_actor), ''), 'admin'), trim(p_reason)
  ) returning * into created;

  insert into public.billing_audit_log (actor, action, user_id, reason, detail)
  values (
    coalesce(nullif(trim(p_actor), ''), 'admin'),
    'admin_coupon_assign',
    p_user_id,
    trim(p_reason),
    jsonb_build_object(
      'assignment_id', created.id,
      'code', created.code,
      'plan_id', created.plan_id,
      'validity_months', created.validity_months,
      'claim_expires_at', created.claim_expires_at
    )
  );

  return to_jsonb(created);
exception
  when unique_violation then
    raise exception 'coupon_code_already_exists';
end;
$$;

create or replace function public.redeem_admin_coupon(
  p_user_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_row public.admin_coupon_assignments;
  current_ent public.entitlements;
  starts_at timestamptz := now();
  ends_at timestamptz;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'error', 'Authentication required.');
  end if;
  if p_code is null or trim(p_code) = '' then
    return jsonb_build_object('ok', false, 'code', 'CODE_REQUIRED', 'error', 'Enter a grant coupon code.');
  end if;

  select * into grant_row
    from public.admin_coupon_assignments
   where user_id = p_user_id
     and upper(code) = upper(trim(p_code))
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_GRANT', 'error', 'This coupon is not assigned to your account.');
  end if;

  if grant_row.status <> 'assigned' then
    return jsonb_build_object(
      'ok', false,
      'code', case when grant_row.status = 'expired' then 'GRANT_EXPIRED' else 'GRANT_ALREADY_USED' end,
      'error', case when grant_row.status = 'expired' then 'This grant coupon has expired.' else 'This grant coupon has already been used or revoked.' end
    );
  end if;

  if grant_row.claim_expires_at is not null and grant_row.claim_expires_at <= now() then
    update public.admin_coupon_assignments
       set status = 'expired'
     where id = grant_row.id;
    return jsonb_build_object('ok', false, 'code', 'GRANT_EXPIRED', 'error', 'This grant coupon has expired.');
  end if;

  select * into current_ent
    from public.entitlements
   where user_id = p_user_id
   for update;

  -- Never replace an active paid or existing plan entitlement. The user can
  -- redeem after that access ends; the assignment remains unused.
  if current_ent.user_id is not null
     and current_ent.plan_id <> 'free'
     and current_ent.status not in ('deactivated', 'purged')
     and (current_ent.period_end is null or current_ent.period_end > now()) then
    return jsonb_build_object(
      'ok', false,
      'code', 'ACTIVE_ENTITLEMENT',
      'error', 'Your current plan is still active. Apply this grant after it ends.',
      'plan_id', current_ent.plan_id,
      'period_end', current_ent.period_end
    );
  end if;

  ends_at := starts_at + make_interval(months => grant_row.validity_months);

  insert into public.entitlements (
    user_id, plan_id, status, billing_period, period_start, period_end,
    scheduled_plan_id, scheduled_at, comp_until, last_notice_kind,
    source, version, updated_at
  ) values (
    p_user_id, grant_row.plan_id, 'active', 'once', starts_at, ends_at,
    null, null, null, null, 'admin_coupon', 1, now()
  )
  on conflict (user_id) do update set
    plan_id = excluded.plan_id,
    status = 'active',
    billing_period = 'once',
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    scheduled_plan_id = null,
    scheduled_at = null,
    comp_until = null,
    last_notice_kind = null,
    source = 'admin_coupon',
    version = public.entitlements.version + 1,
    updated_at = now();

  update public.admin_coupon_assignments
     set status = 'redeemed',
         redeemed_at = now(),
         redemption_period_start = starts_at,
         redemption_period_end = ends_at
   where id = grant_row.id;

  insert into public.billing_audit_log (actor, action, user_id, reason, detail)
  values (
    'user:' || p_user_id::text,
    'admin_coupon_redeem',
    p_user_id,
    grant_row.reason,
    jsonb_build_object(
      'assignment_id', grant_row.id,
      'code', grant_row.code,
      'plan_id', grant_row.plan_id,
      'period_start', starts_at,
      'period_end', ends_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', grant_row.code,
    'plan_id', grant_row.plan_id,
    'period_start', starts_at,
    'period_end', ends_at,
    'validity_months', grant_row.validity_months
  );
end;
$$;

revoke all on public.admin_coupon_assignments from anon, authenticated;
revoke execute on function public.create_admin_coupon_assignment(uuid, text, text, integer, timestamptz, text, text) from anon, authenticated;
revoke execute on function public.redeem_admin_coupon(uuid, text) from anon, authenticated;

notify pgrst, 'reload schema';
