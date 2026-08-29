-- 0031_team_workspaces.sql
-- Real multi-user workspaces: /workspace today is a single-owner dashboard —
-- nobody can be invited into it, despite pricingConfig.js already selling
-- "5 client workspaces" on Agency and a paid "Extra Workspace" add-on. This
-- migration builds the primitive those claims assume exists.
--
-- ── WHY ONE SHARED TABLE, NOT A DISCOVERABILITY-SPECIFIC ONE ───────────────
-- 0030_discoverability_audits.sql already reserved a nullable `workspace_id`
-- on all six of its tables, with the comment: "PRD workspaces -> auth.users.id,
-- with a nullable workspace_id column reserved on every table for when team
-- workspaces ship." That sentence anticipated exactly this migration. A
-- second, module-specific workspaces table would be the mistake that comment
-- was written to avoid — so this is the ONE table every reserved column
-- eventually points at. Backfilling audit_targets / audits / audit_schedules /
-- etc. with real workspace_id values is a follow-up migration, not this one;
-- this one only has to make the id they'll point at real.
--
-- ── TWO-LEVEL MODEL, MATCHING WHAT'S ALREADY SOLD ───────────────────────────
-- pricingConfig.js has two independent numbers per plan: `workspaces` (how many
-- separate workspaces a user may OWN — 1 on every plan except Agency's 5) and
-- `team_seats` (how many members belong to ONE of their workspaces — 1 on most
-- plans, 3 on Business, 5 on Agency). entitlementModel.js's `workspace.create`
-- and `workspace.team_seats` capabilities already model exactly this split;
-- this migration is the storage those two checks were written ahead of.
--
-- ── SEAT COUNTING INCLUDES THE OWNER ────────────────────────────────────────
-- A workspace's owner gets a `workspace_members` row too (role='owner'),
-- inserted atomically with the workspace itself in create_workspace(). So
-- "team_seats: 3" on Business means 3 people total in a workspace, owner
-- included — the simpler, more common SaaS convention, and it keeps seat
-- math a single `count(*)` with no "+1 for the owner" special case scattered
-- through the app.
--
-- ── WHY THE SEAT CAP IS NOT ENFORCED IN SQL ─────────────────────────────────
-- team_seats and workspaces live in pricingConfig.js, not in a database row —
-- there is no plan table to join against here. So, same split as
-- 0029_referrals.sql (JS decides eligibility from plan data, SQL enforces
-- state integrity): the caller (netlify/functions/lib/workspaces.js) checks
-- entitlementModel.can("workspace.team_seats"/"workspace.create") BEFORE
-- calling these functions. That is advisory, not airtight — two simultaneous
-- invites can race past a cap by one seat. Workspace membership changes are a
-- low-frequency admin action, not a public redemption surface, so this is an
-- accepted trade-off, not an oversight; if it ever needs to be airtight, a
-- cached seat-cap column on `workspaces`, refreshed on plan change, is the
-- follow-up.
--
-- ── RLS ──────────────────────────────────────────────────────────────────
-- Same posture as referrals and scrape-consent: SERVICE KEY ONLY on every
-- table, no anon or authenticated policy at all. Architecture rule already
-- requires the browser to reach Supabase only through apiClient.js ->
-- Netlify Functions, so a direct-read RLS policy would be unused capability
-- with a security cost, not a convenience.

create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspaces_owner_idx on public.workspaces (owner_id);

create table if not exists public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on public.workspace_members (user_id);
create index if not exists workspace_members_workspace_idx on public.workspace_members (workspace_id);

create table if not exists public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Stored lowercased/trimmed by the issuing function. Acceptance requires the
  -- accepting user's OWN JWT email to match this — the same reasoning as
  -- 0029_referrals.sql's signed-in-only rule: a token that anyone signed in
  -- could redeem is not an invite, it is a shareable coupon for a seat.
  email        text not null,
  -- 64 hex chars from two concatenated gen_random_uuid()s rather than
  -- gen_random_bytes(), so this needs no pgcrypto extension — gen_random_uuid()
  -- is already relied on as the default for every uuid primary key in this
  -- schema, so it is known to be available everywhere these migrations run.
  token        text not null unique,
  role         text not null default 'member' check (role in ('admin', 'member')),
  invited_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '14 days'),
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id),
  revoked_at   timestamptz
);

create index if not exists workspace_invites_workspace_idx on public.workspace_invites (workspace_id);
create index if not exists workspace_invites_token_idx on public.workspace_invites (token);

-- At most one PENDING invite per (workspace, email) — re-inviting the same
-- address just needs to reuse or replace that row, not pile up duplicates a
-- human then has to sort out.
create unique index if not exists workspace_invites_pending_unique
  on public.workspace_invites (workspace_id, email)
  where accepted_at is null and revoked_at is null;

alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'workspaces' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.workspaces
             for all to service_role using (true) with check (true)';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'workspace_members' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.workspace_members
             for all to service_role using (true) with check (true)';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'workspace_invites' and policyname = 'service full access'
  ) then
    execute 'create policy "service full access" on public.workspace_invites
             for all to service_role using (true) with check (true)';
  end if;
