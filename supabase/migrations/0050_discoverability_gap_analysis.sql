-- 0050_discoverability_gap_analysis.sql
--
-- Turns a list of findings into a diagnosis, and connects each finding to the
-- work it produced.
--
-- ── THE REQUIREMENT ────────────────────────────────────────────────────────
-- The BRD specifies eleven fields on every issue. The table carried six. The
-- five it did not carry are the five that make a queue actionable rather than
-- merely correct:
--
--   observed facts, separately from inference   ← one blended `evidence` column
--   root cause                                  ← no taxonomy at all
--   recommended DatIQ module                    ← absent
--   recommended owner role                      ← catalogue-only, never stored
--   workflow state                              ← issues had no lifecycle
--
-- ── WHY A ROOT CAUSE, WHEN EVERY ISSUE ALREADY HAS A CODE ──────────────────
-- 46 codes is more than anyone reads. Forty individually-true findings is a
-- list, not a diagnosis, and the reader's question is "what is WRONG with this
-- page" — which no single code answers and which grouping by PILLAR does not
-- answer either, because a pillar is a scoring construct. "Entity authority is
-- 42" says where points were lost, not what to go and do.
--
-- Root cause is the axis a person can act on: eleven findings that all reduce
-- to `entity_ambiguity` are one afternoon's work, and seeing that is the
-- difference between a report that gets worked and one that gets filed.
--
-- ── WHY observed AND inference ARE TWO COLUMNS ─────────────────────────────
-- They have different warranties, and storing them in one column launders the
-- weaker one into the stronger.
--
--   "The page has two H1 elements"        MEASURED. We will defend it.
--   "This dilutes the topical signal"     REASONED. An expert could disagree.
--
-- Both were already present in the codebase — the per-audit sentence and the
-- catalogue's `why` — but they reached the reader as one paragraph, which gives
-- the second the authority of the first. The split is the same discipline
-- migration 0048 applied to evidence `method` (`observed: true|false`) one
-- layer down, and the same discipline 0049 applied to `audit_profile_source`.
--
-- ⚠️ `evidence` IS KEPT AND KEEPS ITS MEANING. It is what every export prints,
-- what every stored row already contains and what every historical diff
-- compares. `observed` is populated from the same sentence going forward;
-- replacing the column would rewrite the past.
--
-- ── WHY owner_role IS DENORMALISED ─────────────────────────────────────────
-- `owner` has lived in issueCatalog.js since the module shipped and has never
-- been stored. "Show me everything engineering has to do this sprint" was
-- therefore a client-side filter over a list the client had to fetch in full
-- first — which is not a query, and does not survive the queue growing.

-- ── The diagnosis ──────────────────────────────────────────────────────────
alter table public.audit_issues
  add column if not exists root_cause text;

alter table public.audit_issues
  drop constraint if exists audit_issues_root_cause_check;
alter table public.audit_issues
  add constraint audit_issues_root_cause_check
  check (root_cause is null or root_cause in (
    'technical_access','weak_page_structure','entity_ambiguity','insufficient_proof',
    'missing_content_coverage','location_radius_mismatch','ux_friction','conversion_friction'));

comment on column public.audit_issues.root_cause is
  'Which of the eight causes in src/lib/discoverability/gapTaxonomy.js this finding reduces to. NULL on rows written before this migration — the taxonomy did not exist when they were recorded, and assigning one retrospectively would be a diagnosis nobody made. Two of the eight (location_radius_mismatch, conversion_friction) are declared for P2 and unused in P1, deliberately: the vocabulary is a contract, and a taxonomy that arrives in two halves invites the second half to be numbered around the first.';

-- ── The referral ───────────────────────────────────────────────────────────
--
-- ⚠️ STORED AS A SLUG, NOT AS THE BRD's "M1-M13" NUMBER.
-- The BRD names the modules M1 to M13 and does not enumerate which is which
-- anywhere this repository can see. Numbering them from a guess and storing
-- those numbers would break the rule that matters most here — codes are a
-- public contract, never renumber one — the first time the real list
-- disagreed. The slug is derived from the PRD's own section names and cannot be
-- wrong about itself; `MODULES[].mCode` in gapTaxonomy.js is a nullable display
-- alias waiting for that confirmation, and nothing keys off it.
alter table public.audit_issues
  add column if not exists recommended_module text;

