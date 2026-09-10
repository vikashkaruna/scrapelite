-- 0048_discoverability_evidence.sql
--
-- Gives every stored signal and every stored issue the provenance the BRD
-- requires of it, and stamps every result with the version of the maths that
-- produced it.
--
-- ── THE REQUIREMENT ────────────────────────────────────────────────────────
--   "Every signal and issue must retain evidence. Evidence includes source URL,
--    selector or extracted section, observed value, excerpt/structured object,
--    collection timestamp and confidence."
--   "Each score stores calculation components, raw values, normalized score,
--    weight, threshold, evidence and model version."
--
-- Before this migration the engine could satisfy neither sentence. `audit_signals`
-- had `raw_value` and `evidence_json` columns from 0030 that NOTHING EVER WROTE
-- — they have been NULL on every row since the module shipped — and
-- `audit_issues` had a single `evidence text` column holding a human sentence
-- with no source, no selector, no timestamp and no confidence. Both were
-- readable and neither was checkable, so "where exactly did you see that?" had
-- no answer, which is the question a customer asks the moment a finding
-- surprises them.
--
-- ── WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT ───────────────────────────
-- Additive only. Nothing is dropped, renamed or backfilled destructively.
--
--   audit_issues.evidence_json    NEW. The structured records, as an array.
--   audit_signals.threshold_json  NEW. The boundary a scorer applied, where one
--                                 exists at all — see below.
--   audit_results.scoring_model_version  NEW. Which maths produced these numbers.
--
-- `audit_issues.evidence` (the sentence) is KEPT and keeps its meaning. It is
-- what every export prints, what every stored row already contains and what
-- every historical diff compares — replacing it would rewrite the past. The
-- structured records sit BESIDE it, and the sentence becomes the issue's
-- plain-language observed fact rather than its only provenance.
--
-- ── WHY threshold_json IS NULLABLE AND USUALLY NULL ────────────────────────
-- Most signals are CURVES, not thresholds. Conciseness declines either side of
-- a 40-60 word band; heading integrity is a proportion of a tree; render
-- completeness is a ratio. Those have no boundary to record, and inventing one
-- so the column looks populated would put a number in front of a customer that
-- the scorer never applied. Only the signals that genuinely have a published
-- cut-off — Core Web Vitals' good/poor thresholds, the ideal answer-length band
-- — write here. A NULL means "this score is a curve", not "we forgot".
--
-- ── WHY THE VERSION LIVES ON THE RESULT, NOT THE AUDIT ─────────────────────
-- The audit row is the JOB — when it ran, what was asked for. The result row is
-- the MEASUREMENT. Two audits of the same URL a month apart may be scored by
-- different models, and it is the measurements that have to declare which rules
-- produced them, because it is measurements the diff engine subtracts. Storing
-- it on the job would put the version one join away from the numbers it governs.
--
-- Existing rows are backfilled to 'v1' rather than left NULL: they WERE scored,
-- by the model this repository has always shipped, and a NULL would read as
-- "unknown model" and make every historical baseline non-comparable overnight.

-- ── Structured evidence on findings ────────────────────────────────────────
alter table public.audit_issues
  add column if not exists evidence_json jsonb;

comment on column public.audit_issues.evidence_json is
  'Array of evidence records supporting this finding. Shape is fixed by src/lib/discoverability/evidenceModel.js: {method, observed, source_url, selector, section, observed_value, excerpt, structured, collected_at, confidence}. Sits beside `evidence`, which stays the human-readable observed fact.';

-- "Show me every finding that rests on a model judgement rather than a reading"
-- is a support question and a trust question, and without this it is a table
-- scan over every issue ever raised.
create index if not exists audit_issues_evidence_gin
  on public.audit_issues using gin (evidence_json);

-- ── The boundary a scorer applied, where there is one ──────────────────────
alter table public.audit_signals
  add column if not exists threshold_json jsonb;

comment on column public.audit_signals.threshold_json is
  'The published cut-off this signal was scored against, when it has one (Core Web Vitals good/poor, ideal answer-length band). NULL is the common and correct case: most signals are curves with no threshold, and a fabricated boundary would misdescribe the scorer.';

-- ── Which maths produced these numbers ─────────────────────────────────────
alter table public.audit_results
  add column if not exists scoring_model_version text;

comment on column public.audit_results.scoring_model_version is
  'Version of the scoring model that produced this result. auditDiff refuses to compare across versions: a delta between two different models is a number nobody earned. Bumped for any change that can move the score of an unchanged page — pillar/framework/signal weights, penalty factors, the penalty set, or a scorer curve.';

update public.audit_results
   set scoring_model_version = 'v1'
 where scoring_model_version is null;

-- NOT NULL, and deliberately WITHOUT a default.
--
-- A default would be the dangerous choice here, not the safe one: it would let
-- a future writer that forgets to stamp the version have its result silently
-- filed under whatever the default happened to be, which is exactly the class
-- of error the version exists to prevent. NOT NULL with no default means a
-- forgotten stamp is a loud write failure at the moment the code is wrong,
-- rather than a quiet mislabelling discovered months later in a trend line.
--
-- Safe to apply in one migration because the backfill above covers every
-- existing row and auditStore.persistResult falls back to the imported
-- SCORING_MODEL_VERSION constant, so it cannot send a null.
alter table public.audit_results
  alter column scoring_model_version set not null;

-- The trend and comparison queries filter on it, and they run per user.
create index if not exists audit_results_model_version_idx
  on public.audit_results (user_id, scoring_model_version);
