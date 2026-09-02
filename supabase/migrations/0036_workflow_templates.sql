-- 0036_workflow_templates.sql
-- Phase 0 of docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md — the spine.
--
-- ── WHY A TABLE AT ALL, WHEN extractionTemplates.js ALREADY EXISTS ──────────
-- src/lib/extractionTemplates.js holds 12 "recipes": an example URL, an intent,
-- and a prompt string. That is a PROMPT-PREFILL LIBRARY — it tells the composer
-- what to type. It cannot express what PRD 1 actually asks for: a versioned
-- definition carrying input_schema, extraction_schema, output_schema,
-- credit_cost and plan_entitlement, whose runs are persisted objects.
--
-- This migration does NOT replace that file. The 12 recipes keep serving
-- TemplateGallery.jsx exactly as they do today and become seed rows for the
-- new engine. Deleting them would break TemplateGallery + its tests for no
-- gain; the engine is a superset, not a migration target.
--
-- ── WHY VERSIONS ARE IMMUTABLE ONCE PUBLISHED ───────────────────────────────
-- PRD 1: "Maintain versioned prompts/extraction instructions so prior results
-- remain reproducible." If a published template's prompt could be edited in
-- place, every historical run silently changes meaning: a report shared in
-- March would claim to have been produced by a template that no longer exists
-- as it was. Worse, the change is invisible — nothing in the run row would
-- differ. So a published version is frozen by a BEFORE UPDATE trigger and a
-- change is a NEW VERSION, never an edit. This is the same discipline
-- 0016_invoices.sql applies to issued invoices, for the same reason: a record
-- that other records point at cannot be quietly rewritten.
--
-- ── WHY template_runs IS ONE TABLE FOR ALL FIVE PRDs ────────────────────────
-- A single-URL template execution, one row of a bulk enrichment list, and one
-- competitor watchlist snapshot are the same object: an execution of a pinned
-- template version producing a structured output with provenance. Giving each
-- its own result envelope would force PRD 2 (reports) to special-case four
-- shapes to render one page, and PRD 5 (rules) to subscribe to four event
-- payloads. One run object is what makes those two phases cheap.
--
-- ── THE COMPOSITE FK IS LOAD-BEARING ────────────────────────────────────────
-- template_runs references (template_key, version), NOT just template_key. The
-- database therefore refuses a run that points at a version which does not
-- exist, and a run always records exactly which definition produced it. That is
-- reproducibility enforced by the schema rather than by convention.
--
-- Adds 3 tables, 1 function, 1 trigger.

-- ── the versioned definition ────────────────────────────────────────────────
create table if not exists public.workflow_templates (
  id                uuid primary key default gen_random_uuid(),
  template_key      text not null,                    -- stable id: 'account_brief'
  version           integer not null,                 -- 1, 2, 3 … monotonic per key
  status            text not null default 'draft',
  title             text not null,
  persona           text,                             -- personaConfig.js id, nullable
  summary           text,
  -- What the user is asked for (drives the run form).
  input_schema      jsonb not null default '{}'::jsonb,
  -- What we try to pull out of the fetched pages.
  extraction_schema jsonb not null default '{}'::jsonb,
  -- How the result is laid out (drives the report + run view).
  output_schema     jsonb not null default '{}'::jsonb,
  -- Versioned prompt text. Frozen with the rest of the row on publish.
  prompt_bundle     jsonb not null default '{}'::jsonb,
  -- {base, per_page, per_ai_call} — read by src/lib/credits/creditModel.js.
  credit_cost       jsonb not null default '{}'::jsonb,
  -- entitlementModel.js capability string, e.g. 'template.run'.
  plan_entitlement  text,
  min_plan          text,                             -- pricingConfig plan id
  published_at      timestamptz,
  created_by        uuid references auth.users,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint workflow_templates_status_chk
    check (status in ('draft', 'published', 'superseded', 'archived')),
  constraint workflow_templates_version_chk check (version >= 1),
  constraint workflow_templates_key_version_uniq unique (template_key, version)
);

create index if not exists workflow_templates_key_idx
  on public.workflow_templates (template_key, version desc);
create index if not exists workflow_templates_persona_idx
  on public.workflow_templates (persona) where status = 'published';

-- At most ONE published version per key. Without this, resolving "the current
-- account_brief" is ambiguous and two concurrent publishes both win.
create unique index if not exists workflow_templates_one_published_idx
  on public.workflow_templates (template_key) where status = 'published';

-- ── a run: one execution of one pinned version ──────────────────────────────
create table if not exists public.template_runs (
  id                text primary key,                 -- 'trun_' + base36, client-generatable
  template_key      text not null,
  template_version  integer not null,
  user_id           uuid references auth.users,       -- nullable: guest runs
  workspace_id      uuid references public.workspaces(id) on delete set null,
  status            text not null default 'queued',
  -- 'needs_review' is here, not only in the bulk tables, because PRD 3's review
  -- queue and a low-confidence single run are the same condition.
  input             jsonb not null default '{}'::jsonb,
  output            jsonb,                            -- conforms to output_schema
  output_summary    text,
  credits_estimated integer,
  credits_actual    integer,
  error             text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint template_runs_status_chk check (status in (
    'queued', 'running', 'complete', 'partial', 'failed', 'needs_review', 'cancelled'
  )),
  constraint template_runs_template_fk
    foreign key (template_key, template_version)
    references public.workflow_templates (template_key, version)
);

