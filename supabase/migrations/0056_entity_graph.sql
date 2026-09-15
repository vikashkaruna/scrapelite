-- 0056_entity_graph.sql — W10. The Entity Graph Builder.
--
-- W9 gave the module one approved set of FACTS about a business. A fact is a
-- value; it says nothing about how things relate. "Acme sells Acme Cloud",
-- "Acme Cloud is a product, not the company", "these two office records are one
-- organisation" — those are edges, and edges are what a knowledge graph
-- resolves an entity by. An engine that cannot tell which Acme a page is about
-- merges it into the wrong node, which is the failure EA-11 already fires on at
-- the page level.
--
-- Naming follows D3: the `audit_` prefix, not the PRD's `discoverability_`.
--
-- ── D7 IS STILL OPEN, AND THIS DOES NOT PRE-EMPT IT ───────────────────────
-- Graph conflicts get their own table, exactly as W9's truth conflicts did,
-- rather than retrofitting `subject_type` + `subject_id` onto
-- `audit_issues`. That retrofit touches every reader of the P1 queue, the diff
-- engine and all four exports — doing it as a side effect of building the graph
-- would ship the two one bug apart. When D7 lands, these findings migrate into
-- whatever it decides; nothing here blocks that.
--
-- ── THE RULE THAT KEEPS A GRAPH HONEST ────────────────────────────────────
-- 🔴 EVERY RELATION CARRIES EVIDENCE AND A CONFIDENCE, OR IT IS NOT A RELATION.
-- An edge nobody can drill into is indistinguishable from one somebody made up.
-- `makeRelation` refuses an observed edge with no evidence; the CHECK below
-- refuses it at the database too.

