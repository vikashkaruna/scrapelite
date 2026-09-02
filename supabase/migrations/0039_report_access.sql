-- 0039_report_access.sql
-- Phase 2 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md — §2.2a.
--
-- ── WHAT THIS REPLACES, AND THE BUG IT CLOSES ───────────────────────────────
-- 0007_public_reports.sql made the slug the ONLY auth: "public read" is
-- `USING (is_public = true)` and therefore exposes EVERY COLUMN — session_id
-- included — to anyone holding the URL. CLAUDE.md already carries the warning
-- that the obvious fix (send an x-session-id header so the "owner update"
-- branch matches) would be strictly worse: it would let any READER of a public
-- report rewrite or delete it.
--
-- The correct fix, which PRD 2 forces anyway, is to stop resolving visibility
-- in RLS and resolve it in ONE function reading the service key. That is
-- resolve_report_access() below, and public-reports.js is its only caller.
--
-- ── THE STATE MACHINE (decision D3, resolved 2026-09-02) ────────────────────
--   private ──publish(link|org|named|public)──▶ shared   [slug minted on FIRST publish]
--   shared  ──unpublish()─────────────────────▶ private  [slug RETAINED]
--   shared  ──set_visibility(state)───────────▶ shared   [no slug change]
--   any     ──revoke()────────────────────────▶ revoked  [TERMINAL; slug burned]
--   any     ──expires_at passes───────────────▶ denied   [owner may re-publish]
--
-- ── WHY unpublish AND revoke ARE DIFFERENT VERBS ────────────────────────────
-- Collapsing them forces a user to choose between convenience and safety on
-- every click, so they pick convenience and stop using the safe one.
--   unpublish  reversible. The slug is kept, so re-publishing revives the link
--              a colleague already has. This is what "hide this for now" means.
--   revoke     terminal. The slug is burned and can never be reissued.
--
-- ── HOW A BURNED SLUG STAYS BURNED, WITH NO EXTRA TABLE ─────────────────────
-- A revoked report KEEPS its slug and its row. Because `slug` is UNIQUE, the
-- revoked row permanently occupies that slug and mint_report_slug() can never
-- hand it out again. Deleting the row instead would silently return the slug
-- to the pool — and the next report to receive it would be readable by
-- everyone who still had the old link.
--
-- ── REVOCATION MUST BE IMMEDIATE, SO NOTHING MAY BE CACHED ──────────────────
-- PRD 2: "Revoking a link blocks access immediately." That is unachievable if
-- the report body is edge-cached, so resolve_report_access() is called PER
-- REQUEST and public-reports.js must send no-store on report bodies.
--
-- ── MIGRATION OF EXISTING public_reports ROWS ───────────────────────────────
-- Every existing row exists BECAUSE A USER PRESSED SHARE — that is "make it
-- public" already having been exercised, so sending them to `private` would
-- silently break links already in third parties' hands. They land on `link`
-- (reachable, unlisted, noindex). The `curated = true` subset already surfaced
-- in /gallery lands on `public`, so the gallery is unchanged by this migration.
--
-- Adds 3 tables, 5 functions, 1 trigger.

-- ── the report ──────────────────────────────────────────────────────────────
create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  -- NULL until first publish. A private report has no URL, so there is
  -- nothing to guess at and nothing to leak.
  slug          text unique,
  owner_id      uuid references auth.users,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  run_id        text references public.template_runs(id) on delete set null,
  -- Denormalised so a report still renders if its run is purged.
  title         text not null,
  source_url    text,
  template_key  text,
  data          jsonb not null default '{}'::jsonb,
  visibility    text not null default 'private',
  expires_at    timestamptz,
  revoked_at    timestamptz,
  published_at  timestamptz,
  -- Free tier keeps DatIQ attribution. Enforced at RENDER, not at publish, so
  -- a plan downgrade cannot leave an unbranded page live.
  branding      jsonb not null default '{}'::jsonb,
  view_count    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint reports_visibility_chk check (visibility in (
    'private', 'link', 'org', 'named', 'public', 'revoked'
  )),
  -- Any state that is reachable by a URL must actually have one.
  constraint reports_shared_needs_slug_chk check (
    visibility in ('private', 'revoked') or slug is not null
  )
);

create index if not exists reports_owner_idx      on public.reports (owner_id, created_at desc);
create index if not exists reports_workspace_idx  on public.reports (workspace_id, created_at desc) where workspace_id is not null;
create index if not exists reports_run_idx        on public.reports (run_id) where run_id is not null;
create index if not exists reports_public_idx     on public.reports (published_at desc) where visibility = 'public';

