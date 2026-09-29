# GCP + Docker Migration — Plan of Record (v2)

**Status: Phase 1a EXECUTED END-TO-END, ALL GREEN (2026-09-29); GCP staging live at https://datiq-vsp-fhs-stg.web.app (smoke 13/13, Cloud SQL migrated, 13 scheduler jobs). Local Docker Desktop stack + Studio (ports 8080/54328) fully functional.**
**Date: 2026-09-29 · Branch: `docker-desktop-build`**

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
| [08-STAGING-DEPLOY-RUNBOOK.md](08-STAGING-DEPLOY-RUNBOOK.md) | As-built staging deploy record (Phase 1a executed) + operator checklist for production |
| [09-CUTOVER-RUNBOOK.md](09-CUTOVER-RUNBOOK.md) | Step-by-step production cutover checklist (pre-cutover rehearsal, maintenance window, DNS flip, instant rollback) |

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

---

## 8. Domain Mapping: Staging vs Production Details

This section specifies the domain mapping architecture, DNS configuration, and routing parity rules across environments.

### 8.1 Architecture Overview

DatIQ uses a decoupled edge-and-microservices topology where Firebase Hosting acts as the high-performance global CDN edge, routing API calls and server-side surfaces directly to Cloud Run microservices via internal edge rewrites:

```
[ Browser / Client ]
         │
         ▼
[ Firebase Hosting Edge (Global CDN) ]
    ├── Static Assets (SPA Shell, Prerendered HTML, Icons)
    ├── /api/**         ──rewrite──► Cloud Run: api service
    ├── /admin/**       ──rewrite──► Cloud Run: admin service
    ├── /__trackers/**  ──rewrite──► Cloud Run: trackers service
    └── (cloud-sql mode):
         ├── /auth/v1/** ──rewrite──► Cloud Run: auth service (GoTrue)
         └── /rest/v1/** ──rewrite──► Cloud Run: rest service (PostgREST)
```

### 8.2 Staging vs. Production Domain Mapping Matrix

| Aspect | Staging Environment | Production Environment |
|---|---|---|
| **Hosting Target** | `datiq-vsp-fhs-stg` | `datiq-vsp-fhs-prod` |
| **Primary Domain** | `https://datiq-vsp-fhs-stg.web.app` | `https://datiq.app` (apex) |
| **Secondary / WWW Domain** | `https://datiq-vsp-fhs-stg.firebaseapp.com` | `https://www.datiq.app` (redirects/serves apex) |
| **Pre-Cutover Shadow Domain** | N/A (Direct Staging) | `https://datiq-vsp-fhs-prod.web.app` |
| **API / Auth Domain** | `https://datiq-vsp-fhs-stg.web.app/api` | `https://datiq.app/api` (and `https://api.datiq.app`) |
| **Database Connection** | Hosted Supabase Dev (`aubwooslkkrprdxuiyvj`) during parallel run; Cloud SQL rehearsal | Hosted Supabase Prod (`sikkfxysjhirmtwkumpt`) during parallel run; Cloud SQL prod post-cutover |
| **SSL Management** | Google-managed automatic SSL on `*.web.app` | Google-managed automatic SSL on custom apex and subdomains |
| **Crons & Schedulers** | 13 Cloud Scheduler jobs (`OPS_JOBS_DISABLED=1`; Netlify staging owns crons) | 13 Cloud Scheduler jobs (`OPS_JOBS_DISABLED=1` during shadow; Netlify prod owns crons until cutover) |

### 8.3 DNS Configuration & Custom Domain Setup (Production Cutover)

During production cutover, DNS records are configured in your DNS provider (Cloudflare, Route53, Namecheap, etc.) pointing to Firebase Hosting:

1. **Apex Domain (`datiq.app`)**:
   - `Type: A` → Firebase Hosting IP addresses provided by GCP Console (e.g. `199.36.158.100`)
   - Or `ALIAS / ANAME` to Firebase Hosting target if supported by provider.
2. **Subdomain (`www.datiq.app`)**:
   - `Type: CNAME` → `datiq-vsp-fhs-prod.web.app` (or configure apex redirect in Firebase console).
3. **API / OAuth Subdomain (`api.datiq.app`)**:
   - `Type: CNAME` → `datiq-vsp-fhs-prod.web.app`
   - Keeps backward compatibility for Chrome Extension and OAuth redirect URIs.

### 8.4 Routing Parity & Edge Behavior Rules

To guarantee strict parity between Netlify and GCP edge behavior:
- **Canonical Trailing Slash Policy**: `trailingSlash: false` configured in `firebase.json`. Requests to `/pricing/` receive an HTTP `301 Moved Permanently` to `/pricing`.
- **Prerendered Landing Pages**: Prerendered static pages (`/`, `/pricing`, `/help`, etc.) are served directly from Firebase CDN cache with zero function latency.
- **SPA Fallback**: Unknown non-file routes fall back to `/__shell/index.html` allowing client-side React Router navigation.
- **Security Headers**: Edge sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, and `HSTS`.

### 8.5 Internal & Private Services Access: Supabase Studio

Supabase Studio (`datiq-vsp-run-studio-stg` and `datiq-vsp-run-studio-prod`) runs on Cloud Run as a private service connected to Cloud SQL via unix domain sockets (`/cloudsql/...`):
- **Access Control**: Deployed with `--no-allow-unauthenticated`. Never exposed publicly on the internet.
- **Workstation Proxy**: Operators securely access Studio from localhost via IAM authentication:
  ```bash
  # Proxy staging Studio to local port (default 54328):
  ./deployment/scripts/gcp/proxy-studio.sh staging

  # Proxy prod Studio to local port:
  ./deployment/scripts/gcp/proxy-studio.sh prod
  ```
- **Browser Access**: Open `http://localhost:54328` in your browser. The connection routes over an authenticated Google IAM tunnel directly to Cloud SQL with zero exposure to third parties.

### 8.6 DNS Cutover & Instant Rollback Strategy

- **Cutover Step**: Lower TTL to 300s (5 min) 24 hours prior. Update DNS A/CNAME records to point to Firebase Hosting.
- **Verification**: Run `deployment/scripts/gcp/smoke.sh prod` against `https://datiq.app`.
- **Instant Rollback**: If unexpected behavior is detected, revert DNS A/CNAME records back to Netlify's load balancer (`datiqapp.netlify.app`). Netlify stays live and active during the entire cutover window.
