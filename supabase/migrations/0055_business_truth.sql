-- 0055_business_truth.sql — W9. The Canonical Business Truth Record.
--
-- Until now this module could say what a PAGE claims. It could not say what is
-- TRUE. Every P2 module needs the second thing: the entity graph needs a
-- subject, brand scoring needs a brand, NAP matching needs a name-address-phone
-- to match AGAINST, and the accuracy half of citation classification needs
-- something to check an engine's answer against — `citationStates.js` narrows
-- its accuracy check to price for exactly this reason, in its own header.
--
-- Naming follows decision D3: the `audit_` prefix, not the PRD's
-- `discoverability_`. One prefix across the whole module.
--
-- ── TWO TABLES, BECAUSE A RECORD AND ITS VERSIONS ARE DIFFERENT THINGS ─────
-- The record is the stable identity — "the truth record for acme.example" — and
-- is what other tables will point at. The versions are proposals, most of which
-- never become canonical. Folding them together would mean either losing the
-- history on every edit or making every consumer filter for the current row.
--
-- ── APPROVAL IS ENFORCED HERE TOO, NOT ONLY IN THE APPLICATION ────────────
-- `businessTruth.canPromote()` refuses self-approval. So does the CHECK
-- constraint below. This is the same three-layer discipline `ops_audit_log`
-- already uses for its mandatory reason: a rule that lives only in one endpoint
-- is a rule the next endpoint forgets, and this record is about to become the
-- thing other modules assert as true.

