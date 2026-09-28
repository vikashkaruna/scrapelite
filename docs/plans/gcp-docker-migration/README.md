# GCP + Docker Migration — Plan of Record (v2)

**Status: DRAFT — awaiting owner confirmation. Nothing has been implemented.**
**Date: 2026-09-28 · Branch: `docker-desktop-build` (currently byte-identical to `staging`)**

This folder supersedes the earlier two-phase draft (`DatIQ - Docker and GCP/DatIQ - Local Docker and GCP Migration.md`)
and improves on the repo's own `FIREBASE-MIGRATION.md` draft (2026-07-18). It is grounded in a full
re-audit of the codebase as it stands today (the root `AGENTS.md` is severely stale — it still describes the
2026-06 v2.0 SPA; the real codebase now has 75 Netlify functions, 13 cron jobs, ~126 DB tables and a
PIN-gated admin surface).

| Doc | Contents |
|---|---|
| [01-CODEBASE-ANALYSIS.md](01-CODEBASE-ANALYSIS.md) | What the codebase actually is today: refreshed folder structure, deployable surfaces, backend/data/config/edge inventory, portability scorecard |
| [02-IMPACT-ASSESSMENT.md](02-IMPACT-ASSESSMENT.md) | How much code changes, in which files, whether a compat release must ship to Netlify first, the parallel-run (two URLs) model, the DB/users/domain cutover sequence, external-URL checklist, effort estimates |
| [03-BRD.md](03-BRD.md) | Updated business requirements |
| [04-PRD.md](04-PRD.md) | Updated product requirements — one Dockerfile per deployable unit (web / admin / trackers / api / jobs / auth / rest / db / migrator / gateway) |
| [05-IMPLEMENTATION-PLAN.md](05-IMPLEMENTATION-PLAN.md) | Two-phase plan: Phase 0 = local Docker Desktop run & test; Phase 1 = GCP deploy → parallel run → migrate DB, users, domain. Checklists, compose profiles, scheduler mapping, cutover runbook |
| [06-NAMING-AND-ENV-CONVENTIONS.md](06-NAMING-AND-ENV-CONVENTIONS.md) | Naming convention (`datiq-<project-code>-<type>-<name>`), default resource map for project `vikash-saas-project` / region `asia-south1`, the `.env.{local,staging,prod}.example` contract, loader + Terraform parameterisation rules, grep gate |
| [07-FAST-TRACK-OPTION.md](07-FAST-TRACK-OPTION.md) | Compressed 6–8 day track for the "no real users" scenario — **keeps the local Docker Desktop deployment (Phase 0)** as the dress rehearsal (same images feed GCP), skips shadow/soak and the DB migration (deferred), keeps the irreducible parts (adapter, routing parity, crons, cutover checklist incl. the `api.datiq.app` auth-domain caveat); a 3–4 day no-local variant is noted |

## Key answers (short version)

1. **Code impact is small.** ~6 app files, well under 150 changed lines. Everything else is additive
   `deployment/` assets. The backend uses no Netlify SDK, no Netlify Identity/Blobs/Edge functions.
2. **Yes — Netlify and GCP can run in parallel on different URLs for days/weeks.** The frontend is fully
   same-origin relative (`/api/*`), and Supabase URL/key are env-driven, so the same build runs anywhere.
   Recommended: GCP stack points at the **existing hosted Supabase** during the parallel window, so there is
   exactly one source of data and zero user migration until cutover day.
3. **Yes — a small "compat release" to Netlify first is the right option** (hardcoded `/.netlify/functions`
   paths → `/api`, GCP host entries in `runtime-config.js`). It is behaviour-neutral on Netlify and means both
   platforms run identical code from that point on.
4. **DB, users, domain migrate last, in one cutover window.** Self-hosted GoTrue uses the *same* `auth`
   schema as hosted Supabase, so users (incl. password hashes and OAuth identities) migrate via a plain
   `pg_dump`/restore into Cloud SQL. Netlify stays live as instant rollback during the window.
5. **Everything deploy-side is named and parameterised by convention (doc 06).** Resources follow
   `datiq-<project-code>-<type-abbrev>-<name>[-stg|-prod]` with defaults for project `vikash-saas-project`,
   region `asia-south1` (Mumbai), and the matching Firebase web apps in that same project. Operators edit
   only `.env.local` / `.env.staging` / `.env.prod` (from shipped `.example` files with sample values +
   notes); every script, compose file, Cloud Build YAML and Terraform variable reads from them — zero
   hard-coded values, enforced by a grep gate.
