-- 0049_discoverability_intake.sql
--
-- Gives an audit the context it was commissioned with: what KIND of audit was
-- asked for, what the customer was trying to achieve, where they are trying to
-- be found, and who they measure themselves against.
--
-- ── THE REQUIREMENT ────────────────────────────────────────────────────────
-- The BRD's intake section makes audit type, primary goal and audit profile
-- REQUIRED fields, and adds target geography and competitor URLs beside them.
-- Of those five the schema carried exactly one — `audit_profile`, and only
-- four of its eight values.
--
-- ── WHY THIS MIGRATION CANNOT WAIT AND CANNOT BE BACK-FILLED ───────────────
-- Every other column in this module records something we MEASURED, and a
-- measurement can always be taken again by re-running the audit. These record
-- something the customer SAID. If nobody was asked "what are you trying to
-- achieve?" at the moment the audit was commissioned, that answer does not
-- exist anywhere and no later migration can recover it.
--
-- That is why `primary_goal` is nullable and why the historical rows are left
-- NULL rather than defaulted to anything. A default here would be a fabricated
-- intent — the same class of error as an evidence record with a guessed source
-- URL, and the P2 brand, product, service and local modules key off this field,
-- so a guessed goal would propagate into work nobody commissioned.
--
--   NULL primary_goal  =  "this audit predates the question" or "not answered"
--   NOT NULL           =  "the customer said this"
--
-- ── source vs audit_type: TWO DIFFERENT QUESTIONS ──────────────────────────
-- `source` (0030) already exists and is NOT what this is. `source` records WHO
-- ASKED — api, ui, schedule, benchmark, rerun. `audit_type` records WHAT KIND
-- of audit it is — a single page, a domain snapshot, a benchmark member, a
-- prompt monitor, a re-audit. They overlap on two values and diverge on the
-- rest: a scheduled run is `source = schedule` and `audit_type = rerun`,
-- because a monitor re-audits a page it has audited before, and a UI-initiated
-- domain snapshot would be `source = ui`, `audit_type = domain`.
--
-- Collapsing them, which is what the module did until now, is why "show me my
-- domain snapshots" and "show me everything the scheduler ran" could not both
-- be answered.
--
-- ── WHY THE CHECK LISTS TWO TYPES THE ENGINE CANNOT PRODUCE ────────────────
-- `domain` and `prompt_monitor` are legal values here and REFUSED by the API.
-- The vocabulary is a stored contract and widening a live CHECK later is a
-- migration, a deploy, and a window in which the API and the database disagree
-- about what is legal. Declaring the full set now costs nothing.
--
-- What would cost something is a row claiming to be a domain snapshot when a
-- single page was fetched, so `intakeModel.js` marks both `available: false`
-- and the router rejects them outright. A rejected request is visible in the
-- moment; a mislabelled row is discovered a quarter later, inside a trend line.

-- ── The four business-model profiles ───────────────────────────────────────
--
-- The BRD names eight profiles; 0030 allowed four. The four being added name a
-- BUSINESS rather than a framework, because "which of SEO, AEO and GEO matters
-- most to me?" is not a question a customer can answer on their first visit
-- and "I sell software" is.
--
-- ⚠️ A PROFILE IS STILL A LENS AND NOT DIFFERENT MATHS. All four framework
-- views are computed with identical weightings under every profile; the
-- profile selects which one leads the report. See the header of
-- src/lib/discoverability/auditProfiles.js. Nothing in this migration can
-- move a score, and `scoring_model_version` therefore stays 'v1'.
--
-- Dropped and re-added rather than widened in place: a CHECK constraint has no
-- ALTER form. The names are Postgres's own defaults for an inline
-- single-column check (`<table>_<column>_check`), which is what 0030 created.
alter table public.audits
  drop constraint if exists audits_audit_profile_check;
alter table public.audits
  add constraint audits_audit_profile_check
  check (audit_profile in ('balanced','seo','aeo','geo','saas','services','local','ecommerce'));

alter table public.audit_benchmarks
  drop constraint if exists audit_benchmarks_audit_profile_check;
alter table public.audit_benchmarks
  add constraint audit_benchmarks_audit_profile_check
  check (audit_profile in ('balanced','seo','aeo','geo','saas','services','local','ecommerce'));

alter table public.audit_schedules
  drop constraint if exists audit_schedules_audit_profile_check;
alter table public.audit_schedules
  add constraint audit_schedules_audit_profile_check
  check (audit_profile in ('balanced','seo','aeo','geo','saas','services','local','ecommerce'));

-- ── What kind of audit this is ─────────────────────────────────────────────
alter table public.audits
  add column if not exists audit_type text not null default 'url';

-- Defaulted, unlike primary_goal, because unlike a goal this one IS knowable
-- retrospectively: every audit that already exists fetched exactly one page,
-- which is what 'url' means. The default is a true statement about the past,
-- not a guess at one.
alter table public.audits
  drop constraint if exists audits_audit_type_check;