alter table public.audit_issues
  drop constraint if exists audit_issues_recommended_module_check;
alter table public.audit_issues
  add constraint audit_issues_recommended_module_check
  check (recommended_module is null or recommended_module in (
    'technical_remediation','recommendation_studio','schema_intelligence','ai_visibility',
    'validation_lab','business_truth_record','entity_graph','brand_discoverability',
    'product_discoverability','service_findability','local_directory','trust_and_proof',
    'service_radius'));

comment on column public.audit_issues.recommended_module is
  'Which DatIQ capability answers this finding, as a slug. See gapTaxonomy.js — the slug is the contract; the BRD''s M1-M13 numbering is an unconfirmed display alias and is deliberately not stored.';

-- ── Observed fact, and inference, as two columns ───────────────────────────
alter table public.audit_issues
  add column if not exists observed text;

alter table public.audit_issues
  add column if not exists inference text;

comment on column public.audit_issues.observed is
  'What was MEASURED on this page, on this run. Per-audit. Populated from the same sentence `evidence` carries, which is kept unchanged so historical rows and every export keep working.';

comment on column public.audit_issues.inference is
  'What it is REASONED to mean. Per-code, from issueCatalog.why. Separate from `observed` because the two have different warranties and one column launders the weaker into the stronger.';

-- ── Who fixes it ───────────────────────────────────────────────────────────
alter table public.audit_issues
  add column if not exists owner_role text;

alter table public.audit_issues
  drop constraint if exists audit_issues_owner_role_check;
alter table public.audit_issues
  add constraint audit_issues_owner_role_check
  check (owner_role is null or owner_role in ('content','seo','engineering','brand','product'));

-- ── The lifecycle issues have never had ────────────────────────────────────
--
-- The full BRD vocabulary is declared now, and only `open` is reachable until
-- W8 wires the transitions. Same reasoning as 0049's audit types: widening a
-- live CHECK later is a migration plus a deploy plus a window in which the API
-- and the database disagree about what is legal, and declaring the whole set
-- costs nothing. What it must NOT do is let a row claim a state no code can
-- produce — the API is what enforces that, not the constraint.
alter table public.audit_issues
  add column if not exists status text not null default 'open';

alter table public.audit_issues
  drop constraint if exists audit_issues_status_check;
alter table public.audit_issues
  add constraint audit_issues_status_check
  check (status in ('open','accepted','assigned','in_progress','implemented',
                    'validation_scheduled','validated','dismissed'));

alter table public.audit_issues
  add column if not exists status_changed_at timestamptz;

comment on column public.audit_issues.status is
  'BRD workflow state. The full seven-stage vocabulary plus `dismissed` is declared here; only `open` is reachable until W8 wires the transitions. Defaulted rather than nullable because every finding genuinely starts open — unlike primary_goal in 0049, this one IS knowable retrospectively.';

-- "Everything engineering owns that is still open, worst first" — the query the
-- queue is actually built from, and a table scan without this.
create index if not exists audit_issues_owner_status_idx
  on public.audit_issues (user_id, owner_role, status, severity);

-- "What is really wrong with this page" — grouping the report by diagnosis.
create index if not exists audit_issues_root_cause_idx
  on public.audit_issues (audit_id, root_cause)
  where root_cause is not null;

-- ── The link that was declared and never written ───────────────────────────
--
-- 🔴 `audit_recommendations.issue_id` HAS EXISTED SINCE MIGRATION 0030 AND
-- NOTHING HAS EVER WRITTEN IT. NULL on every row for the life of the module —
-- the same defect class as `audit_signals.raw_value` and `.evidence_json`,
-- which W1 found in the same table set.
--
-- The consequence is that every recommendation is an orphan. "Which finding
-- produced this task" has had no answer in the data, so the validation loop
-- could not close: when a re-audit reports AC-01 resolved there was no way to
-- mark the recommendation it produced as validated except by matching on
-- `code`, which works only while the mapping stays one-to-one and silently
-- mis-attributes the moment it does not.
--
-- No column is added here. The fix is in the WRITE PATH (auditStore.persistResult
-- now inserts issues first, keeps the returned ids and threads them onto the
-- recommendation rows), and this index is what makes the resulting join cheap.
create index if not exists audit_recommendations_issue_idx
  on public.audit_recommendations (issue_id)
  where issue_id is not null;
