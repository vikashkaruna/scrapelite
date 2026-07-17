-- scripts/provenance.sql
-- Q9 — Per-field provenance metadata.
-- Adds a `provenance` jsonb column to the extractions table to store the
-- Q9 metadata (source URL, field_count, avg_confidence, last_checked_at,
-- fields{ label: [{ source_url, confidence, last_checked_at, retrieval, ... }] }).
--
-- Safe to re-run: every statement is idempotent. The column is nullable so
-- existing rows are unaffected — provenance is generated on extract and
-- attached to new rows going forward.

ALTER TABLE public.extractions
  ADD COLUMN IF NOT EXISTS provenance jsonb;

-- Useful partial index for the most common admin query: "give me the
-- extractions whose provenance is stale (older than 7 days)".
CREATE INDEX IF NOT EXISTS extractions_provenance_checked_idx
  ON public.extractions ((provenance->>'last_checked_at'))
  WHERE provenance IS NOT NULL;

-- GIN index on the fields map so we can search by field label later.
CREATE INDEX IF NOT EXISTS extractions_provenance_fields_gin
  ON public.extractions USING gin ((provenance->'fields') jsonb_path_ops)
  WHERE provenance IS NOT NULL;
