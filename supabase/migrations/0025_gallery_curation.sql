-- 0025_gallery_curation.sql
-- Persona tagging + a human-verified promotion step for the public gallery
-- (/gallery, public_reports — see 0007_public_reports.sql).
--
-- ── Why ──────────────────────────────────────────────────────────────────
-- Today anything in public_reports is anon-insertable (0007's "anon insert"
-- policy is `with check (true)` by design — we never reject a share because
-- the visitor isn't signed in) and shows up in /gallery immediately. That's
-- correct for "share my one extraction with a colleague," but it means
-- /gallery itself is just a feed of whatever anonymous visitors happened to
-- share, not a curated showcase — there is no way to say "these N reports
-- are good examples of what a sales / SEO / recruiter persona can do here."
--
-- This migration adds that as pure metadata on top of the existing table.
-- It does NOT touch is_public or any existing RLS policy: curating a report
-- is a promotion within already-public rows, not a new publish path, and a
-- report a user shared and later deletes is still governed by the existing
-- owner-delete policy regardless of whether it was ever curated.
--
-- The verification step itself is enforced by netlify/functions/admin-gallery.js
-- (verifyAdminToken()-gated, same pattern as admin-revenue.js / admin-monitoring.js)
-- — this migration only adds the columns that record that a human reviewed
-- the row before curated flipped to true. It cannot itself prove a human
-- looked; that's the admin function's job, not the schema's.

alter table public.public_reports
  add column if not exists persona     text,
  add column if not exists curated     boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text;

-- Kept nullable and constrained rather than an enum: the 7 ids live in
-- src/lib/personaConfig.js (application code, not the DB), and a CHECK that
-- mirrors them catches a typo in the admin UI without requiring a migration
-- every time a persona is renamed — update this list alongside personaConfig.js.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'public_reports_persona_check'
  ) then
    alter table public.public_reports
      add constraint public_reports_persona_check
      check (persona is null or persona in (
        'sales', 'competitive-intel', 'seo', 'market-research',
        'recruiter', 'founder-vc', 'agency'
      ));
  end if;
end $$;

-- /gallery's persona filter reads "curated rows for persona X" — this is
-- its hot path, so it gets its own partial index rather than relying on the
-- existing created_at index to filter after the fact.
create index if not exists public_reports_curated_persona_idx
  on public.public_reports (persona, created_at desc)
  where curated = true;
