-- 0057_audit_subjects.sql — D7. The subject registry.
--
-- ── THE QUESTION D7 ANSWERS ───────────────────────────────────────────────
-- P1 audits a PAGE: `audits.target_id` points at `audit_targets`, and every
-- finding hangs off the audit. P2 audits things that are NOT pages — a brand, a
-- product, a service, a location. W11's BDS/PDS/SFS score exactly those. So how
-- does a business-level audit relate to a page-level one?
--
-- 🔴 THE RECORDED DEFAULT WAS A POLYMORPHIC `subject_type` + `subject_id` ON
-- `audit_issues`, AND IT IS THE WRONG SHAPE. A `subject_id` that points at
-- `audit_targets` on one row and `audit_entities` on the next CANNOT CARRY A
-- FOREIGN KEY, so nothing stops an issue referencing a brand deleted last
-- month. This repository has already been burned three times by a pointer the
-- database could not check — `audit_signals.raw_value`, `.evidence_json` and
-- `audit_recommendations.issue_id` were all declared and written by nothing,
-- and the read path returned `null` identically to "not applicable". An
-- unenforceable pointer is that same failure with a different spelling: it is
-- wrong SILENTLY. It would also have touched every reader of the P1 queue, the
-- diff engine and all four export formats at once.
--
-- ── SO THE AUDIT BECOMES POLYMORPHIC, ONE LEVEL UP ────────────────────────
--   audit_subjects ─< audits ─< audit_issues            ← UNCHANGED
--                           └─< audit_recommendations   ← UNCHANGED
--                           └─< audit_signals           ← UNCHANGED
--
-- The polymorphism lives in a CHECK constraint the database enforces, over
-- three columns each of which is a REAL foreign key, instead of in one bare
-- uuid the database cannot check at all. One queue is preserved — findings
-- still hang off `audit_id` — which was the actual goal all along.
--
-- ⚠️ `audits.target_id` IS KEPT AND MUST NEVER BE DROPPED. It is not redundant:
-- it is the fast path for the page case, it is what every existing query uses,
-- and dropping it would recreate the exact blast radius this design exists to
-- avoid. `subject_id` is ADDITIVE. A pre-0057 audit has a NULL subject_id and
-- keeps working unchanged — that is the backward-compatibility contract, and
-- `auditDiff` falls back to `target_id` for precisely those rows.
--
-- Naming follows D3: the `audit_` prefix, not the PRD's `discoverability_`.

-- ── Subjects ───────────────────────────────────────────────────────────────
create table if not exists public.audit_subjects (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,

  subject_kind     text not null check (subject_kind in
                     ('page','domain','brand','product','service','location')),

  -- 🔴 EXACTLY ONE of these is non-null, and every one is a REAL foreign key.
  target_id        uuid references public.audit_targets(id)                on delete cascade,
  entity_id        uuid references public.audit_entities(id)               on delete cascade,
  truth_record_id  uuid references public.audit_business_truth_records(id) on delete cascade,

  label            text not null check (length(btrim(label)) > 0),

  -- The same bridge key W9 and W10 already use, and public.canonical_entities
  -- (0041) before them. Bare host, lower-case, no `www.`, or one company gets
  -- resolved twice and the halves disagree.
  canonical_domain text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint audit_subjects_exactly_one_ref check (
    (target_id       is not null)::int
  + (entity_id       is not null)::int
  + (truth_record_id is not null)::int = 1
  ),

  -- Without this, `subject_kind` and the actual reference could disagree —
  -- which is the polymorphic bug back again, one column over. A `page` subject
  -- pointing at a brand entity would score a brand and report it as a page.
  constraint audit_subjects_kind_matches_ref check (
    (subject_kind = 'page' and target_id is not null)
    or (subject_kind = 'domain' and (target_id is not null or truth_record_id is not null))
    or (subject_kind in ('brand','product','service','location') and entity_id is not null)
  )
);

-- One subject per owner per referenced row per kind. Three partial indexes
-- rather than one composite, because a composite over three nullable columns
-- does not constrain anything in Postgres: NULLs never collide. Without these
-- a re-audit mints a second subject and the history scatters — the same defect
-- `audit_targets_owner_url_idx` exists to prevent for pages.
create unique index if not exists audit_subjects_target_idx
  on public.audit_subjects (user_id, subject_kind, target_id) where target_id is not null;
create unique index if not exists audit_subjects_entity_idx
  on public.audit_subjects (user_id, subject_kind, entity_id) where entity_id is not null;
