-- 0084_role_ids.sql — allow the 2026-09-24 roles on curated gallery reports.
--
-- 0025 pinned public_reports.persona to the seven V4 persona ids. The product
-- now has eight roles (src/lib/personaConfig.js): three are new ids (revops,
-- pmm, brand-growth). The two retired ids stay ALLOWED — market-research
-- (merged into founder-vc) and recruiter (a hidden legacy role) — because rows
-- already curated under them must keep satisfying the constraint, and a
-- constraint change that fails on existing rows is an apply that fails.
--
-- Additive only: every value 0025 accepted is still accepted. Re-runnable.

alter table public.public_reports drop constraint if exists public_reports_persona_check;
alter table public.public_reports
  add constraint public_reports_persona_check
  check (persona is null or persona in (
    'sales', 'revops', 'competitive-intel', 'pmm', 'seo',
    'brand-growth', 'founder-vc', 'agency',
    -- retired ids, kept valid for existing rows
    'market-research', 'recruiter'
  ));
