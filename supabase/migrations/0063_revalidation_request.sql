-- 0063_revalidation_request.sql — P2 · W14: revalidation is a REQUEST.
--
-- `validation_scheduled` has been a legal recommendation state since 0054, and
-- `validated_by_audit_id` has been there to record which audit confirmed the
-- fix. Between them sat nothing: no way to say "please re-check this", so the
-- state was set by hand and the loop never closed.
--
-- ── 🔴 WHY THIS IS A REQUEST AND NOT A BUTTON THAT RUNS AN AUDIT ──────────
--
-- A re-audit is a PAID action — it is several fetches, a PageSpeed lookup, a
-- citation sample and an AI call, which is why `audit` has its own monthly
-- budget rather than debiting extraction credits. An "is this fixed yet?"
-- control that silently spends one is the shape of thing a customer discovers
-- on an invoice. So the request is recorded here, gated on `audit.revalidate`
-- (which delegates to the real audit quota), and the run happens on the
-- monitor's own tick where it is visible and countable.
--
-- ⚠️ AND IT IS IDEMPOTENT BY CONSTRUCTION. `revalidation_requested_at` is set
-- once and only cleared when the run completes; a second request while one is
-- outstanding returns the existing one rather than queuing a second paid
-- audit. Clicking twice must not cost twice.
--
-- ⚠️ COLUMNS, NOT A TABLE, deliberately. Nothing here is several writes that
-- must not separate — the test `promote_business_truth_version` had to pass —
-- so a table would buy nothing and add a join to every queue read. Same
-- reasoning 0054 applied to the lifecycle itself.

alter table public.audit_recommendations
  add column if not exists revalidation_requested_at timestamptz,
  -- The audit the fix is being measured AGAINST. Without it "did this improve"
  -- has no answer: a re-audit alone reports a number, not a change — and
  -- `sameSubject()` needs both sides to decide whether the comparison is even
  -- legitimate (D7).
  add column if not exists revalidation_baseline_audit_id uuid
    references public.audits(id) on delete set null;

comment on column public.audit_recommendations.revalidation_requested_at is
  'W14. Set when a re-audit is requested, cleared when it completes. A second request while this is set returns the first — clicking twice must not cost twice.';
comment on column public.audit_recommendations.revalidation_baseline_audit_id is
  'W14. The audit the fix is measured against. A re-audit without a baseline reports a number, not a change.';

-- Outstanding requests, for the worker. Partial, because the overwhelming
-- majority of rows have no request and indexing them would be dead weight.
create index if not exists audit_recommendations_revalidation_idx
  on public.audit_recommendations (user_id, revalidation_requested_at)
  where revalidation_requested_at is not null;