-- ── The record ─────────────────────────────────────────────────────────────
create table if not exists public.audit_business_truth_records (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  workspace_id      uuid,

  -- Optional. A truth record is about a BUSINESS, not a page — it can exist
  -- before any audit has run, and it outlives every individual audit. The
  -- target is a convenience link for the common case, never the identity.
  target_id         uuid references public.audit_targets(id) on delete set null,

  -- 🔴 THE BRIDGE KEY. `public.canonical_entities` (0041) already resolves a
  -- company from a domain for bulk enrichment. Carrying the same normalised
  -- host here is what stops this module resolving the same company a second
  -- time and disagreeing with itself. Bare host, lower-cased, no `www.` —
  -- `businessTruth.normalizeFieldValue('canonical_domain', …)` produces exactly
  -- this shape, and it is the one field both sides must spell identically.
  canonical_domain  text not null,

  display_name      text,

  -- Fields this business genuinely does not have, so completeness can EXCLUDE
  -- them and say so rather than scoring them zero. A business with no premises
  -- has no street address; counting that against them would report a correct
  -- record as a deficient one.
  not_applicable    text[] not null default '{}',

  status            text not null default 'active'
                      check (status in ('active', 'archived')),

  -- Set only by promotion. Null means no version has ever been approved, which
  -- is the honest state for a record somebody started and never finished.
  current_version_id uuid,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.audit_business_truth_records is
  'The stable identity of one business''s approved facts. Versions live in audit_business_truth_versions; this row only ever points at whichever one is canonical.';

comment on column public.audit_business_truth_records.canonical_domain is
  'Normalised bare host — lower-case, no www, no scheme, no path. The bridge key to public.canonical_entities so a company is resolved once across the platform. Must match businessTruth.normalizeFieldValue(''canonical_domain'', …) exactly.';

comment on column public.audit_business_truth_records.current_version_id is
  'The approved version other modules may assert as true. NULL until a first version is promoted — never defaulted to the newest draft, because an unreviewed draft asserted as truth is the failure this whole table exists to prevent.';

comment on column public.audit_business_truth_records.not_applicable is
  'Field ids that do not apply to this business. Excluded from completeness AND reported as excluded, never scored as zero.';

-- One live record per business per owner. A second record for the same domain
-- would give two answers to "what is true", which is the one thing this table
-- must never do. Archived rows are exempt so a record can be retired and
-- rebuilt.
create unique index if not exists audit_btr_owner_domain_uniq
  on public.audit_business_truth_records (user_id, canonical_domain)
  where status = 'active';

create index if not exists audit_btr_user_idx
  on public.audit_business_truth_records (user_id, updated_at desc);

create index if not exists audit_btr_workspace_idx
  on public.audit_business_truth_records (workspace_id)
  where workspace_id is not null;

-- ── The versions ───────────────────────────────────────────────────────────
create table if not exists public.audit_business_truth_versions (
  id              uuid primary key default gen_random_uuid(),
  record_id       uuid not null references public.audit_business_truth_records(id) on delete cascade,

  -- Monotonic per record. Human-readable in a way a uuid is not — "version 4
  -- was rejected" is a sentence somebody can act on.
  version_no      integer not null,

  state           text not null default 'draft'
                    check (state in ('draft','pending_review','approved','rejected','superseded')),

  -- The facts themselves: { fieldId: { value, source, evidence, stated_by,
  -- stated_at, … } } exactly as `businessTruth.makeFact` builds them. JSONB
  -- rather than a column per field because the field registry is a product
  -- decision that will move, and a migration per new fact would guarantee the
  -- registry and the schema drift apart.
  fields_json     jsonb not null default '{}'::jsonb,

  -- Denormalised from fields_json at write time so a list of versions does not
  -- need to recompute completeness for every row. Advisory: fields_json is the
  -- source of truth, and `truthCompleteness()` is the only implementation.
  completeness    numeric(5,2),

  -- Where this proposal came from. `audit` means an audit run proposed it from
  -- what it observed; that path must produce a DRAFT and never an approval.
  origin          text not null default 'manual'
                    check (origin in ('manual','audit','import')),
  source_audit_id uuid references public.audits(id) on delete set null,

  proposed_by     uuid references auth.users(id) on delete set null,
  proposed_at     timestamptz not null default now(),

  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,

  superseded_at   timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- 🔴 SELF-APPROVAL IS REFUSED BY THE DATABASE, NOT ONLY BY THE HANDLER.
  -- The entire value of `approved` is that a second person looked; one
  -- signature in both boxes is a draft with extra steps. NULL proposers are
  -- exempt because an imported or system-generated proposal has no human to
  -- collide with — and such a row still needs a real reviewer to reach
  -- `approved`, which the next constraint enforces.
  constraint audit_btv_no_self_approval check (
    state <> 'approved'
    or proposed_by is null
    or reviewed_by is null
    or reviewed_by <> proposed_by
  ),

  -- An approved version with no reviewer recorded is an approval by nobody.
  constraint audit_btv_approved_has_reviewer check (
    state <> 'approved' or (reviewed_by is not null and reviewed_at is not null)
  ),

  -- A rejection with no reason is indistinguishable from a mis-click three
  -- months later. Same rule, and the same reasoning, as the dismissal reason
  -- `audit_recommendations` already enforces.
  constraint audit_btv_rejected_has_reason check (
    state <> 'rejected' or (review_note is not null and length(btrim(review_note)) > 0)
  ),

  constraint audit_btv_version_no_positive check (version_no > 0)
);

comment on table public.audit_business_truth_versions is
  'One proposed set of business facts. Most versions never become canonical — that is the point of a version, and the rejected ones with their reasons are some of the most useful rows here.';

comment on column public.audit_business_truth_versions.fields_json is
  'Facts as businessTruth.makeFact builds them: value plus source, evidence, who stated it and when. An `observed` fact without an evidence record is refused by the model layer — a claim of verifiability with nothing to verify against is a guess wearing a warranty.';

comment on column public.audit_business_truth_versions.origin is
  '''audit'' means an audit run proposed this from what it observed. Such a version is always a DRAFT: a page reading is a proposal about the business, never a decision by it.';

comment on column public.audit_business_truth_versions.completeness is
  'Advisory copy of truthCompleteness().percent at write time, so listing versions needs no recomputation. fields_json remains the source of truth.';

create unique index if not exists audit_btv_record_version_uniq
  on public.audit_business_truth_versions (record_id, version_no);

create index if not exists audit_btv_record_idx
  on public.audit_business_truth_versions (record_id, version_no desc);

create index if not exists audit_btv_pending_idx
  on public.audit_business_truth_versions (record_id)
  where state = 'pending_review';

-- The circular reference, added once both tables exist. `on delete set null`
-- rather than cascade: losing the pointer must never delete the record whose
-- history it indexes.
alter table public.audit_business_truth_records
  drop constraint if exists audit_btr_current_version_fk;

alter table public.audit_business_truth_records
  add constraint audit_btr_current_version_fk
  foreign key (current_version_id)
  references public.audit_business_truth_versions(id)
  on delete set null;

-- ── Conflicts found against the canonical record ───────────────────────────
--
-- Written by an audit when a page contradicts the approved truth. Kept as rows
-- rather than recomputed on read because the finding is about a MOMENT — the
-- page said this on that date — and re-deriving it later against a record that
-- has since changed would rewrite history.
create table if not exists public.audit_business_truth_conflicts (
  id             uuid primary key default gen_random_uuid(),
  record_id      uuid not null references public.audit_business_truth_records(id) on delete cascade,
  audit_id       uuid references public.audits(id) on delete cascade,
  version_id     uuid references public.audit_business_truth_versions(id) on delete set null,

  -- A public contract, exactly like the signal and issue codes. Add codes;
  -- never repurpose or renumber one.
  code           text not null check (code in ('BT-01','BT-02','BT-03','BT-04')),
  field          text not null,
  severity       text not null default 'medium' check (severity in ('low','medium','high')),

  canonical_value text,
  observed_value  text,
  -- The evidence record for the observed side, as makeEvidence built it. NULL
  -- for BT-02, where the finding IS that nothing was observed.
  evidence_json   jsonb,

  resolved_at    timestamptz,
  resolution     text check (resolution is null or resolution in ('record_updated','page_updated','not_a_conflict')),

  created_at     timestamptz not null default now()
);

comment on table public.audit_business_truth_conflicts is
  'Where an audited page disagreed with the approved record. BT-01 is a contradiction; BT-02 is an absence — different codes because they have opposite remedies, and telling a customer their address is wrong when the page simply never mentions it wastes the fix.';

create index if not exists audit_btc_record_idx
  on public.audit_business_truth_conflicts (record_id, created_at desc);

create index if not exists audit_btc_open_idx
  on public.audit_business_truth_conflicts (record_id)
  where resolved_at is null;

create index if not exists audit_btc_audit_idx
  on public.audit_business_truth_conflicts (audit_id)
  where audit_id is not null;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Service-key only, matching every other table in this module. The browser
-- reaches Supabase exclusively through Netlify Functions, so a direct-read
-- policy would be unused attack surface.
alter table public.audit_business_truth_records  enable row level security;
alter table public.audit_business_truth_versions enable row level security;
alter table public.audit_business_truth_conflicts enable row level security;

drop policy if exists audit_btr_service on public.audit_business_truth_records;
create policy audit_btr_service on public.audit_business_truth_records
  for all to service_role using (true) with check (true);

drop policy if exists audit_btv_service on public.audit_business_truth_versions;
create policy audit_btv_service on public.audit_business_truth_versions
  for all to service_role using (true) with check (true);

drop policy if exists audit_btc_service on public.audit_business_truth_conflicts;
create policy audit_btc_service on public.audit_business_truth_conflicts
  for all to service_role using (true) with check (true);

revoke all on public.audit_business_truth_records  from anon, authenticated;
revoke all on public.audit_business_truth_versions from anon, authenticated;
revoke all on public.audit_business_truth_conflicts from anon, authenticated;

-- Reuse the trigger function 0030 already created for this module rather than
-- adding a second one that does the same thing.
drop trigger if exists audit_btr_touch on public.audit_business_truth_records;
create trigger audit_btr_touch
  before update on public.audit_business_truth_records
  for each row execute function public.audit_touch_updated_at();

drop trigger if exists audit_btv_touch on public.audit_business_truth_versions;
create trigger audit_btv_touch
  before update on public.audit_business_truth_versions
  for each row execute function public.audit_touch_updated_at();

-- ── Promotion ──────────────────────────────────────────────────────────────
--
-- 🔴 ONE FUNCTION, BECAUSE PROMOTION IS THREE WRITES THAT MUST NOT SEPARATE.
-- Promoting means: mark the outgoing version superseded, mark the incoming one
-- approved, and repoint the record. Doing that as three PostgREST calls leaves
-- windows where the record points at a superseded version, or at nothing, or at
-- two versions that both believe they are current. It is one statement.
--
-- The gate is re-checked here rather than trusted from the caller, for the same
-- reason the CHECK constraints exist: this is the last place before a fact
-- becomes something other modules assert as true.
create or replace function public.promote_business_truth_version(
  p_version_id  uuid,
  p_reviewer_id uuid,
  p_note        text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id  uuid;
  v_state      text;
  v_proposer   uuid;
  v_fields     jsonb;
  v_current    uuid;
begin
  select record_id, state, proposed_by, fields_json
    into v_record_id, v_state, v_proposer, v_fields
    from public.audit_business_truth_versions
   where id = p_version_id
   for update;

  if v_record_id is null then
    return 'not_found';
  end if;

  -- Already canonical: idempotent, so a retried request cannot double-supersede
  -- the version it just replaced.
  if v_state = 'approved' then
    select current_version_id into v_current
      from public.audit_business_truth_records where id = v_record_id;
    if v_current = p_version_id then
      return 'ok';
    end if;
  end if;

  if v_state not in ('pending_review', 'approved') then
    return 'not_reviewable';
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id then
    return 'self_approval';
  end if;

  -- The two identifying facts. Mirrors REQUIRED_FOR_CANONICAL in
  -- businessTruth.js; `p1Gate`-style parity is asserted by the db-verify suite
  -- rather than by hoping the two lists stay in step.
  if v_fields -> 'legal_name' is null or v_fields -> 'canonical_domain' is null then
    return 'missing_required';
  end if;

  -- Retire the outgoing version first, so there is never a moment where two
  -- versions of one record are both 'approved'.
  update public.audit_business_truth_versions v
     set state = 'superseded', superseded_at = now()
    from public.audit_business_truth_records r
   where r.id = v_record_id
     and v.id = r.current_version_id
     and v.id <> p_version_id;

  update public.audit_business_truth_versions
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_version_id;

  update public.audit_business_truth_records
     set current_version_id = p_version_id
   where id = v_record_id;

  return 'ok';
end;
$$;

comment on function public.promote_business_truth_version(uuid, uuid, text) is
  'Approve a version and make it canonical, atomically. Returns ok | not_found | not_reviewable | no_approver | self_approval | missing_required. Idempotent for a version that is already the record''s current one.';

revoke all on function public.promote_business_truth_version(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.promote_business_truth_version(uuid, uuid, text) to service_role;