create index if not exists template_runs_user_idx
  on public.template_runs (user_id, created_at desc);
create index if not exists template_runs_status_idx
  on public.template_runs (status, created_at desc);
create index if not exists template_runs_template_idx
  on public.template_runs (template_key, created_at desc);
create index if not exists template_runs_workspace_idx
  on public.template_runs (workspace_id, created_at desc) where workspace_id is not null;

-- ── every page a run actually fetched ───────────────────────────────────────
-- content_hash is the §1.4 pre-filter: on a re-run, an unchanged hash means we
-- can skip extraction entirely and spend no credits and no AI call.
create table if not exists public.template_run_sources (
  id            uuid primary key default gen_random_uuid(),
  run_id        text not null references public.template_runs(id) on delete cascade,
  url           text not null,
  canonical_url text,
  fetched_at    timestamptz,
  http_status   integer,
  provider      text,                                 -- firecrawl|spider|jina|direct
  content_hash  text,
  bytes         integer,
  error         text,
  created_at    timestamptz not null default now()
);

create index if not exists template_run_sources_run_idx
  on public.template_run_sources (run_id);
create index if not exists template_run_sources_hash_idx
  on public.template_run_sources (canonical_url, content_hash);

-- ── publish: mint the next version and retire the previous one, atomically ──
create or replace function public.publish_template_version(
  p_key text, p_def jsonb, p_actor uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_next integer;
  v_id   uuid;
begin
  if p_key is null or btrim(p_key) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_key');
  end if;
  if p_def is null or coalesce(btrim(p_def->>'title'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'title_required');
  end if;

  select coalesce(max(version), 0) + 1 into v_next
    from public.workflow_templates where template_key = p_key;

  -- Retire the incumbent FIRST: the partial unique index allows exactly one
  -- published row per key, so inserting before superseding would deadlock
  -- against itself on the second publish.
  update public.workflow_templates
     set status = 'superseded', updated_at = now()
   where template_key = p_key and status = 'published';

  insert into public.workflow_templates (
    template_key, version, status, title, persona, summary,
    input_schema, extraction_schema, output_schema, prompt_bundle,
    credit_cost, plan_entitlement, min_plan, published_at, created_by
  ) values (
    p_key, v_next, 'published', p_def->>'title', p_def->>'persona', p_def->>'summary',
    coalesce(p_def->'input_schema',      '{}'::jsonb),
    coalesce(p_def->'extraction_schema', '{}'::jsonb),
    coalesce(p_def->'output_schema',     '{}'::jsonb),
    coalesce(p_def->'prompt_bundle',     '{}'::jsonb),
    coalesce(p_def->'credit_cost',       '{}'::jsonb),
    p_def->>'plan_entitlement', p_def->>'min_plan', now(), p_actor
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_next);
end $$;

-- ── a published version is frozen ───────────────────────────────────────────
-- Only `status` (published → superseded/archived) and `updated_at` may move.
-- Any other edit is refused outright rather than silently accepted, because a
-- silently-edited template makes every past run's provenance a lie.
create or replace function public.workflow_templates_immutable()
returns trigger language plpgsql as $$
begin
  if old.status <> 'published' then
    return new;
  end if;
  if new.template_key      is distinct from old.template_key
  or new.version           is distinct from old.version
  or new.title             is distinct from old.title
  or new.persona           is distinct from old.persona
  or new.summary           is distinct from old.summary
  or new.input_schema      is distinct from old.input_schema
  or new.extraction_schema is distinct from old.extraction_schema
  or new.output_schema     is distinct from old.output_schema
  or new.prompt_bundle     is distinct from old.prompt_bundle
  or new.credit_cost       is distinct from old.credit_cost
  or new.plan_entitlement  is distinct from old.plan_entitlement
  or new.min_plan          is distinct from old.min_plan
  or new.published_at      is distinct from old.published_at
  then
    raise exception 'workflow_templates: published version %/% is immutable — publish a new version instead',
      old.template_key, old.version;
  end if;
  return new;
end $$;

drop trigger if exists workflow_templates_immutable_trg on public.workflow_templates;
create trigger workflow_templates_immutable_trg
  before update on public.workflow_templates
  for each row execute function public.workflow_templates_immutable();

-- ── RLS: service key only ───────────────────────────────────────────────────
-- Same posture as 0029_referrals.sql and 0031_team_workspaces.sql. The browser
-- reaches Supabase only through Netlify functions (locked architecture rule),
-- so an anon/authenticated policy here would be unused attack surface.
alter table public.workflow_templates    enable row level security;
alter table public.template_runs         enable row level security;
alter table public.template_run_sources  enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'workflow_templates' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.workflow_templates
             for all to service_role using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'template_runs' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.template_runs
             for all to service_role using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'template_run_sources' and policyname = 'service full access') then
    execute 'create policy "service full access" on public.template_run_sources
             for all to service_role using (true) with check (true)';
  end if;
end $$;
