-- 0064_subject_scores.sql — P2 · W11's withheld result surface. W13's step 5.
--
-- W11 shipped `subjectScoring.js` complete, tested, and IMPORTED BY NOTHING.
-- That was deliberate and it was recorded as deliberate: persisting a subject
-- score needed a subject model (D7) and two components that did not exist
-- (TC from W13, TP from W13). Both blockers are now gone — D7 shipped as
-- `0057`, TC and TP as `0062` — so the deferral has expired, and a pure model
-- with no caller is this schema's own recorded failure mode five times over.
--
-- ── 🔴 THIS TABLE APPENDS. IT DOES NOT UPSERT. ────────────────────────────
-- Every other table W13 added carries a `unique nulls not distinct` arbiter so
-- a re-observation UPDATES rather than stacking. THIS ONE DELIBERATELY HAS NO
-- SUCH CONSTRAINT, and the difference is what each table is FOR:
--
--   `audit_schema_entities` answers "what does this page declare NOW". A second
--   opinion is not wanted; the current answer replaces the last one.
--
--   This table answers "what did this brand score ON THE 12th". That IS the
--   product — W11 exists so a customer can watch a subject improve. An upsert
--   arbiter here would silently destroy the trend line every time a subject was
--   re-scored, leaving one row that claims to be the whole history.
--
-- ⚠️ So two legitimate scorings of the same subject on the same day produce two
-- rows, and that is correct: they are two measurements. A constraint that
-- refused the second would be refusing a re-measure to prevent a duplicate.
--
-- ── 🔴 `score` IS NULLABLE AND `coverage` IS NOT. ─────────────────────────
-- `scoreSubject` returns `score: null` when nothing in the formula could be
-- measured. Storing 0 there would be the one thing this entire module is built
-- to prevent — and it would be indistinguishable, for ever, from a subject that
-- genuinely scored zero.
--
-- And `coverage` is NOT NULL because a score without it is not a smaller score,
-- it is a DIFFERENT one. 72 at 80% coverage with TC excluded and 72 at 100%
-- coverage are not the same measurement. A trend line drawn through stored
-- scores whose coverage was not kept would show a phantom jump on the day an
-- excluded component started being measured — the exact fiction `weightedMean`
-- and `blockedBy` were written to prevent, re-created at the storage layer.
--
-- ── ⚠️ `model_version` IS NOT NULL WITH NO DEFAULT ────────────────────────
-- The rule `audit_results.scoring_model_version` already established in `0048`:
-- a default would let a writer that forgets the stamp file a future score under
-- the current version, which is precisely the mislabelling the column exists to
-- prevent. There are no rows to backfill — this table is new.
--
-- ⚠️ AND IT IS THE SUBJECT MODEL'S OWN VERSION, NOT THE PAGE MODEL'S.
-- `SCORING_MODEL_VERSION` is at "v3" and describes the penalty/pillar maths.
-- The BDS/PDS/SFS weights are a different formula that moves for different
-- reasons. Filing both under one version number would make each comparability
-- claim false: a page-model bump would wrongly invalidate every subject trend,
-- and a weight change here would wrongly leave page diffs comparable. The
-- subject series is namespaced `s1` so the two can never be read as the same.
--
-- ── The five rules from the 2026-09-12 review still apply ─────────────────
--  (a) The table has a writer and a contract test asserting the CALL.
--  (b) No expression arbiter (0059) — there is no arbiter here at all, above.
--  (c) No SELECT-then-INSERT get-or-create (0060).
--  (d) Nothing is SECURITY DEFINER, so there is no grant to get wrong (0061).
--  (e) `subject_id` and `audit_id` are checked in the ROUTE against rows the
--      caller owns, and refused 404 — see `requireSubjectScoreRefs`.

create table if not exists public.audit_subject_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,

  -- 🔴 NOT NULL. A subject score with no subject is the polymorphic pointer D7
  -- was written to refuse. The join table is the whole reason this table can
  -- exist at all, so it is a hard reference, not a hint.
  subject_id uuid not null references public.audit_subjects(id) on delete cascade,
  audit_id   uuid references public.audits(id) on delete set null,

  -- ⚠️ THREE VALUES, NOT SIX. `audit_subjects` legitimately holds `page`,
  -- `domain` and `location` too, and `scoreIdFor()` returns null for all three
  -- because there is no single-number formula for them. A row claiming a page
  -- has a BDS is a category error, so the database refuses it rather than
  -- trusting every future writer to remember.
  kind text not null check (kind in ('brand', 'product', 'service')),
  code text not null check (code in ('BDS', 'PDS', 'SFS')),

  score numeric(5,1) check (score is null or (score >= 0 and score <= 100)),
  coverage numeric(5,1) not null check (coverage >= 0 and coverage <= 100),
  model_version text not null,

  -- The full component breakdown, kept so a stored score can be EXPLAINED
  -- without recomputing it from inputs that have since changed. Recomputation
  -- is not an option for a historical score: the page moved.
  components jsonb not null default '[]'::jsonb,

  -- Which components ran, which did not, and which workstream the absent ones
  -- are waiting on. `blocked_by` is what keeps "we cannot measure this yet"
  -- and "you are failing at this" from rendering the same, months later, to a
  -- reader who was not here when it was scored.
  measured    text[] not null default '{}',
  unmeasured  text[] not null default '{}',
  blocked_by  text[] not null default '{}',

  scored_at  timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists audit_subject_scores_owner_idx
  on public.audit_subject_scores (user_id, scored_at desc);
-- The trend query: one subject, newest first.
create index if not exists audit_subject_scores_subject_idx
  on public.audit_subject_scores (subject_id, scored_at desc);

comment on table public.audit_subject_scores is
  'W11/W13-step-5. APPEND-ONLY history of BDS/PDS/SFS per subject. Never upserted: the trend is the product. score is NULLABLE (unknown is never 0); coverage is NOT NULL because a score without it is a different measurement.';
comment on column public.audit_subject_scores.model_version is
  'The SUBJECT formula version (s-series), not the page model version (v-series). Two different formulas that move for different reasons.';

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Service-key only, like every other table in this module. The browser reaches
-- Supabase exclusively through Netlify Functions, so an anon policy would be
-- unused attack surface — and 0044 is what that costs when it is not.
alter table public.audit_subject_scores enable row level security;

drop policy if exists audit_subject_scores_service on public.audit_subject_scores;
create policy audit_subject_scores_service on public.audit_subject_scores
  for all to service_role using (true) with check (true);

revoke all on public.audit_subject_scores from anon, authenticated;