alter table public.audits
  add constraint audits_audit_type_check
  check (audit_type in ('url','domain','benchmark','prompt_monitor','rerun'));

comment on column public.audits.audit_type is
  'What kind of audit this is: url | domain | benchmark | prompt_monitor | rerun. Distinct from `source`, which records who asked (api|ui|schedule|benchmark|rerun). `domain` and `prompt_monitor` are legal values the engine cannot yet produce and the API refuses — see src/lib/discoverability/intakeModel.js.';

-- ── What the customer is trying to achieve ─────────────────────────────────
alter table public.audits
  add column if not exists primary_goal text;

alter table public.audits
  drop constraint if exists audits_primary_goal_check;
alter table public.audits
  add constraint audits_primary_goal_check
  check (primary_goal is null or primary_goal in (
    'seo_health','ai_citations','product_discovery',
    'service_leads','local_discovery','competitor_intelligence'));

comment on column public.audits.primary_goal is
  'The discoverability goal the customer selected at intake. NULL means the question was not asked or not answered — never a default, because a goal cannot be re-derived from anything and a fabricated one would propagate into the P2 modules that key off it. Changes which lens leads the report; changes NO score.';

-- ── Where they are trying to be found ──────────────────────────────────────
alter table public.audits
  add column if not exists target_geography jsonb;

comment on column public.audits.target_geography is
  'Normalised {country, region, city, language}, or NULL. Written by normaliseGeography() in src/lib/discoverability/intakeModel.js, which returns NULL rather than {} for an empty intake: an empty object reads as "asked and answered nowhere", which is a different claim from "nobody was asked". Country is upper-cased only when it is already an ISO 3166-1 alpha-2 code; free text is stored as typed rather than half-guessed into a code.';

-- ── Who they measure themselves against ────────────────────────────────────
alter table public.audits
  add column if not exists competitor_urls text[] not null default '{}';

comment on column public.audits.competitor_urls is
  'Competitors named at intake, capped at MAX_COMPETITOR_URLS (10). RECORDED CONTEXT ONLY — naming a competitor here fetches nothing and spends no audit credit. audit_benchmarks is what turns them into runs.';

-- ── How the profile was chosen ─────────────────────────────────────────────
--
-- The same rule the evidence envelope enforces one layer down: an observed
-- fact and an inference must never be presented as the same kind of thing.
-- "You are reading the GEO view because you asked for it" and "because we
-- guessed from your schema" are different claims, and a customer who disagrees
-- with the second one needs to be able to see that it was a guess.
--
-- Defaulted to 'default' — literally true of every existing row, all of which
-- carry the profile they were sent or the 'balanced' fallback, with nothing
-- inferred because nothing inferred anything before this migration.
alter table public.audits
  add column if not exists audit_profile_source text not null default 'default';

alter table public.audits
  drop constraint if exists audits_audit_profile_source_check;
alter table public.audits
  add constraint audits_audit_profile_source_check
  check (audit_profile_source in ('explicit','goal','inferred','default'));

comment on column public.audits.audit_profile_source is
  'Why this audit carries the profile it does: explicit (the customer chose it) | goal (derived from primary_goal) | inferred (read from the page) | default. Resolved by resolveAuditProfile() in src/lib/discoverability/intakeModel.js, whose ordering is the definition of this column.';

-- "Show me every audit run for local discovery" is a real question and this is
-- what makes it an index scan. Partial, because the column is NULL on every
-- row that predates the question and those rows answer no goal query.
create index if not exists audits_owner_goal_idx
  on public.audits (user_id, primary_goal, created_at desc)
  where primary_goal is not null;

create index if not exists audits_owner_type_idx
  on public.audits (user_id, audit_type, created_at desc);

-- ── Intake reuse on the recurring path ─────────────────────────────────────
--
-- A schedule re-audits the same page week after week, and the trend line it
-- produces is only comparable if every run was commissioned the same way. A
-- monitor that dropped the goal and the geography on every run would build a
-- twelve-month series in which the first point had context and none of the
-- others did — and the comparison would still be drawn, because nothing in the
-- diff engine knows the context changed.
alter table public.audit_schedules
  add column if not exists primary_goal text;

alter table public.audit_schedules
  drop constraint if exists audit_schedules_primary_goal_check;
alter table public.audit_schedules
  add constraint audit_schedules_primary_goal_check
  check (primary_goal is null or primary_goal in (
    'seo_health','ai_citations','product_discovery',
    'service_leads','local_discovery','competitor_intelligence'));

alter table public.audit_schedules
  add column if not exists page_type_hint text;

alter table public.audit_schedules
  add column if not exists target_geography jsonb;

alter table public.audit_schedules
  add column if not exists competitor_urls text[] not null default '{}';

comment on column public.audit_schedules.primary_goal is
  'Carried onto every audit this schedule creates, so a monitored page keeps the context it was commissioned with across the whole trend line.';
