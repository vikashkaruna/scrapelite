-- 0059_local_directory_listing_upsert.sql — make W12's listing upsert legal.
--
-- 0058 promises one CURRENT listing per (owner, truth record, source).  It used
-- an expression unique index to make NULL truth_record_id values conflict too.
-- That enforces the invariant for ordinary INSERTs, but PostgREST's
-- `on_conflict=user_id,truth_record_id,source_id` names COLUMNS, not an
-- expression.  PostgreSQL therefore cannot select 0058's expression index as
-- the upsert arbiter, and the normal API save fails before it can update a
-- listing.
--
-- PostgreSQL 15's `NULLS NOT DISTINCT` expresses the actual rule as a named
-- column constraint: two NULL truth-record ids are the same key.  That keeps
-- the no-duplicate invariant AND makes the existing column-based PostgREST
-- upsert valid.  This is deliberately forward-only: 0058 is already applied
-- to dev/stage, so rewriting its historical DDL would not repair either.

alter table public.audit_directory_listings
  drop constraint if exists audit_dir_listing_unique;

-- On a 0058-only database this removes the expression index. On a re-run, the
-- preceding DROP CONSTRAINT has already removed its same-named backing index,
-- so this is a harmless no-op. The order is load-bearing: dropping a
-- constraint-backed index first is rejected by PostgreSQL.
drop index if exists public.audit_dir_listing_unique;

alter table public.audit_directory_listings
  add constraint audit_dir_listing_unique
  unique nulls not distinct (user_id, truth_record_id, source_id);
