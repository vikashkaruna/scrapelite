-- ═══════════════════════════════════════════════════════════════════════════
-- APPLY 0040_pql.sql  —  Phase 3 (Activation / PQL)
--
-- TARGET: the STAGING/DEV Supabase project  →  aubwooslkkrprdxuiyvj
--         (public/runtime-config.js sends everything except `main` there, so
--          the deploy preview and staging.datiq.app both use this project.
--          Production `sikkfxysjhirmtwkumpt` is a SEPARATE, later step.)
--
-- HOW: Supabase Dashboard → SQL Editor → paste → Run.
--      Do NOT use `npm run migrate:prod` — CLAUDE.md documents that it replays
--      ALL migrations (`--include=` is additive, not restrictive), and
--      `supabase db push` targets the LINKED project, currently DatIQ-prod.
--
-- SAFE TO RE-RUN. Every statement is `if not exists` / `or replace`.
-- ADDITIVE ONLY — creates 2 tables + 1 function. Touches nothing existing.
--
-- Verified against in-process WASM Postgres: 40 migrations applied,
-- 360 assertions, 0 failed (`npm run test:db`). Never yet run on real
-- Supabase — which is what this step is for.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0040_pql.sql
-- Phase 3 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md —
-- activation instrumentation (PQL).
--
-- ── WHY A SEPARATE TABLE AND NOT A COLUMN ON entitlements ───────────────────
-- A PQL score is a DERIVED OPINION about a user, recomputed as the weight
-- table is tuned. `entitlements` is authorization state: what somebody paid
-- for. Mixing a mutable marketing score into the row every gate reads would
-- put a number nobody validates on the same path as the ones that decide
-- whether a request is allowed — and would make a scoring backfill an UPDATE
-- against the billing table.
--
-- ── activation_events IS APPEND-ONLY; pql_scores IS A CACHE ─────────────────
-- Same split as 0037: the events are the truth, the score is derived and may
-- be rebuilt from them at any time. That is what makes tuning PQL_SIGNALS
-- safe — a weight change is a recompute, never a data migration.
--
-- ── coverage IS STORED, AND NULL SCORES ARE LEGAL ───────────────────────────
-- src/lib/pql/pqlModel.js excludes signals this deployment cannot MEASURE and
-- redistributes their weight, rather than scoring them zero. A score computed
-- from three of nine signals is not the same claim as one computed from all
-- nine, so `coverage` travels with every row and `score` is NULLABLE: nothing
-- measurable means no score, which must not be storable as a 0 that later
-- reads as "unqualified". This mirrors the rule the discoverability module is
-- built on.
--
-- ── NO user_id FOREIGN KEY CASCADE ON activation_events ─────────────────────
-- Unlike the ledger, these ARE user content and SHOULD be purged with the
-- account, so both tables cascade. They are listed in billing-purge.js's
-- PURGE_TABLES for exactly that reason. Recording that here so the next person
-- to read this file does not have to re-derive the difference from 0037.
--
-- Adds 2 tables, 1 function, 0 triggers.

-- ── append-only activation events ──────────────────────────────────────────
create table if not exists public.activation_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  session_id  text,
  name        text not null,
  properties  jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  -- Either an account or an anonymous session must identify the row; a row
  -- attributable to neither can never be scored and is pure noise.
  constraint activation_events_subject_chk check (user_id is not null or session_id is not null)
);

create index if not exists activation_events_user_idx on public.activation_events (user_id, occurred_at desc);
create index if not exists activation_events_name_idx on public.activation_events (name, occurred_at desc);
create index if not exists activation_events_session_idx on public.activation_events (session_id, occurred_at desc)
  where session_id is not null;

-- ── the derived score cache ────────────────────────────────────────────────
create table if not exists public.pql_scores (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  -- NULL is a legal, meaningful value: nothing measurable. See the header.
  -- Scale is 0..130, NOT 0..100 — the PRD's nine signals sum to 130 and its
  -- threshold is 50 RAW POINTS. Storing a percentage here would re-scale that
  -- threshold to 65 points without anyone noticing.
  score        integer,
  -- Fraction of the signal weight that was measurable, 0..1.
  coverage     numeric(4,3) not null default 1.000,
  is_pql       boolean not null default false,
  activated    boolean not null default false,
  persona      text,
  -- The signal map the score was computed from, so a score is always
  -- explainable after the fact — including after the weights change.
  signals      jsonb not null default '{}'::jsonb,
  -- Which signals were excluded as unmeasurable at compute time. Without this,
  -- a low score from a partially-instrumented deployment is indistinguishable
  -- from a genuinely disengaged user, months later, with no way to tell.
  -- NOT named `excluded`: that is the pseudo-table name ON CONFLICT DO UPDATE
  -- binds, so `excluded = excluded.excluded` is a parse error waiting to
  -- happen the first time anyone writes an upsert against this table.
  excluded_signals text[] not null default '{}',
  computed_at  timestamptz not null default now(),
  constraint pql_scores_score_chk    check (score is null or (score >= 0 and score <= 130)),
  constraint pql_scores_coverage_chk check (coverage >= 0 and coverage <= 1),
  -- A NULL score cannot be a PQL. Enforced here rather than trusted from the
  -- application, because "no data" quietly becoming "qualified" is the exact
  -- failure that would put sales in front of a user who has done nothing.
  constraint pql_scores_null_not_pql_chk check (score is not null or is_pql = false)
);

