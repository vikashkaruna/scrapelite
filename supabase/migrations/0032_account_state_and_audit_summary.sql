-- 0032_account_state_and_audit_summary.sql
-- Three additive changes, no new tables:
--   1. entitlements     — a user-chosen FREEZE and a deletion request
--   2. workspace_members— per-member pause
--   3. audit_results    — a cached AI executive summary
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 WHY FREEZE IS NOT `entitlements.status = 'suspended'`
-- ═══════════════════════════════════════════════════════════════════════════
-- `status` (0012_billing_identity.sql) is the BILLING LIFECYCLE:
-- active | suspended | deactivated | purged. Reaching `suspended` starts the
-- dunning schedule in billing-lifecycle.js and begins the day-90 countdown that
-- billing-purge.js reads. It means "this account has lapsed".
--
-- A user-chosen freeze means something entirely different: "keep charging me,
-- keep my data, just stop anyone consuming units for a while". Reusing
-- `suspended` for it would enrol a paying customer in a dunning sequence and
-- start a deletion clock on data they explicitly asked to keep. That is not a
-- near-miss; it is the worst possible outcome of the feature.
--
-- So freeze is a SEPARATE AXIS, exactly like scheduled_tasks.system_paused vs
-- scheduled_tasks.status (0015_scheduler_hardening.sql): one column records the
-- USER's intent, another the PLATFORM's, and neither can be mistaken for the
-- other. `can()` in entitlementModel.js checks frozen_at immediately after the
-- lifecycle gate and denies every unit-consuming capability while allowing the
-- EXPORT_CAPS carve-out that already exists — which is precisely the
-- "view-only until unfrozen" behaviour the feature asks for.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 WHY DELETION IS A REQUEST WITH A GRACE PERIOD, NOT A DELETE
-- ═══════════════════════════════════════════════════════════════════════════
-- `deletion_requested_at` + `deletion_purge_after` record INTENT. Nothing here
-- deletes anything, and no function in this migration can.
--
-- The actual deletion is billing-purge.js, which already exists, already has
-- five independent interlocks, already ships disarmed behind PURGE_ENABLED,
-- already has a dry-run mode and already caps its own blast radius. Writing a
-- second destructive path — one reachable from a button in the UI — would mean
-- the careful one and the careless one both existed, and a mis-click on the
-- careless one is unrecoverable.
--
-- 30 days, not 90: this is a deliberate act by the account owner, not a lapse
-- they may not have noticed. But it is still recoverable, because "that wasn't
-- me" and "I changed my mind" both happen, and neither is served by an
-- immediate irreversible delete.
--
-- Requesting deletion ALSO freezes, so nothing accrues during the window.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- No new tables, so no new policies. The columns inherit the RLS already on
-- entitlements, workspace_members and audit_results — service key only, the
-- same posture as 0029/0030/0031. Every write goes through a Netlify function.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Account state
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.entitlements
  add column if not exists frozen_at             timestamptz,
  add column if not exists frozen_by             uuid,
  add column if not exists frozen_reason         text,
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_purge_after  timestamptz;

comment on column public.entitlements.frozen_at is
  'User-chosen freeze. SEPARATE from `status`: billing continues, no dunning, no purge clock. Read by entitlementModel.can().';
comment on column public.entitlements.deletion_purge_after is
  'When billing-purge.js may act. Recording intent only — nothing in migration 0032 deletes anything.';

-- Lets billing-purge.js find due accounts without a full scan.
create index if not exists entitlements_deletion_due_idx
  on public.entitlements (deletion_purge_after)
  where deletion_purge_after is not null;

