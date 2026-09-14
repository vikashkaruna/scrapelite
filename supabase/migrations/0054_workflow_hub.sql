-- 0054_workflow_hub.sql — W8. The lifecycle a queue needs to be a queue.
--
-- Shipped states are `open | accepted | dismissed | done`. The PRD's lifecycle
-- is Open → Accepted → Assigned → In progress → Implemented → Validation
-- scheduled → Validated, and the gap between those two lists is the difference
-- between a checklist and a workflow: there is no way to say a fix is underway,
-- and no way to say it was verified rather than merely claimed.
--
-- ── EIGHT STATES, NOT THE PRD'S SEVEN ──────────────────────────────────────
-- `dismissed` is ours and it stays. A queue you cannot decline an item from
-- forces the user to either do work they judged unnecessary or leave it open
-- for ever, and the mandatory dismissal REASON this codebase already enforces
-- is some of the most useful data in the table — "three months from now a
-- dismissal with no reason is indistinguishable from a mis-click".
--
-- ── `done` IS KEPT AS AN ALIAS OF `implemented` ────────────────────────────
-- Every stored row, every export and every webhook payload in existence uses
-- `done`. Renaming it would rewrite history and break the three UI call sites
-- that post it. `implemented` is the PRD's word for the same state and both are
-- accepted; `recommendationModel.js` maps them to one label.

alter table public.audit_recommendations
  drop constraint if exists audit_recommendations_status_check;

alter table public.audit_recommendations
  add constraint audit_recommendations_status_check
  check (status in (
    -- Shipped, and still written by the existing UI.
    'open', 'accepted', 'dismissed', 'done',
    -- The PRD's lifecycle states that had nowhere to live.
    'assigned', 'in_progress', 'implemented', 'validation_scheduled', 'validated'
  ));

comment on column public.audit_recommendations.status is
  'Lifecycle state. Eight meaningful values: the PRD''s seven plus ''dismissed'', which is ours and load-bearing — a queue you cannot decline from forces work nobody judged necessary. ''done'' and ''implemented'' are the same state under two names; ''done'' is kept because every stored row and webhook payload uses it.';

-- ── Due dates and notes ────────────────────────────────────────────────────
alter table public.audit_recommendations
  add column if not exists due_at timestamptz;

comment on column public.audit_recommendations.due_at is
  'When the owner committed to having this done. NULL is the default and the common case — an imposed due date nobody agreed to is noise, so this is only ever set explicitly.';

alter table public.audit_recommendations
  add column if not exists notes text;

comment on column public.audit_recommendations.notes is
  'Free text from whoever is working the item. Deliberately not structured: the useful content here is "blocked on the CMS migration", which no schema anticipates.';

-- ── Validation ─────────────────────────────────────────────────────────────
--
-- 🔴 `validated_by_audit_id` IS WHAT MAKES 'validated' MEAN ANYTHING.
-- Without it, `validated` is a second word for `implemented` — a claim by the
-- same person who did the work. Pointing at the audit that re-measured the
-- signal afterwards is the difference between "I fixed it" and "it is fixed",
-- and the closed loop this whole product promises rests on that distinction.
alter table public.audit_recommendations
  add column if not exists validated_by_audit_id uuid
    references public.audits(id) on delete set null;

comment on column public.audit_recommendations.validated_by_audit_id is
  'The audit that re-measured this signal after the fix. Without it ''validated'' is just a second word for ''implemented'' — a claim by the person who did the work rather than a measurement.';

create index if not exists audit_recommendations_due_idx
  on public.audit_recommendations (user_id, due_at)
  where due_at is not null and status not in ('done', 'implemented', 'validated', 'dismissed');

-- ── D6: workspace_id, actually written ─────────────────────────────────────
--
-- The columns have existed since 0030 and nothing has ever written them. D6
-- rules that P1 wires them through because back-filling later is far more
-- expensive than carrying them now — the same reasoning that made `raw_value`
-- and `audit_recommendations.issue_id` worth fixing rather than dropping.
--
-- ⚠️ NULL REMAINS VALID AND COMMON. Most audits are run by a solo operator with
-- no workspace at all, and a NOT NULL here would make the whole module require
-- a concept most users never touch.
alter table public.audit_recommendations
  add column if not exists workspace_id uuid;

comment on column public.audit_recommendations.workspace_id is
  'Denormalised from the audit so the queue can be filtered by workspace without a join. NULL is valid and common: most audits have no workspace.';

create index if not exists audit_recommendations_workspace_idx
  on public.audit_recommendations (workspace_id, status)
  where workspace_id is not null;

create index if not exists audits_workspace_idx
  on public.audits (workspace_id, created_at desc)
  where workspace_id is not null;
