-- 0062_schema_trust.sql — P2 · W13: schema intelligence + trust & proof.
--
-- Two tables. They exist because W11 shipped three components binding to a
-- `trust_proof` source that did not exist — `trust_credibility` (20% of BDS),
-- `trust_proof` (15% of PDS) and `trust_signals` (10% of SFS) all read `null`
-- and were redistributed. This is the storage behind them.
--
-- ── 🔴 THE FIVE RULES THIS MIGRATION WAS WRITTEN AGAINST ──────────────────
-- Each one cost a migration on already-merged work in the 2026-09-12 review,
-- so they are applied here rather than rediscovered:
--
--  (a) EVERY TABLE HAS A WRITER AND A CONTRACT TEST THAT ASSERTS THE CALL.
--      Four columns in this schema have been declared, reviewed, merged and
--      written by nothing. `saveSchemaEntity` and `saveTrustObservation` are
--      called by `/schema-trust/*` and the assertions were confirmed RED first.
--  (b) THE UPSERT ARBITER NAMES COLUMNS, NOT AN EXPRESSION, and uses
--      `NULLS NOT DISTINCT` because `subject_id` is nullable. 0058 used a
--      `coalesce(...)` index that enforced the invariant AND made every save
--      fail, because PostgREST can only name column arbiters (0059).
--  (c) NO SELECT-THEN-INSERT get-or-create anywhere (0060).
--  (d) NOTHING HERE IS `SECURITY DEFINER`, so there is no grant to get wrong —
--      and if one is ever added it must `revoke all ... from public`, not just
--      from anon, which is a no-op while PUBLIC holds the default grant (0061).
--  (e) Caller-supplied parent ids are checked in the ROUTE against rows the
--      caller owns, and refused 404 — see `requireSchemaTrustRefs`.
--
-- ── ⚠️ WHY `independence` IS A CHECK AND `signal` IS NOT ──────────────────
-- The same split W12 made, for the same reason. `independence` is a THREE-VALUE
-- trust vocabulary that decides how much a claim is worth; widening it is a
-- deliberate scoring change and should cost a migration. `signal` is an open
-- registry that grows with the market — a new trust source is a code change,
-- and constraining it here would make each one a migration for nothing.
-- `schema-trust-parity.test.js` PARSES this CHECK out of the file rather than
-- restating it, because a copy drifts exactly as `EVENT_TO_SOURCE` did.

-- ── Schema entities observed for a subject ────────────────────────────────
create table if not exists public.audit_schema_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  subject_id uuid references public.audit_subjects(id) on delete cascade,
  audit_id   uuid references public.audits(id)        on delete set null,

  schema_type text not null check (length(btrim(schema_type)) > 0),
  -- Present-but-unusable is a THIRD state, not a worse version of absent — the
  -- distinction EA-11 exists for, and the reason a half-built node is worse
  -- than none: it gets merged into the WRONG knowledge-graph entry.
  validity text not null default 'valid'
    check (validity in ('valid', 'incomplete', 'unparseable')),
  missing_properties text[] not null default '{}',
  node_id text,                 -- the block's @id, where it has one
  same_as text[] not null default '{}',

  -- The component scores this observation contributed to, kept so a stored
  -- score can be explained without recomputing it from a page that has since
  -- changed. NULL means not measured — never zero.
  component_scores jsonb not null default '{}'::jsonb,
  evidence_json jsonb,

  observed_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One CURRENT row per (owner, subject, type). A re-audit UPDATES what the
-- markup says; it does not stack a second opinion, or every count doubles and
-- "what does this page declare" answers differently depending on how many
-- audits have run — the defect 0056's unique edge index and 0058's listing
-- index both exist to prevent.
alter table public.audit_schema_entities
  drop constraint if exists audit_schema_entity_unique;
alter table public.audit_schema_entities
  add constraint audit_schema_entity_unique
  unique nulls not distinct (user_id, subject_id, schema_type);

create index if not exists audit_schema_entities_owner_idx
  on public.audit_schema_entities (user_id, observed_at desc);
create index if not exists audit_schema_entities_subject_idx
  on public.audit_schema_entities (subject_id) where subject_id is not null;

-- ── Trust observations ────────────────────────────────────────────────────
create table if not exists public.audit_trust_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  subject_id uuid references public.audit_subjects(id) on delete cascade,
  audit_id   uuid references public.audits(id)        on delete set null,

  signal text not null check (length(btrim(signal)) > 0),

  -- 🔴 THE COLUMN THE WHOLE MODEL RESTS ON. It is a claim about WHO holds the
  -- evidence, which is what separates a trust score from a testimonial
  -- counter — so it is constrained here AND refused from a request body in
  -- `/schema-trust/trust`. A provenance flag a client can set is not a claim:
  -- it is `?consented=true` wearing a fifth hat.
  independence text not null
    check (independence in ('self_published', 'self_attributed', 'third_party')),

  observed_count integer not null default 0 check (observed_count >= 0),
  verifiable boolean not null default false,

  -- ⚠️ A `third_party` record with no source_url is a claim ABOUT one. The
  -- model demotes it rather than refusing it, and this CHECK makes the
  -- database agree: independence cannot outrun the evidence behind it.
  source_url text,
  constraint audit_trust_third_party_needs_source
    check (independence <> 'third_party' or source_url is not null),

  evidence_json jsonb,
  observed_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.audit_trust_evidence
  drop constraint if exists audit_trust_evidence_unique;
alter table public.audit_trust_evidence
  add constraint audit_trust_evidence_unique
  unique nulls not distinct (user_id, subject_id, signal, independence);

create index if not exists audit_trust_evidence_owner_idx
  on public.audit_trust_evidence (user_id, observed_at desc);
create index if not exists audit_trust_evidence_subject_idx
  on public.audit_trust_evidence (subject_id) where subject_id is not null;

comment on table public.audit_schema_entities is
  'W13. One row per schema type observed for a subject. Re-observation UPDATES; it never stacks.';
comment on table public.audit_trust_evidence is
  'W13. Trust observations scored by independence, never by count. third_party requires a source_url at the database level.';

-- ── Touch triggers ────────────────────────────────────────────────────────
drop trigger if exists audit_schema_entities_touch on public.audit_schema_entities;
create trigger audit_schema_entities_touch
  before update on public.audit_schema_entities
  for each row execute function public.audit_touch_updated_at();

drop trigger if exists audit_trust_evidence_touch on public.audit_trust_evidence;
create trigger audit_trust_evidence_touch
  before update on public.audit_trust_evidence
  for each row execute function public.audit_touch_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Service-key only, like every other table in this module. The browser reaches
-- Supabase exclusively through Netlify Functions, so an anon policy would be
-- unused attack surface — and 0044 is what that costs when it is not.
alter table public.audit_schema_entities enable row level security;
alter table public.audit_trust_evidence  enable row level security;

drop policy if exists audit_schema_entities_service on public.audit_schema_entities;
create policy audit_schema_entities_service on public.audit_schema_entities
  for all to service_role using (true) with check (true);

drop policy if exists audit_trust_evidence_service on public.audit_trust_evidence;
create policy audit_trust_evidence_service on public.audit_trust_evidence
  for all to service_role using (true) with check (true);

revoke all on public.audit_schema_entities from anon, authenticated;
revoke all on public.audit_trust_evidence  from anon, authenticated;
