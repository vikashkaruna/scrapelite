# Runbook — populating and curating the public gallery

**Read this first: curating the gallery will not clear the readiness warn.**
[`audit.mjs`](../.claude/skills/production-readiness/scripts/audit.mjs) calls
`record("Gallery / persona coverage", "WARN", …)` unconditionally — there is no
branch and no condition. It is a permanent manual reminder, so
`6 pass · 1 warn · 0 fail` is the audit's ceiling and a clean run looks exactly
like a neglected one. Do this work because an empty `/gallery` is a bad first
impression, not to turn a line green.

## The two gallery paths are different, and only one is cross-browser

| Function | Source | Scope |
|---|---|---|
| `getGallery()` | `localStorage` only | **The current browser only.** Never touches Supabase. |
| `getCuratedGallery()` | Supabase `public_reports` | Everyone. This is the one curation drives. |

The plain "recently shared" feed has always been local-only. Seeding
`localStorage` makes a demo look populated on one machine; it does **not**
populate the gallery for real visitors. Only step 3 below does that.

## 1. Apply migration 0025 to the live project

`0025_gallery_curation.sql` adds `persona`, `curated`, `reviewed_at` and
`reviewed_by` to `public_reports`, plus a CHECK constraint on `persona` and a
partial index on `(curated, persona)`. It is additive — `is_public` is not
touched, so nothing that works today changes.

```bash
PROD_SUPABASE_DB_URL='...' npm run migrate:prod -- --dry-run
```

The dry run connects, prints `current_database`, and aborts without writing —
do it first and read the database name. Note `migrate:prod` has **no stop-at-N
flag**: a bare run applies `0001`→`0025`. That is fine on a scratch project and
wrong on one with real users; use the subset one-liner in
[DB-MIGRATION-RUNBOOK.md](DB-MIGRATION-RUNBOOK.md) §4 to apply only `0025`.

Verify:

```sql
select column_name from information_schema.columns
 where table_name = 'public_reports'
   and column_name in ('persona','curated','reviewed_at','reviewed_by');
```

Four rows expected.

## 2. Make sure there is something to curate

Curation is metadata layered on existing rows — it cannot invent reports.

```sql
select count(*) from public_reports where is_public = true;
```

If that is 0, create real ones: run an extraction, open `/preview`, click
**Share**. Each share writes a `public_reports` row reachable at `/p/:slug`.

**Do not use `scripts/seed-public-gallery.mjs` for this.** Despite the name it
writes to `localStorage`, not Supabase — it is a demo/first-visit aid and a
release-checklist printer. `node scripts/seed-public-gallery.mjs --print` lists
the 7 intended samples (URL, persona, intent, title) and touches nothing; use
that as the shopping list of what to go and create for real.

## 3. Tag one report per persona

`/admin/gallery` (admin PIN required). For each report the page renders its
**actual content** via `PublicReportArticle` — the same component `/p/:slug`
uses, so the admin preview and the public page cannot drift. Read it, then tag
a persona. That review step is the entire reason the endpoint exists instead of
letting the client set `curated` directly.

The seven persona ids, which must match `personaConfig.js`, the
`VALID_PERSONAS` set in `admin-gallery.js`, and the CHECK constraint in `0025`
— **update all three together if you ever add one**:

`sales` · `competitive-intel` · `seo` · `market-research` · `recruiter` ·
`founder-vc` · `agency`

The endpoint is `POST /api/admin-gallery { action: "curate", id, persona }`,
which sets `curated = true` and stamps `reviewed_at` / `reviewed_by`.
`{ action: "uncurate", id }` reverses it. An unknown persona is rejected 400.

## 4. Confirm

```sql
select persona, count(*) from public_reports
 where curated = true group by persona order by persona;
```

Seven rows, each ≥ 1. Then load `/gallery` in a **fresh browser profile** (not
the one you curated in — otherwise `getGallery()`'s localStorage feed masks
whether `getCuratedGallery()` actually returned anything) and check the persona
filter row returns results for every persona.

## Where this can silently do nothing

- **Wrong project.** Staging and production are separate Supabase projects
  (`aubwooslkkrprdxuiyvj` vs `sikkfxysjhirmtwkumpt`). Curating on staging does
  not populate production's gallery.
- **Migration not applied.** The curate call PATCHes columns that do not exist;
  PostgREST 400s and the row is left untouched.
- **Seeder mistaken for the real thing.** See step 2.