-- ── named collaborators ─────────────────────────────────────────────────────
create table if not exists public.report_grants (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  -- Email, not user_id: you grant access to someone who may not have an
  -- account yet. Matched against the accepting session's own verified JWT
  -- email server-side, exactly as 0031's workspace invites are.
  email       text not null,
  granted_by  uuid references auth.users,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint report_grants_uniq unique (report_id, email)
);

create index if not exists report_grants_report_idx on public.report_grants (report_id) where revoked_at is null;

-- ── who opened what, and when ───────────────────────────────────────────────
-- PRD 2 asks for access logging AND report engagement analytics; one table
-- serves both. Retained rather than pruned, because "who saw this before we
-- revoked it" is the question this table exists to answer.
create table if not exists public.report_access_log (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  event       text not null,
  viewer_id   uuid references auth.users,
  viewer_hint text,                                  -- coarse: never a raw IP
  visibility  text,                                  -- state AT the time
  actor_id    uuid references auth.users,            -- who made a state change
  reason      text,
  created_at  timestamptz not null default now(),
  constraint report_access_log_event_chk check (event in (
    'viewed', 'denied', 'published', 'unpublished', 'revoked',
    'visibility_changed', 'expired', 'grant_added', 'grant_revoked'
  ))
);

create index if not exists report_access_log_report_idx on public.report_access_log (report_id, created_at desc);
create index if not exists report_access_log_event_idx  on public.report_access_log (event, created_at desc);

-- ── slug minting ────────────────────────────────────────────────────────────
-- 8 chars of base36. Retries on collision; a revoked row still owns its slug,
-- so a burned slug is never reissued.
create or replace function public.mint_report_slug()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_alphabet constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_slug text;
  v_i    integer;
  v_try  integer := 0;
begin
  loop
    v_try := v_try + 1;
    v_slug := '';
    for v_i in 1..8 loop
      v_slug := v_slug || substr(v_alphabet, 1 + floor(random() * 36)::int, 1);
    end loop;
    exit when not exists (select 1 from public.reports where slug = v_slug);
    if v_try > 24 then
      raise exception 'mint_report_slug: could not find a free slug after % attempts', v_try;
    end if;
  end loop;
  return v_slug;
end $$;