create unique index if not exists audit_subjects_truth_idx
  on public.audit_subjects (user_id, subject_kind, truth_record_id) where truth_record_id is not null;

create index if not exists audit_subjects_owner_kind_idx
  on public.audit_subjects (user_id, subject_kind, created_at desc);
create index if not exists audit_subjects_domain_idx
  on public.audit_subjects (user_id, canonical_domain) where canonical_domain is not null;

comment on table public.audit_subjects is
  'D7. One row per audited thing. The polymorphism lives in CHECK constraints over three real foreign keys, never in a bare uuid. audits.target_id is kept and must never be dropped.';

-- ── The audit points at its subject ────────────────────────────────────────
-- Nullable, and `on delete set null`: losing the subject registry entry must
-- never destroy an audit that was run and charged for.
alter table public.audits
  add column if not exists subject_id uuid references public.audit_subjects(id) on delete set null;

create index if not exists audits_subject_idx
  on public.audits (subject_id, created_at desc) where subject_id is not null;

comment on column public.audits.subject_id is
  'D7. NULL on every pre-0057 audit and that is valid — readers fall back to target_id. Comparability is "same subject" where both sides have one, "same target" otherwise.';

-- ── Backfill ───────────────────────────────────────────────────────────────
-- One `page` subject per existing target, then point every audit at its own.
-- Written to be RE-RUNNABLE: `on conflict do nothing` plus a `where` that skips
-- audits already pointed, so applying this file twice changes nothing the
-- second time. A migration that is only correct once is a migration nobody can
-- safely re-apply after a partial failure.
insert into public.audit_subjects (user_id, workspace_id, subject_kind, target_id, label, canonical_domain)
select t.user_id, t.workspace_id, 'page', t.id,
       coalesce(nullif(btrim(t.label), ''), t.canonical_url),
       t.host
  from public.audit_targets t
on conflict do nothing;

update public.audits a
   set subject_id = s.id
  from public.audit_subjects s
 where s.target_id = a.target_id
   and s.subject_kind = 'page'
   and s.user_id = a.user_id
   and a.subject_id is null;

-- ── Get-or-create ──────────────────────────────────────────────────────────
-- Mirrors upsert_audit_target: the application asks for a subject and gets one,
-- whether or not it already existed. Idempotent by the partial unique indexes
-- above, so two concurrent audits of the same brand cannot mint two subjects.
create or replace function public.upsert_audit_subject(
  p_user_id uuid,
  p_kind text,
  p_target_id uuid default null,
  p_entity_id uuid default null,
  p_truth_record_id uuid default null,
  p_label text default null,
  p_canonical_domain text default null,
  p_workspace_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- The CHECKs would refuse this anyway; naming it here makes the refusal
  -- legible to the caller instead of surfacing as a constraint violation.
  if (p_target_id is not null)::int
   + (p_entity_id is not null)::int
   + (p_truth_record_id is not null)::int <> 1 then
    raise exception 'upsert_audit_subject: exactly one reference is required';
  end if;

  select id into v_id from public.audit_subjects
   where user_id = p_user_id
     and subject_kind = p_kind
     and target_id is not distinct from p_target_id
     and entity_id is not distinct from p_entity_id
     and truth_record_id is not distinct from p_truth_record_id;

  if v_id is not null then
    update public.audit_subjects
       set label = coalesce(nullif(btrim(p_label), ''), label),
           canonical_domain = coalesce(p_canonical_domain, canonical_domain),
           workspace_id = coalesce(p_workspace_id, workspace_id),
           updated_at = now()
     where id = v_id;
    return v_id;
  end if;

  insert into public.audit_subjects
    (user_id, workspace_id, subject_kind, target_id, entity_id, truth_record_id,
     label, canonical_domain)
  values
    (p_user_id, p_workspace_id, p_kind, p_target_id, p_entity_id, p_truth_record_id,
     coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
  returning id into v_id;

  return v_id;
end $$;

comment on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) is
  'D7 get-or-create. Refuses anything but exactly one reference, so the CHECK can never be reached with a confusing message.';

revoke all on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) to service_role;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.audit_subjects enable row level security;

drop policy if exists audit_subjects_service on public.audit_subjects;
create policy audit_subjects_service on public.audit_subjects
  for all to service_role using (true) with check (true);

revoke all on public.audit_subjects from anon, authenticated;

drop trigger if exists audit_subjects_touch on public.audit_subjects;
create trigger audit_subjects_touch
  before update on public.audit_subjects
  for each row execute function public.audit_touch_updated_at();