create index if not exists pql_scores_pql_idx on public.pql_scores (is_pql, score desc) where is_pql;

-- ── RLS: service key only ──────────────────────────────────────────────────
-- Same posture as 0029_referrals.sql and 0031_team_workspaces.sql. The browser
-- only ever reaches Supabase through apiClient.js -> Netlify Functions, so an
-- anon/authenticated policy would be unused attack surface. A PQL score is
-- also commercially sensitive: a user must never be able to read how the
-- product scores them as a sales target.
alter table public.activation_events enable row level security;
alter table public.pql_scores        enable row level security;

-- ── upsert one computed score ──────────────────────────────────────────────
-- Takes the ALREADY-COMPUTED values rather than computing here: scorePql lives
-- in src/lib/pql/pqlModel.js and is imported by both React and netlify/, so
-- reimplementing the weights in PL/pgSQL would create a second, silently
-- diverging definition of what a PQL is. This function only persists.
create or replace function public.record_pql_score(
  p_user_id   uuid,
  p_score     integer,
  p_coverage  numeric,
  p_is_pql    boolean,
  p_activated boolean,
  p_persona   text,
  p_signals   jsonb,
  p_excluded_signals text[]
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return 'no_user';
  end if;
  -- A score with no data is not a qualification. Belt and braces with the
  -- CHECK constraint above: the constraint stops a bad row being written, this
  -- stops a caller having to think about it.
  insert into public.pql_scores (user_id, score, coverage, is_pql, activated, persona, signals, excluded_signals)
  values (p_user_id, p_score, coalesce(p_coverage, 1.000),
          coalesce(p_is_pql, false) and p_score is not null,
          coalesce(p_activated, false), p_persona,
          coalesce(p_signals, '{}'::jsonb), coalesce(p_excluded_signals, '{}'))
  on conflict (user_id) do update set
    score       = excluded.score,
    coverage    = excluded.coverage,
    is_pql      = excluded.is_pql,
    activated   = excluded.activated,
    persona     = excluded.persona,
    signals     = excluded.signals,
    excluded_signals = excluded.excluded_signals,
    computed_at = now();
  return 'ok';
exception
  when foreign_key_violation then
    return 'no_user';
end;
$$;

revoke all on function public.record_pql_score(uuid, integer, numeric, boolean, boolean, text, jsonb, text[]) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY — run these after the migration. Expected results in comments.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Both tables exist.                          expect: 2 rows
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('activation_events', 'pql_scores')
 order by table_name;

-- 2. RLS is ON for both.                          expect: both t
select relname, relrowsecurity
  from pg_class
 where relname in ('activation_events', 'pql_scores');

-- 3. NO anon/authenticated policies — service key only, like 0029/0031.
--                                                 expect: 0 rows
select tablename, policyname, roles
  from pg_policies
 where tablename in ('activation_events', 'pql_scores');

-- 4. The function exists.                         expect: 1 row
select proname from pg_proc
 where proname = 'record_pql_score';

-- 5. THE RULE THAT MATTERS: a NULL score is legal and can never be a PQL.
--    A null score means "nothing was measurable" — storing it as 0 would read
--    as "unqualified" for ever after, which is a claim nobody made.
--                                                 expect: ERROR (constraint)
-- Uncomment to prove the constraint bites, then roll back:
-- begin;
--   insert into public.pql_scores (user_id, score, is_pql)
--   values ((select id from auth.users limit 1), null, true);
-- rollback;

-- 6. Score range is 0..130, NOT 0..100 — the PRD's nine signals sum to 130
--    and its threshold is 50 RAW POINTS.          expect: the 130 bound
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.pql_scores'::regclass
   and conname = 'pql_scores_score_chk';