-- ── publish / change visibility ─────────────────────────────────────────────
-- D3 RESOLVED: REUSE. A report that was previously shared keeps its original
-- slug when re-published, so the link a colleague already holds starts working
-- again. Burning a link is the separate, explicit revoke_report() action.
create or replace function public.set_report_visibility(
  p_report_id uuid, p_visibility text, p_actor uuid default null, p_expires_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.reports%rowtype;
begin
  select * into r from public.reports where id = p_report_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if r.visibility = 'revoked' then
    -- Terminal by design: a revoked link must not be resurrectable, or
    -- "revoke" would be indistinguishable from "unpublish" to an attacker
    -- who already holds the URL.
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if p_actor is not null and r.owner_id is not null and r.owner_id <> p_actor then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  if p_visibility not in ('private', 'link', 'org', 'named', 'public') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_visibility');
  end if;

  if p_visibility = 'private' then
    -- unpublish: keep the slug so a later publish revives the same URL.
    update public.reports
       set visibility = 'private', expires_at = null, updated_at = now()
     where id = p_report_id;
    insert into public.report_access_log (report_id, event, actor_id, visibility)
      values (p_report_id, 'unpublished', p_actor, 'private');
    return jsonb_build_object('ok', true, 'visibility', 'private', 'slug', r.slug);
  end if;

  -- Mint on FIRST publish only; reuse thereafter (D3).
  if r.slug is null then
    r.slug := public.mint_report_slug();
  end if;

  update public.reports
     set visibility   = p_visibility,
         slug         = r.slug,
         expires_at   = p_expires_at,
         published_at = coalesce(published_at, now()),
         updated_at   = now()
   where id = p_report_id;

  insert into public.report_access_log (report_id, event, actor_id, visibility)
    values (p_report_id,
            case when r.visibility = 'private' then 'published' else 'visibility_changed' end,
            p_actor, p_visibility);

  return jsonb_build_object('ok', true, 'visibility', p_visibility, 'slug', r.slug);
end $$;

-- ── revoke: terminal, burns the slug ────────────────────────────────────────
create or replace function public.revoke_report(
  p_report_id uuid, p_actor uuid default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.reports%rowtype;
begin
  select * into r from public.reports where id = p_report_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_actor is not null and r.owner_id is not null and r.owner_id <> p_actor then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  if r.visibility = 'revoked' then
    return jsonb_build_object('ok', true, 'visibility', 'revoked', 'already', true);
  end if;

  -- The slug is KEPT on the revoked row. That is what burns it: the UNIQUE
  -- index means mint_report_slug() can never hand it out again.
  update public.reports
     set visibility = 'revoked', revoked_at = now(), expires_at = null, updated_at = now()
   where id = p_report_id;

  update public.report_grants set revoked_at = now()
   where report_id = p_report_id and revoked_at is null;

  insert into public.report_access_log (report_id, event, actor_id, visibility, reason)
    values (p_report_id, 'revoked', p_actor, 'revoked', p_reason);

  return jsonb_build_object('ok', true, 'visibility', 'revoked');
end $$;

-- ── the single choke point every read goes through (§1.9) ───────────────────
-- Returns the verdict AND the payload, so a caller cannot accidentally fetch
-- the row by another path and skip the check.
create or replace function public.resolve_report_access(
  p_slug text,
  p_viewer_id uuid default null,
  p_viewer_email text default null,
  p_log boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r        public.reports%rowtype;
  v_ok     boolean := false;
  v_reason text    := 'not_found';
begin
  select * into r from public.reports where slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if r.visibility = 'revoked' then
    v_reason := 'revoked';
  elsif r.visibility = 'private' then
    v_reason := 'private';
  elsif r.expires_at is not null and r.expires_at <= now() then
    v_reason := 'expired';
  elsif r.visibility in ('public', 'link') then
    v_ok := true;
  elsif r.visibility = 'org' then
    if p_viewer_id is not null and r.workspace_id is not null and exists (
      select 1 from public.workspace_members m
       where m.workspace_id = r.workspace_id and m.user_id = p_viewer_id
    ) then v_ok := true; else v_reason := 'not_in_workspace'; end if;
  elsif r.visibility = 'named' then
    -- Email-bound, matched against the caller's own verified JWT email —
    -- the same rule 0031's workspace invites use, and for the same reason:
    -- a link is useless to anyone it was not actually sent to.
    if p_viewer_email is not null and exists (
      select 1 from public.report_grants g
       where g.report_id = r.id and g.revoked_at is null
         and lower(g.email) = lower(p_viewer_email)
    ) then v_ok := true; else v_reason := 'not_granted'; end if;
  end if;

  -- The owner always sees their own report, in any state except revoked.
  if not v_ok and p_viewer_id is not null and r.owner_id = p_viewer_id
     and r.visibility <> 'revoked' then
    v_ok := true; v_reason := 'owner';
  end if;

  if p_log then
    insert into public.report_access_log (report_id, event, viewer_id, visibility, reason)
      values (r.id, case when v_ok then 'viewed' else 'denied' end,
              p_viewer_id, r.visibility, case when v_ok then null else v_reason end);
    if v_ok then
      update public.reports set view_count = view_count + 1 where id = r.id;
    end if;
  end if;

  if not v_ok then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  return jsonb_build_object(
    'ok', true,
    'report', jsonb_build_object(
      'id', r.id, 'slug', r.slug, 'title', r.title, 'source_url', r.source_url,
      'template_key', r.template_key, 'data', r.data, 'visibility', r.visibility,
      'branding', r.branding, 'published_at', r.published_at,
      'created_at', r.created_at, 'updated_at', r.updated_at,
      -- Only `public` is indexable. Everything else carries noindex.
      'indexable', (r.visibility = 'public')
    )
  );
end $$;

create or replace function public.reports_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists reports_touch_updated_at_trg on public.reports;
create trigger reports_touch_updated_at_trg
  before update on public.reports
  for each row execute function public.reports_touch_updated_at();

-- ── carry the existing shared reports across ────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'public_reports') then
    insert into public.reports (
      slug, owner_id, title, source_url, data, visibility, published_at, created_at, updated_at
    )
    select p.slug,
           case when p.user_id ~ '^[0-9a-fA-F-]{36}$' then p.user_id::uuid else null end,
           coalesce(nullif(btrim(p.title), ''), 'Shared report'),
           p.url,
           coalesce(p.data, '{}'::jsonb),
           -- curated rows are already listed in /gallery -> stay public.
           -- everything else was shared by an explicit user action -> `link`.
           case when coalesce(p.curated, false) then 'public' else 'link' end,
           p.created_at, p.created_at, p.updated_at
      from public.public_reports p
     where p.slug is not null
       and not exists (select 1 from public.reports r where r.slug = p.slug);
  end if;
end $$;

-- ── RLS: service key only. The "public read" policy on public_reports is
-- deliberately NOT reproduced here — resolve_report_access() is the only path.
alter table public.reports           enable row level security;
alter table public.report_grants     enable row level security;
alter table public.report_access_log enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'reports' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.reports
             for all to service_role using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'report_grants' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.report_grants
             for all to service_role using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'report_access_log' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.report_access_log
             for all to service_role using (true) with check (true)';
  end if;
end $$;
