-- 0052_citation_states.sql — W6.3. Seven states where there were two booleans.
--
-- `audit_prompt_runs` has carried `mention_detected` and `citation_detected`
-- since 0030. Four combinations, and three of them say almost nothing: the
-- difference between "we are invisible" and "we are visible and losing" — which
-- are different problems with different fixes — is not expressible in them.
--
-- ── THE OLD BOOLEANS ARE KEPT, NOT REPLACED ────────────────────────────────
-- `citation_footprint` scores from them, every stored audit contains them and
-- every historical diff compares them. Dropping them would silently rewrite the
-- past. `state` is derived from the same measurements and sits beside them.
--
-- 🔴 A NULL STATE MEANS "NOT CLASSIFIED", NEVER "ABSENT". Rows written before
-- this migration have no state, and `absent` is a measured finding that the
-- brand did not appear. Reading one as the other would turn every historical
-- run into evidence of invisibility.

alter table public.audit_prompt_runs
  add column if not exists state text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'audit_prompt_runs_state_check'
  ) then
    alter table public.audit_prompt_runs
      add constraint audit_prompt_runs_state_check
      check (state is null or state in (
        'misrepresented', 'cited_and_recommended', 'recommended',
        'cited', 'mentioned', 'competitor_dominated', 'absent'
      ));
  end if;
end $$;

comment on column public.audit_prompt_runs.state is
  'Which of the seven PRD citation states this answer represents. NULL on rows written before 0052, meaning NOT CLASSIFIED — never read a NULL as ''absent'', which is a measured finding that the brand did not appear.';

-- ── What was asked, and whether it was a contest ───────────────────────────
--
-- RecommendationRate is measured over COMMERCIAL prompts only: "what is X"
-- cannot produce a recommendation, and counting it would dilute the rate with
-- questions that were never a contest. The denominator therefore has to be
-- stored per run and survive into every later read of this audit.
alter table public.audit_prompt_runs
  add column if not exists prompt_kind text;

comment on column public.audit_prompt_runs.prompt_kind is
  'One of the seven taxonomy kinds (brand, category, buyer_problem, comparison, industry, local, trust). NULL for runs predating the taxonomy.';

alter table public.audit_prompt_runs
  add column if not exists commercial boolean;

comment on column public.audit_prompt_runs.commercial is
  'Whether being named in this answer would be advocacy rather than recall. The denominator of RecommendationRate. NULL means unknown, and an unknown must be excluded from that rate rather than counted as false.';

alter table public.audit_prompt_runs
  add column if not exists kind_confidence smallint;

comment on column public.audit_prompt_runs.kind_confidence is
  '100 when the prompt was generated and its kind is a fact; lower when a user wrote the prompt and the kind was inferred from its text. A rate computed over inferred intent deserves to be read more cautiously than one computed over declared intent.';

-- ── The two judgements behind the state ────────────────────────────────────

alter table public.audit_prompt_runs
  add column if not exists recommended boolean;

comment on column public.audit_prompt_runs.recommended is
  'Did the sentences naming the brand advocate for it? Only meaningful where commercial is true.';

-- 🔴 THREE-VALUED ON PURPOSE. true = the engine stated something the page
-- contradicts; false = checked and consistent; NULL = COULD NOT CHECK, which is
-- the common case (the page states no price to check against). Collapsing NULL
-- to false would report every unverifiable answer as verified-correct.
alter table public.audit_prompt_runs
  add column if not exists misrepresented boolean;

comment on column public.audit_prompt_runs.misrepresented is
  'Three-valued. true: the answer stated a claim the audited page contradicts. false: checked and consistent. NULL: could not be checked, which is the common case — never read NULL as false.';

-- ── Who else was in the answer ─────────────────────────────────────────────
--
-- Each entry carries `declared`: true for a competitor the operator typed at
-- intake (exact match, confidence 100), false for a domain the engine cited
-- that we inferred to be a rival (confidence 45). AI SOV is reported against
-- each set separately and never against their sum — see competitorTracking.js.
alter table public.audit_prompt_runs
  add column if not exists competitors_json jsonb;

comment on column public.audit_prompt_runs.competitors_json is
  'Competitors present in this answer, each with `declared` and a confidence. Declared ones were named by the operator and matched exactly; discovered ones are inferred from cited domains. Never blend the two into one share-of-voice number.';

create index if not exists audit_prompt_runs_state_idx
  on public.audit_prompt_runs (audit_id, state)
  where state is not null;