-- ── Entities ───────────────────────────────────────────────────────────────
create table if not exists public.audit_entities (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid,

  -- Optional. A graph belongs to a business; linking it to that business's
  -- truth record is the common case, not the identity.
  truth_record_id  uuid references public.audit_business_truth_records(id) on delete set null,

  -- The fourteen types. ⚠️ The PRD enumerates them nowhere visible in this
  -- repository — the same situation W4 hit with "M1-M13" — so these are derived
  -- from schema.org, which is the vocabulary this module already reads,
  -- validates and generates. 🔴 If the PRD's own list differs, ADD; never
  -- renumber or repurpose one. These ids travel in stored rows and every
  -- historical diff, exactly like the signal and issue codes.
  entity_type      text not null check (entity_type in (
    'organization','brand','product','service','location','person','offer',
    'review','credential','event','content_asset','topic','industry','audience'
  )),

  name             text not null check (length(btrim(name)) > 0),
  description      text,

  -- 🔴 THE BRIDGE KEY, again. public.canonical_entities (0041) is UNIQUE on
  -- this column, and so is audit_business_truth_records. Bare host, lower-case,
  -- no `www.`, or one company gets resolved twice and the halves disagree.
  canonical_domain text,

  -- GSTIN, CIN, DUNS, LEI, a Wikidata QID. The only properties that resolve an
  -- entity unambiguously, which is why they are kept apart from the name.
  external_ids     jsonb not null default '{}'::jsonb,

  source           text not null check (source in ('declared','observed','inferred')),
  evidence_json    jsonb,
  confidence       numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  state            text not null default 'proposed'
                     check (state in ('proposed','approved','rejected')),
  proposed_by      uuid references auth.users(id) on delete set null,
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  review_note      text,

  source_audit_id  uuid references public.audits(id) on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- 🔴 AN OBSERVED CLAIM WITH NOTHING TO POINT AT IS NOT AN OBSERVATION.
  -- Mirrors makeEntity, which refuses the same row before it ever gets here.
  constraint audit_entities_observed_has_evidence check (
    source <> 'observed' or evidence_json is not null
  ),

  -- Same three-layer discipline as the truth record: approval means a second
  -- person looked, and a rejection without a reason is indistinguishable from a
  -- mis-click three months later.
  constraint audit_entities_no_self_approval check (
    state <> 'approved' or proposed_by is null or reviewed_by is null or reviewed_by <> proposed_by
  ),
  constraint audit_entities_approved_has_reviewer check (
    state <> 'approved' or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint audit_entities_rejected_has_reason check (
    state <> 'rejected' or (review_note is not null and length(btrim(review_note)) > 0)
  )
);

comment on table public.audit_entities is
  'A node in a business''s entity graph. Fourteen types, each mapped to a schema.org class so the graph and the structured data this module already validates speak one language.';

comment on column public.audit_entities.state is
  'Everything is created ''proposed'', whatever proposed it. An edge or node a crawler read and nobody looked at is a suggestion; treating it as knowledge is how a graph fills with confident nonsense.';

comment on column public.audit_entities.canonical_domain is
  'Bridge key to public.canonical_entities and to audit_business_truth_records. Bare host, lower-case, no www — the shape entityGraph.makeEntity produces.';

create index if not exists audit_entities_user_idx
  on public.audit_entities (user_id, updated_at desc);
create index if not exists audit_entities_truth_idx
  on public.audit_entities (truth_record_id) where truth_record_id is not null;
create index if not exists audit_entities_domain_idx
  on public.audit_entities (canonical_domain) where canonical_domain is not null;
create index if not exists audit_entities_review_idx
  on public.audit_entities (user_id) where state = 'proposed';

-- ── Relations ──────────────────────────────────────────────────────────────
create table if not exists public.audit_entity_relationships (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- 🔴 CASCADE ON BOTH ENDS. An edge to a deleted node is not a partial edge,
  -- it is a dangling pointer that every traversal has to defend against for
  -- ever. Deleting a node deletes what pointed at it.
  subject_id    uuid not null references public.audit_entities(id) on delete cascade,
  object_id     uuid not null references public.audit_entities(id) on delete cascade,

  -- The nine predicates. Same provenance note as entity_type above.
  predicate     text not null check (predicate in (
    'owns','offers','located_at','employs','part_of','same_as','about','serves','competes_with'
  )),

  source        text not null check (source in ('declared','observed','inferred')),
  evidence_json jsonb,
  confidence    numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  state         text not null default 'proposed'
                  check (state in ('proposed','approved','rejected')),
  proposed_by   uuid references auth.users(id) on delete set null,
  reviewed_by   uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,

  source_audit_id uuid references public.audits(id) on delete set null,
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- 🔴 A SELF-EDGE IS NEVER INFORMATION. "Acme is part of Acme" and "Acme is
  -- the same as Acme" are both vacuously true and both pollute every traversal.
  constraint audit_rel_no_self_edge check (subject_id <> object_id),

  constraint audit_rel_observed_has_evidence check (
    source <> 'observed' or evidence_json is not null
  ),
  constraint audit_rel_no_self_approval check (
    state <> 'approved' or proposed_by is null or reviewed_by is null or reviewed_by <> proposed_by
  ),
  constraint audit_rel_approved_has_reviewer check (
    state <> 'approved' or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint audit_rel_rejected_has_reason check (
    state <> 'rejected' or (review_note is not null and length(btrim(review_note)) > 0)
  )
);

comment on table public.audit_entity_relationships is
  'One edge. Nine predicates, each with a declared domain and range enforced by entityGraph.validateRelation — without that a graph is a bag of edges, and "this review employs that topic" is storable, meaningless and impossible to notice later.';

-- 🔴 ONE EDGE, NOT FIVE COPIES OF IT. Without this, a crawler that re-reads the
-- same page every week accumulates a new row per run, every count doubles, and
-- "who do we compete with" answers differently depending on how many audits
-- have happened. Re-observation updates the row; it does not add one.
create unique index if not exists audit_rel_unique
  on public.audit_entity_relationships (subject_id, predicate, object_id);

create index if not exists audit_rel_subject_idx
  on public.audit_entity_relationships (subject_id) where state = 'approved';
create index if not exists audit_rel_object_idx
  on public.audit_entity_relationships (object_id) where state = 'approved';
create index if not exists audit_rel_review_idx
  on public.audit_entity_relationships (user_id) where state = 'proposed';

-- ── Evidence ───────────────────────────────────────────────────────────────
--
-- ⚠️ THIS IS NOT A SECOND EVIDENCE MODEL. `evidence_json` above holds the
-- evidence for the ORIGINAL assertion — the reading that created the row. This
-- table holds CORROBORATION: every later sighting of the same relationship, on
-- a different page or in a different run. The distinction matters because "we
-- read this once in 2024" and "we have read this on six pages across nine
-- months" are different warranties on the same edge, and collapsing them would
-- throw away the difference.
create table if not exists public.audit_entity_evidence (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid references public.audit_entities(id) on delete cascade,
  relationship_id uuid references public.audit_entity_relationships(id) on delete cascade,
  audit_id        uuid references public.audits(id) on delete set null,

  evidence_json   jsonb not null,
  confidence      numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  collected_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  -- Evidence for nothing is not evidence.
  constraint audit_entity_evidence_has_subject check (
    entity_id is not null or relationship_id is not null
  )
);

comment on table public.audit_entity_evidence is
  'Corroboration. Every later sighting of an entity or relationship already recorded — "read once in 2024" and "read on six pages across nine months" are different warranties on the same edge.';

create index if not exists audit_entity_evidence_entity_idx
  on public.audit_entity_evidence (entity_id, collected_at desc) where entity_id is not null;
create index if not exists audit_entity_evidence_rel_idx
  on public.audit_entity_evidence (relationship_id, collected_at desc) where relationship_id is not null;

-- ── Graph conflicts ────────────────────────────────────────────────────────
create table if not exists public.audit_entity_conflicts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  truth_record_id uuid references public.audit_business_truth_records(id) on delete cascade,
  audit_id      uuid references public.audits(id) on delete set null,

  -- A public contract. Add codes; never repurpose or renumber one.
  code          text not null check (code in ('EG-01','EG-02','EG-03','EG-04','EG-05','EG-06')),
  severity      text not null default 'medium' check (severity in ('low','medium','high')),

  subject_id    uuid references public.audit_entities(id) on delete cascade,
  predicate     text,
  detail_json   jsonb,
  message       text,

  resolved_at   timestamptz,
  resolution    text check (resolution is null or resolution in
                  ('relationship_removed','relationship_corrected','entity_merged','not_a_conflict')),

  created_at    timestamptz not null default now()
);

comment on table public.audit_entity_conflicts is
  'Structural problems in the APPROVED graph — two headquarters, a hierarchy that loops, a sameAs across two types. A proposal that contradicts the graph is not a conflict, it is a proposal; reporting it as one would make the review queue argue with itself.';

create index if not exists audit_entity_conflicts_open_idx
  on public.audit_entity_conflicts (user_id, created_at desc) where resolved_at is null;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.audit_entities              enable row level security;
alter table public.audit_entity_relationships  enable row level security;
alter table public.audit_entity_evidence       enable row level security;
alter table public.audit_entity_conflicts      enable row level security;

drop policy if exists audit_entities_service on public.audit_entities;
create policy audit_entities_service on public.audit_entities
  for all to service_role using (true) with check (true);

drop policy if exists audit_rel_service on public.audit_entity_relationships;
create policy audit_rel_service on public.audit_entity_relationships
  for all to service_role using (true) with check (true);

drop policy if exists audit_entity_evidence_service on public.audit_entity_evidence;
create policy audit_entity_evidence_service on public.audit_entity_evidence
  for all to service_role using (true) with check (true);

drop policy if exists audit_entity_conflicts_service on public.audit_entity_conflicts;
create policy audit_entity_conflicts_service on public.audit_entity_conflicts
  for all to service_role using (true) with check (true);

revoke all on public.audit_entities             from anon, authenticated;
revoke all on public.audit_entity_relationships from anon, authenticated;
revoke all on public.audit_entity_evidence      from anon, authenticated;
revoke all on public.audit_entity_conflicts     from anon, authenticated;

drop trigger if exists audit_entities_touch on public.audit_entities;
create trigger audit_entities_touch
  before update on public.audit_entities
  for each row execute function public.audit_touch_updated_at();

drop trigger if exists audit_rel_touch on public.audit_entity_relationships;
create trigger audit_rel_touch
  before update on public.audit_entity_relationships
  for each row execute function public.audit_touch_updated_at();

-- ── Approval ───────────────────────────────────────────────────────────────
--
-- 🔴 ONE FUNCTION, BECAUSE APPROVING AN EDGE IS NOT ONE WRITE.
-- An approved edge whose endpoints are still unreviewed proposals is a
-- half-built statement: the graph asserts a relationship between two things it
-- has not agreed exist. So approving an edge approves its endpoints in the same
-- statement, under the same reviewer, or refuses.
--
-- ⚠️ THE ENDPOINTS ARE APPROVED, NOT CREATED. A node that was rejected stays
-- rejected and blocks the edge — reviving it silently would undo somebody's
-- explicit decision.
create or replace function public.approve_entity_relationship(
  p_relationship_id uuid,
  p_reviewer_id     uuid,
  p_note            text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    text;
  v_proposer uuid;
  v_subject  uuid;
  v_object   uuid;
  v_bad      integer;
begin
  select state, proposed_by, subject_id, object_id
    into v_state, v_proposer, v_subject, v_object
    from public.audit_entity_relationships
   where id = p_relationship_id
   for update;

  if v_state is null then
    return 'not_found';
  end if;

  if v_state = 'approved' then
    return 'ok';                           -- idempotent; a retry is not an error
  end if;

  if v_state = 'rejected' then
    return 'rejected';                     -- propose it again rather than reviving it
  end if;

  if p_reviewer_id is null then
    return 'no_approver';
  end if;

  if v_proposer is not null and v_proposer = p_reviewer_id then
    return 'self_approval';
  end if;

  -- An endpoint somebody explicitly rejected blocks the edge.
  select count(*) into v_bad
    from public.audit_entities
   where id in (v_subject, v_object) and state = 'rejected';
  if v_bad > 0 then
    return 'endpoint_rejected';
  end if;

  -- Approve any endpoint still merely proposed, under the same reviewer, so the
  -- graph never asserts a relationship between two things it has not agreed
  -- exist. The self-approval CHECK on audit_entities still applies, so an
  -- endpoint this reviewer proposed themselves stops the whole call.
  update public.audit_entities
     set state = 'approved', reviewed_by = p_reviewer_id, reviewed_at = now()
   where id in (v_subject, v_object)
     and state = 'proposed';

  update public.audit_entity_relationships
     set state = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_relationship_id;

  return 'ok';
end;
$$;

comment on function public.approve_entity_relationship(uuid, uuid, text) is
  'Approve an edge and its endpoints atomically. Returns ok | not_found | rejected | no_approver | self_approval | endpoint_rejected. An approved edge between unreviewed nodes is a half-built statement, so the endpoints come with it.';

revoke all on function public.approve_entity_relationship(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_entity_relationship(uuid, uuid, text) to service_role;