-- Freeze or unfreeze. Idempotent: re-freezing an already-frozen account does
-- not move frozen_at, so "frozen since" stays truthful.
create or replace function public.set_account_frozen(
  p_user_id uuid, p_frozen boolean, p_reason text default null, p_actor uuid default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return 'invalid'; end if;

  if p_frozen then
    update public.entitlements
       set frozen_at     = coalesce(frozen_at, now()),
           frozen_by     = coalesce(p_actor, p_user_id),
           frozen_reason = coalesce(p_reason, frozen_reason),
           version       = version + 1,
           updated_at    = now()
     where user_id = p_user_id;
  else
    -- ⚠️ An account awaiting deletion may NOT simply be unfrozen. The freeze is
    -- part of that state; lifting it alone would leave an account consuming
    -- units while a purge date sits on it. Cancelling the deletion is what
    -- unfreezes, and that is a different, deliberate call.
    if exists (select 1 from public.entitlements
                where user_id = p_user_id and deletion_requested_at is not null) then
      return 'deletion_pending';
    end if;
    update public.entitlements
       set frozen_at = null, frozen_by = null, frozen_reason = null,
           version = version + 1, updated_at = now()
     where user_id = p_user_id;
  end if;

  if not found then return 'not_found'; end if;
  return 'ok';
end; $$;

-- Record a deletion request. Freezes immediately; deletes nothing, ever.
create or replace function public.request_account_deletion(
  p_user_id uuid, p_grace_days integer default 30
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_after timestamptz;
begin
  if p_user_id is null then return null; end if;
  -- Clamped: a 0-day grace period is an immediate irreversible delete wearing
  -- this function's name, and the whole point of the grace period is that no
  -- caller can opt out of it.
  v_after := now() + make_interval(days => greatest(1, least(coalesce(p_grace_days, 30), 90)));

  update public.entitlements
     set deletion_requested_at = coalesce(deletion_requested_at, now()),
         deletion_purge_after  = coalesce(deletion_purge_after, v_after),
         frozen_at             = coalesce(frozen_at, now()),
         frozen_reason         = coalesce(frozen_reason, 'deletion_requested'),
         version               = version + 1,
         updated_at            = now()
   where user_id = p_user_id;

  if not found then return null; end if;
  select deletion_purge_after into v_after from public.entitlements where user_id = p_user_id;
  return v_after;
end; $$;

-- Cancel a pending deletion, and unfreeze with it.
create or replace function public.cancel_account_deletion(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  update public.entitlements
     set deletion_requested_at = null,
         deletion_purge_after  = null,
         frozen_at             = case when frozen_reason = 'deletion_requested' then null else frozen_at end,
         frozen_by             = case when frozen_reason = 'deletion_requested' then null else frozen_by end,
         frozen_reason         = case when frozen_reason = 'deletion_requested' then null else frozen_reason end,
         version               = version + 1,
         updated_at            = now()
   where user_id = p_user_id and deletion_requested_at is not null;
  if not found then return 'not_pending'; end if;
  return 'ok';
end; $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Per-member pause
-- ═══════════════════════════════════════════════════════════════════════════
-- The same idea as an account freeze, scoped to one seat: a paused member keeps
-- read and export access and loses everything that consumes account units. It
-- is NOT a removal — the seat is still theirs, still counted, and the history
-- attributed to them is untouched.
alter table public.workspace_members
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by uuid;

comment on column public.workspace_members.paused_at is
  'Per-seat pause. Read alongside entitlements.frozen_at by the extract/audit gates. Still occupies a seat.';

create or replace function public.set_workspace_member_paused(
  p_workspace_id uuid, p_actor uuid, p_target_user uuid, p_paused boolean
) returns text language plpgsql security definer set search_path = public as $$
declare v_actor_role text; v_target_role text;
begin
  select role into v_actor_role from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_actor;
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    return 'forbidden';
  end if;

  select role into v_target_role from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_target_user;
  if v_target_role is null then return 'not_found'; end if;

  -- ⚠️ The owner can never be paused, by anybody, including themselves. An
  -- owner who has paused themselves cannot unpause themselves — the workspace
  -- would need support to recover. Same reasoning as owner_cannot_leave in
  -- 0031: the one role that cannot be locked out is the one that owns the way
  -- back in.
  if v_target_role = 'owner' then return 'cannot_pause_owner'; end if;

  -- An admin may not pause another admin, mirroring the removal rule in 0031.
  if v_actor_role = 'admin' and v_target_role = 'admin' and p_actor <> p_target_user then
    return 'forbidden';
  end if;

  update public.workspace_members
     set paused_at = case when p_paused then coalesce(paused_at, now()) else null end,
         paused_by = case when p_paused then p_actor else null end
   where workspace_id = p_workspace_id and user_id = p_target_user;

  return 'ok';
end; $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Audit executive summary
-- ═══════════════════════════════════════════════════════════════════════════
-- Generated ONCE, on first report view, and cached here so it travels with the
-- audit into every export rather than being regenerated per format (which would
-- give the PDF and the markdown different summaries of the same run).
--
-- ⚠️ Deliberately NOT generated inside the audit pipeline. AUDIT_BUDGET_MS
-- defaults to 8000ms against Netlify's 10s function timeout, and the 504 that
-- shipped in August came from exactly this: per-call timeouts that composed
-- additively with no notion of the platform's limit. An extra model call in
-- that path would re-create it.
--
-- `summary_model` is stored because the summary is prose a customer may
-- forward; six months later "which model wrote this" is a question with an
-- answer, not a shrug.
alter table public.audit_results
  add column if not exists summary_md           text,
  add column if not exists summary_model        text,
  add column if not exists summary_generated_at timestamptz;

comment on column public.audit_results.summary_md is
  'AI executive summary, generated lazily on first report view and cached. Optional: a missing summary degrades the report header to deterministic facts.';