end $$;

-- ── Create ───────────────────────────────────────────────────────────────
-- Atomic: the workspace and its owner's membership row are created together,
-- so there is never a moment where a workspace exists with zero members (a
-- seat count of 0 would make "how many seats does this workspace use"
-- ambiguous for every caller downstream).
create or replace function public.create_workspace(p_owner_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if p_owner_id is null then
    raise exception 'create_workspace requires an owner id';
  end if;
  if v_name = '' then
    v_name := 'My workspace';
  end if;

  insert into public.workspaces (owner_id, name) values (p_owner_id, v_name)
    returning id into v_id;
  insert into public.workspace_members (workspace_id, user_id, role)
    values (v_id, p_owner_id, 'owner');

  return v_id;
end $$;

-- ── Invite ───────────────────────────────────────────────────────────────
-- Verdicts: {"ok":true,"token":...,"expiresAt":...}
--           {"ok":false,"reason":"not_authorized"|"already_member"|"already_invited"|"invalid"}
--
-- The role check is enforced here, not just in the JS handler — belt and
-- braces, same as referral_no_self being a CHECK constraint AND a handler
-- check, so a future handler bug cannot let a plain member mint invites.
create or replace function public.create_workspace_invite(
  p_workspace_id uuid, p_email text, p_role text, p_invited_by uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor_role text;
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_role       text := coalesce(p_role, 'member');
  v_token      text;
  v_expires    timestamptz := now() + interval '14 days';
begin
  if p_workspace_id is null or p_invited_by is null or v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_role not in ('admin', 'member') then
    v_role := 'member';
  end if;

  select role into v_actor_role
    from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_invited_by;
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;

  if exists (
    select 1 from public.workspace_members wm
      join auth.users u on u.id = wm.user_id
     where wm.workspace_id = p_workspace_id and lower(u.email) = v_email
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_member');
  end if;

  if exists (
    select 1 from public.workspace_invites
     where workspace_id = p_workspace_id and email = v_email
       and accepted_at is null and revoked_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_invited');
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.workspace_invites
    (workspace_id, email, token, role, invited_by, expires_at)
  values
    (p_workspace_id, v_email, v_token, v_role, p_invited_by, v_expires);

  return jsonb_build_object('ok', true, 'token', v_token, 'expiresAt', v_expires);
end $$;

-- ── Accept ───────────────────────────────────────────────────────────────
-- Verdicts: {"ok":true,"workspaceId":...}
--           {"ok":false,"reason":"invalid"|"revoked"|"expired"|"already_accepted"|"email_mismatch"}
--
-- Idempotent by design (on conflict do nothing on the membership insert): a
-- double-submit from a slow network retry lands the user in the workspace
-- once, not an error the second time.
create or replace function public.accept_workspace_invite(
  p_token text, p_user_id uuid, p_user_email text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_invite record;
  v_email  text := lower(btrim(coalesce(p_user_email, '')));
begin
  if p_token is null or p_user_id is null or v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_invite from public.workspace_invites where token = p_token;
  if v_invite is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_invite.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_invite.accepted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_accepted');
  end if;
  if v_invite.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_invite.email <> v_email then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch');
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
    values (v_invite.workspace_id, p_user_id, v_invite.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invites
     set accepted_at = now(), accepted_by = p_user_id
   where id = v_invite.id;

  return jsonb_build_object('ok', true, 'workspaceId', v_invite.workspace_id);
end $$;

-- ── Remove / leave ───────────────────────────────────────────────────────
-- Verdicts: {"ok":true} / {"ok":false,"reason":"not_authorized"|"owner_cannot_leave"|"cannot_remove_owner"}
--
-- Rules: the owner can remove any admin or member but cannot remove
-- themselves (leaving would orphan the workspace's billing identity — the
-- owner's plan is what funds every seat in it); an admin may remove a
-- member but not another admin or the owner; anyone may remove themselves
-- except the owner.
create or replace function public.remove_workspace_member(
  p_workspace_id uuid, p_actor_id uuid, p_target_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor_role  text;
  v_target_role text;
begin
  select role into v_actor_role
    from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_actor_id;
  select role into v_target_role
    from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_target_user_id;

  if v_target_role is null then
    return jsonb_build_object('ok', true); -- already not a member; idempotent
  end if;

  if p_actor_id = p_target_user_id then
    if v_actor_role = 'owner' then
      return jsonb_build_object('ok', false, 'reason', 'owner_cannot_leave');
    end if;
  else
    if v_target_role = 'owner' then
      return jsonb_build_object('ok', false, 'reason', 'cannot_remove_owner');
    end if;
    if v_actor_role = 'owner' then
      -- may remove anyone non-owner
    elsif v_actor_role = 'admin' and v_target_role = 'member' then
      -- may remove a plain member
    else
      return jsonb_build_object('ok', false, 'reason', 'not_authorized');
    end if;
  end if;

  delete from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_target_user_id;

  return jsonb_build_object('ok', true);
end $$;
