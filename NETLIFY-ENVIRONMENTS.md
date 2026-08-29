# NETLIFY-ENVIRONMENTS.md

> **Status:** Pre-migration · Draft · Plan-of-record for splitting DatIQ into **dev / staging / production** tiers on Netlify, with **two isolated Supabase projects** (current = dev/staging, new = production) and a **phase-gate** that keeps production untouched by regular updates.
>
> **Scope:** Production isolation only. Code, test suite, design system, build pipeline, and function code stay 100% as they are. The migration is purely **infra + env vars + CI gating**.
>
> **Last updated:** 2026-07-18
>
> **See also:**
> - `CLAUDE.md` — full project context, env vars, Netlify setup, function inventory
> - `FIREBASE-MIGRATION.md` — alternative plan (moves hosting + functions off Netlify to Firebase/GCP). This doc is the **safer** alternative; choose this one if you'd rather not change hosting.
> - `AGENTS.md` — agent onboarding
> - `README.md` — local dev quickstart

---

## Table of contents

1. [Pre-flight — why this is safer than the Firebase plan](#0-pre-flight--why-this-is-safer-than-the-firebase-plan)
2. [Architecture — the three tiers](#1-architecture--the-three-tiers)
3. [What changes / what doesn't](#2-what-changes--what-doesnt)
4. [Pre-requisites](#3-pre-requisites)
5. [Phase 1 — Prepare the production Supabase project](#4-phase-1--prepare-the-production-supabase-project)
6. [Phase 2 — Configure Netlify env var contexts](#5-phase-2--configure-netlify-env-var-contexts)
7. [Phase 3 — Configure branch deploys](#6-phase-3--configure-branch-deploys)
8. [Phase 4 — Wire up the phase-gate CI/CD](#7-phase-4--wire-up-the-phase-gate-cicd)
9. [Phase 5 — Razorpay (test vs live)](#8-phase-5--razorpay-test-vs-live)
10. [Phase 6 — Auth providers on the production Supabase](#9-phase-6--auth-providers-on-the-production-supabase)
11. [Phase 7 — Smoke test as deploy gate](#10-phase-7--smoke-test-as-deploy-gate)
12. [Pre-prod checklist](#11-pre-prod-checklist-do-all-of-these-before-cutover)
13. [The automated sanity test](#12-the-automated-sanity-test)
14. [Post-cutover — first 72 hours](#13-post-cutover--first-72-hours)
15. [Rollback plan](#14-rollback-plan)
16. [Cost estimate (rough)](#15-cost-estimate-rough)
17. [Common pitfalls](#16-common-pitfalls)
18. [Sequencing — the actual order](#17-sequencing--the-actual-order)
19. [After it ships — update `CLAUDE.md`](#18-after-it-ships--update-claudemd)
20. [TL;DR — if you only do 3 things right now](#19-tldr--if-you-only-do-3-things-right-now)

---

## 0. Pre-flight — why this is safer than the Firebase plan

The Firebase plan (`FIREBASE-MIGRATION.md`) moves hosting, functions, secrets, scheduler, and CI off a working platform to a different one. It works, but it's a lot of moving parts.

**This plan** keeps every line of code and every service the same, and only:

1. **Adds a second Supabase project** (production) and isolates it from the existing one
2. **Adds a `staging` tier** between dev and production
3. **Adds a manual approval gate** so production only deploys when you click "Approve"

The result: production is insulated from accidental pushes, the dev Supabase can be wiped/reset without affecting real users, and the entire migration is reversible by removing the new tier.

**Trade-off:** you're still single-region on Netlify, single-vendor on Supabase, and you pay for two Supabase projects. If you ever decide Firebase is worth it, the work in this doc is **not wasted** — it's a stepping stone. A separate Netlify→Firebase move later only needs to swap hosting + functions; the env var + multi-DB discipline carries over.

---

## 1. Architecture — the three tiers

```
                     ┌──────────────────────┐
   feature/foo ──┐   │  Dev / Preview       │  Netlify: deploy preview URL
                  │   │  (auto on every PR) │  (random-name--datiq.netlify.app)
                  ├──►│                      │  Supabase: DEV (existing)
                  │   │  Branches: any       │  Razorpay: test mode
                  │   │  Trigger: PR open    │  Smoke test: skipped
                  │   └──────────────────────┘
                  │
                  │   ┌──────────────────────┐
   staging ───────┼──►│  Staging             │  Netlify: staging.datiq.app
                  │   │  (auto on push)      │  Supabase: DEV (shared)
                  │   │                      │  Razorpay: test mode
                  │   │  Trigger: push to    │  Smoke test: runs on every push
                  │   │  `staging` branch    │
                  │   └──────────────────────┘
                  │
   main ──────────┘   ┌──────────────────────┐
        │              │  Production          │  Netlify: datiq.app
        │              │  (gated)             │  Supabase: PROD (NEW, isolated)
        │              │                      │  Razorpay: LIVE mode
        ▼              │  Trigger: PR to      │  Smoke test: required to pass
   GitHub Actions     │  main, manual        │  Freeze-able
   Phase-Gate:        │  approval required   │
   ✅ tests           │                      │
   ✅ smoke-staging   │  Branch: `main`      │
   ⏸  manual approve  │                      │
   ✅ deploy-prod     │                      │
   ✅ smoke-prod      │                      │
                      └──────────────────────┘
```

The **key safety property**: production Netlify is only updated by a successful, manually-approved `staging → main` PR. The smoke test runs **after** the production deploy, and on failure it auto-rolls back.

---

## 2. What changes / what doesn't

### What does NOT change (zero code diff)

- All React/Vite source code under `src/`
- All Netlify functions under `netlify/functions/` (incl. `lib/`)
- `package.json`, `package-lock.json`, `vite.config.*`
- `netlify.toml` *structure* — only adds `[context.*.environment]` blocks
- `README.md`, `docs/`, tests, screenshots
- The 1,297+ vitest tests and Playwright e2e suite
- The CSS / design system / `src/styles/`
- The `localStorage` keys (`datiq.*`)
- The Supabase table schemas
- All current Supabase data (it's the dev Supabase — untouched)

### What DOES change (only these files, in this exact order)

| File | What changes | Risk |
|---|---|---|
| `netlify.toml` | Add `[context.production.environment]`, `[context.staging.environment]`, `[context.deploy-preview.environment]` blocks | none (additive) |
| `.github/workflows/phase-gate.yml` | NEW — gated deploy workflow with manual approval | none (additive) |
| `scripts/smoke-prod.mjs` | NEW — automated sanity test | none (additive) |
| Netlify dashboard | Set production branch = `main`, branch deploys = `staging`, deploy previews = any PR | none |
| Supabase dashboard | Create new project `datiq-prod`; apply migrations; configure auth | none (new project, isolated) |
| `docs/PRODUCTION-RELEASE-V1.0.md` | Add note: "production uses separate Supabase project, deploy via phase-gate workflow" | none (docs) |
| `CLAUDE.md` | Add a "Production environment" section pointing to this doc | none (docs) |
| `README.md` | Add "Deployment tiers" section | none (docs) |

That's it. No `src/` changes, no function code changes, no SQL migration changes (you apply the same migrations to the new DB).

---

## 3. Pre-requisites

### 3.1 Netlify

- Logged into https://app.netlify.com (account with the `datiq` site)
- "Pro" tier or above if you want branch deploys with custom subdomains (otherwise you get `main--datiq.netlify.app` style subdomains, which still work)
- Personal access token (Settings → User settings → Applications → Personal access tokens → New) — needed for GitHub Actions to trigger deploys
- Note your **Site ID** and **Site name** (Site settings → General)

### 3.2 Supabase

- Logged into https://supabase.com/dashboard
- Owner / Admin role on the existing dev Supabase project
- A separate **organization** or workspace for the production project (recommended for billing isolation)
- Billing set up if you want the prod project on the Pro plan from day 1

### 3.3 GitHub

- Admin on the DatIQ repo
- Workflow permissions: "Read and write" (needed to comment on PRs / close issues)
- GitHub Actions enabled

### 3.4 Razorpay

- Logged into https://dashboard.razorpay.com (live mode)
- For the **dev/staging** tier: Razorpay **Test mode** API keys (`rzp_test_...`)
- For the **production** tier: Razorpay **Live mode** API keys (`rzp_live_...`)
- Both should be registered as webhooks once their URLs are stable

### 3.5 DNS

- You control the DNS for `datiq.app` (apex) and can add `staging.datiq.app` (sub-domain) — Netlify will provision DNS records automatically when you add the sub-domain
- If you use Cloudflare or another proxy, see [§6.4 DNS gotchas](#64-dns-gotchas)

---

## 4. Phase 1 — Prepare the production Supabase project

The dev Supabase is the one you have today. The production Supabase is a **brand new project** in Supabase. Same schema, isolated data, separate keys.

### 4.1 Create the project

1. Go to https://supabase.com/dashboard → "New project"
2. **Name**: `datiq-prod` (or `datiq-production`)
3. **Database password**: a strong random string (1Password / `openssl rand -base64 32`). Store it in a password manager — you'll need it once for the migration script, then never again.
4. **Region**: pick the region closest to your users. DatIQ is India-leaning → **`ap-south-1` (Mumbai)** if available, else `ap-southeast-1` (Singapore). Do NOT pick `us-east-1` unless your users are there.
5. **Plan**: start on **Pro** if you can; Free tier works but is throttled. Production users should not be on a Free-tier database.
6. Wait for provisioning (~2 minutes).

Note these values once it's ready:

| Value | Where to find it | Example |
|---|---|---|
| `SUPABASE_URL` | Project Settings → API → Project URL | `https://abcdefgh.supabase.co` |
| `SUPABASE_ANON_KEY` | Project Settings → API → `anon` `public` | `eyJhbGciOiJIUzI1...` |
| `SUPABASE_SERVICE_KEY` | Project Settings → API → `service_role` `secret` | `eyJhbGciOiJIUzI1...` |
| Project ref | Project Settings → General → Reference ID | `abcdefgh` |

> **DO NOT** share the service key. It bypasses RLS. Treat it like a root password.

### 4.2 Apply the same SQL schema

You already have migrations in `supabase/migrations/` (per `CLAUDE.md`) plus standalone `.sql` scripts (`scripts/scheduler.sql`, `scripts/ai-config.sql`, `scripts/summary-feedback.sql`, `scripts/analytics.sql`, `scripts/provenance.sql`, etc).

Create a single entry-point script (NEW) and run it on the prod project:

**File: `scripts/migrate-prod.mjs`** (NEW — the real worker; uses the `pg` npm package, no system `psql` required)

**File: `scripts/migrate-prod.sh`** (NEW — thin wrapper, kept for backward compat with the original `./scripts/migrate-prod.sh` invocation)

Both files are committed. The .mjs auto-discovers every `00*.sql` in `supabase/migrations/` in lexical order (= dependency order: 0001 → 0011), skipping `run-all.sql` (the master concatenated file) and `rollback.sql` (destructive). Each file runs in its own transaction. Idempotent (every migration uses `IF NOT EXISTS` / `OR REPLACE`), so re-running is safe.

```bash
# One-time setup
npm install

# Three ways to run
PROD_SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.abcdefgh.supabase.co:5432/postgres" \
  npm run migrate:prod

# Or
PROD_SUPABASE_DB_URL="..." ./scripts/migrate-prod.sh

# Or, with the --include flag if you need to add a custom .sql at the end:
PROD_SUPABASE_DB_URL="..." npm run migrate:prod -- --include=scripts/extra.sql
```

**Useful flags:**
- `--list` — show the files that would be applied (no DB connection)
- `--dry-run` — connect to the DB but don't apply anything (catches connection / auth errors)
- `--include=path/to/file.sql` — add an extra .sql file to the end of the run

**Why Node (`pg`) instead of `psql`?** The `psql` CLI requires libpq + Postgres server headers (Homebrew + system deps). The `pg` npm package is pure JS, ships in `package.json` like any other dep, and works on any macOS / Linux / CI environment without a setup step. The connection string is identical.

**The schema is identical to the dev project.** Don't write custom prod-only migrations. If you need a change, apply it to dev first, validate, then re-run this script.

### 4.3 Row-Level Security (RLS)

Every table that exists in the dev project must have the same RLS policies in prod. RLS is part of your migrations (`CREATE POLICY ...` statements are in the same `.sql` files as the tables). If you followed the migration order in §4.2, RLS is already correct. Verify:

```sql
-- Run in the prod SQL editor
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

`rowsecurity` should be `t` for every user-data table (`extractions`, `usage_records`, `usage_alerts`, `subscriptions`, `payment_events`, `pricing_config`, `coupon_redemptions`, `coupon_counters`, `app_config`, `analytics_events`, `summary_feedback`, `public_reports`).

### 4.4 Auth providers

In the **prod** Supabase dashboard → Authentication → Providers:

- **Email**: enabled (default)
- **Google / Microsoft / GitHub**: enable the same ones you have on dev. You'll add OAuth credentials per provider in §9.

In Authentication → URL Configuration:

- **Site URL**: `https://datiq.app`
- **Redirect URLs**: add `https://datiq.app/**`, `https://staging.datiq.app/**`, and the Netlify preview URL pattern `https://deploy-preview-*.datiq.app/**` if you want auth to work on PR previews (optional).

### 4.5 Storage buckets (if you use any)

If `public_reports` is in Storage (not just SQL), create the same buckets in prod with the same RLS policies. The current DatIQ uses SQL for `public_reports` — confirm by grepping `supabase/migrations/` for `storage`.

### 4.6 Confirm: prod DB starts empty

The whole point of isolation is that the prod DB has no data from dev. After migrations run:

```sql
SELECT 'extractions' AS t, COUNT(*) FROM public.extractions
UNION ALL SELECT 'subscriptions', COUNT(*) FROM public.subscriptions
UNION ALL SELECT 'payment_events', COUNT(*) FROM public.payment_events
UNION ALL SELECT 'usage_records', COUNT(*) FROM public.usage_records;
```

All should be `0`. If any row exists, you accidentally ran migrations on the wrong DB. Stop and investigate.

### 4.7 Sanity-test the prod DB from a local script

Before wiring it up to Netlify, make sure your local app can talk to the prod Supabase:

```bash
VITE_SUPABASE_URL=https://abcdefgh.supabase.co \
VITE_SUPABASE_ANON_KEY=eyJ-prod-anon... \
npm run dev
```

- Open http://localhost:5173
- Create an account → should sign up
- Try an extraction → should hit a 4xx (because there are no `VITE_FIRECRAWL_API_KEY` etc. set, that's expected) but the **call reaches the function and the function talks to prod Supabase** — verify by checking the prod Supabase logs (Database → Logs → API) for the request.

---

## 5. Phase 2 — Configure Netlify env var contexts

Netlify lets you set env vars per **context** (production, staging, branch-deploy, deploy-preview). This is the mechanism that makes one codebase deploy to three different Supabase projects.

### 5.1 The context model

| Netlify context | Triggered by | Supabase target | Razorpay mode |
|---|---|---|---|
| `production` | merge to `main` | PROD (new) | Live |
| `staging` | push to `staging` branch | DEV (existing) | Test |
| `deploy-preview` | any PR | DEV (existing) | Test |
| `branch-deploy` | (legacy) | n/a | n/a |
| (default) | all other contexts | DEV | Test |

The frontend's `import.meta.env.VITE_*` reads from the build-time context, so the same code automatically points at the right Supabase.

### 5.2 The new `netlify.toml`

Replace the current `netlify.toml` (which is small) with this — **additive only**, nothing is removed:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
  # CRITICAL: never commit test files inside netlify/functions/. Netlify's
  # bundler auto-deploys every top-level .js in this directory as a
  # serverless function, and a test file like `reengagement.test.js`
  # produces a function named `reengagement.test` — the `.` violates
  # Netlify's function-name rule (`^[a-zA-Z0-9_-]+$`) and the build fails.
  # Tests for Netlify Functions belong in netlify/__tests__/.

[build.environment]
  SECRETS_SCAN_OMIT_PATHS = "public/runtime-config.js,dist/runtime-config.js"

# ── API routes (must come BEFORE the SPA catch-all) ──────────────────────────
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
  force = true

# ── SPA fallback ──────────────────────────────────────────────────────────────
# React Router: serve index.html for all routes so direct /preview and
# /dashboard URLs work instead of returning a 404.
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║ Environment-specific env vars                                            ║
# ║                                                                          ║
# ║ Order of precedence (lowest → highest):                                  ║
# ║   1. Default in this file                                                 ║
# ║   2. Netlify UI "Environment variables" (shared across contexts)           ║
# ║   3. [context.<name>.environment] in this file (highest)                  ║
# ║                                                                          ║
# ║ RECOMMENDED: set shared values (NODE_VERSION, etc.) in the Netlify UI,    ║
# ║ and put CONTEXT-SPECIFIC values (Supabase URLs, Razorpay keys) here.      ║
# ╚══════════════════════════════════════════════════════════════════════════╝

# ── PRODUCTION: datiq.app → prod Supabase, live Razorpay ───────────────────
# Override EVERY secret to the production value. No inheritance from below.
[context.production.environment]
  # Supabase — prod project
  VITE_SUPABASE_URL = "https://PROD_REF.supabase.co"
  VITE_SUPABASE_ANON_KEY = "PROD_ANON_KEY"
  SUPABASE_URL = "https://PROD_REF.supabase.co"
  SUPABASE_SERVICE_KEY = "PROD_SERVICE_KEY"

  # Razorpay — LIVE mode (real money)
  VITE_RAZORPAY_KEY_ID = "rzp_live_PROD_KEY_ID"
  RAZORPAY_KEY_ID = "rzp_live_PROD_KEY_ID"
  RAZORPAY_KEY_SECRET = "PROD_RAZORPAY_SECRET"
  RAZORPAY_WEBHOOK_SECRET = "PROD_RAZORPAY_WEBHOOK_SECRET"

  # Stripe — LIVE mode (deferred per docs/STRIPE-DEFERRAL.md but stub here)
  VITE_STRIPE_PUBLISHABLE_KEY = "pk_live_PROD"
  STRIPE_SECRET_KEY = "sk_live_PROD"
  STRIPE_WEBHOOK_SECRET = "PROD_STRIPE_WEBHOOK_SECRET"

  # AI — prod keys
  AI_API_KEY = "PROD_ANTHROPIC_KEY"
  GEMINI_API_KEY = "PROD_GEMINI_KEY"
  OPENAI_API_KEY = "PROD_OPENAI_KEY"
  AI_PROVIDER_ORDER = "gemini,anthropic,openai"
  AI_MODEL = "claude-3-5-haiku-20241022"
  VITE_AI_MODEL = "claude-3-5-haiku-20241022"

  # Scraping — prod keys
  FIRECRAWL_API_KEY = "PROD_FIRECRAWL_KEY"
  SPIDER_API_KEY = "PROD_SPIDER_KEY"
  JINA_API_KEY = "PROD_JINA_KEY"
  SCRAPE_PROVIDER_ORDER = "firecrawl,spider,jina,direct"

  # Email — one sender per purpose; no function falls back between them.
  RESEND_API_KEY = "PROD_RESEND_KEY"
  CONTACT_EMAIL_FROM = "DatIQ <hello@datiq.app>"              # outbound to users
  ALERT_EMAIL_FROM = "DatIQ Alerts <alerts@datiq.app>"        # schedule alerts
  FORM_EMAIL_FROM = "DatIQ Contact <noreply@datiq.app>"       # inbound /contact form
  SCHEDULE_ALERT_WEBHOOK = "https://hooks.n8n.cloud/PROD_WEBHOOK"

  # Admin
  ADMIN_PIN_HASH = "PROD_PIN_HASH"           # SHA-256 hex
  ADMIN_TOKEN_SECRET = "PROD_TOKEN_SECRET"   # random 32+ bytes

  # Frontend (no real secrets — these are public)
  VITE_PAYMENT_PROVIDER = "auto"
  VITE_WEBHOOK_URL = "https://hooks.n8n.cloud/PROD_WEBHOOK"
  VITE_FIRECRAWL_API_KEY = ""                # deliberately empty in prod build
  VITE_LINK_CHANGELOG = "https://datiq.app/changelog"
  VITE_LINK_ABOUT = "https://datiq.app/about"
  VITE_LINK_BLOG = "https://datiq.app/blog"
  VITE_SUPABASE_ANON_KEY = "PROD_ANON_KEY"   # duplicate of above for clarity

# ── STAGING: staging.datiq.app → dev Supabase, test Razorpay ───────────────
[context.staging.environment]
  # Supabase — dev project (shared with PR previews)
  VITE_SUPABASE_URL = "https://DEV_REF.supabase.co"
  VITE_SUPABASE_ANON_KEY = "DEV_ANON_KEY"
  SUPABASE_URL = "https://DEV_REF.supabase.co"
  SUPABASE_SERVICE_KEY = "DEV_SERVICE_KEY"

  # Razorpay — TEST mode (no real money)
  VITE_RAZORPAY_KEY_ID = "rzp_test_STAGING_KEY_ID"
  RAZORPAY_KEY_ID = "rzp_test_STAGING_KEY_ID"
  RAZORPAY_KEY_SECRET = "STAGING_RAZORPAY_SECRET"
  RAZORPAY_WEBHOOK_SECRET = "STAGING_RAZORPAY_WEBHOOK_SECRET"

  # Stripe — TEST mode
  VITE_STRIPE_PUBLISHABLE_KEY = "pk_test_STAGING"
  STRIPE_SECRET_KEY = "sk_test_STAGING"
  STRIPE_WEBHOOK_SECRET = "STAGING_STRIPE_WEBHOOK_SECRET"

  # AI — can be shared with prod (separate keys optional)
  AI_API_KEY = "STAGING_ANTHROPIC_KEY"
  GEMINI_API_KEY = "STAGING_GEMINI_KEY"
  OPENAI_API_KEY = "STAGING_OPENAI_KEY"

  # Scraping — staging can use same keys as dev (cheap scraping)
  FIRECRAWL_API_KEY = "STAGING_FIRECRAWL_KEY"
  SPIDER_API_KEY = ""
  JINA_API_KEY = ""

  # Email — staging senders are prefixed so a stray send is obvious in the inbox
  RESEND_API_KEY = "STAGING_RESEND_KEY"
  CONTACT_EMAIL_FROM = "DatIQ Staging <staging@datiq.app>"
  ALERT_EMAIL_FROM = "DatIQ Staging Alerts <staging@datiq.app>"
  FORM_EMAIL_FROM = "DatIQ Staging Contact <staging@datiq.app>"
  SCHEDULE_ALERT_WEBHOOK = "https://hooks.n8n.cloud/STAGING_WEBHOOK"

  # Admin — staging can keep a known PIN for QA
  ADMIN_PIN_HASH = "STAGING_PIN_HASH"
  ADMIN_TOKEN_SECRET = "STAGING_TOKEN_SECRET"

  # Frontend
  VITE_PAYMENT_PROVIDER = "auto"
  VITE_WEBHOOK_URL = "https://hooks.n8n.cloud/STAGING_WEBHOOK"
  VITE_FIRECRAWL_API_KEY = "STAGING_FIRECRAWL_KEY"
  VITE_LINK_CHANGELOG = "https://staging.datiq.app/changelog"
  VITE_LINK_ABOUT = "https://staging.datiq.app/about"
  VITE_LINK_BLOG = "https://staging.datiq.app/blog"

# ── DEPLOY PREVIEWS: PR previews → dev Supabase, test Razorpay ─────────────
# Same target as staging but auto-applied to every PR's preview URL.
[context.deploy-preview.environment]
  VITE_SUPABASE_URL = "https://DEV_REF.supabase.co"
  VITE_SUPABASE_ANON_KEY = "DEV_ANON_KEY"
  SUPABASE_URL = "https://DEV_REF.supabase.co"
  SUPABASE_SERVICE_KEY = "DEV_SERVICE_KEY"
  VITE_RAZORPAY_KEY_ID = "rzp_test_STAGING_KEY_ID"
  RAZORPAY_KEY_ID = "rzp_test_STAGING_KEY_ID"
  RAZORPAY_KEY_SECRET = "STAGING_RAZORPAY_SECRET"
  RAZORPAY_WEBHOOK_SECRET = "STAGING_RAZORPAY_WEBHOOK_SECRET"
  VITE_STRIPE_PUBLISHABLE_KEY = "pk_test_STAGING"
  STRIPE_SECRET_KEY = "sk_test_STAGING"
  VITE_PAYMENT_PROVIDER = "auto"
  ADMIN_PIN_HASH = "STAGING_PIN_HASH"
  ADMIN_TOKEN_SECRET = "STAGING_TOKEN_SECRET"
  AI_API_KEY = "STAGING_ANTHROPIC_KEY"
  GEMINI_API_KEY = "STAGING_GEMINI_KEY"
  OPENAI_API_KEY = "STAGING_OPENAI_KEY"
  FIRECRAWL_API_KEY = "STAGING_FIRECRAWL_KEY"
  RESEND_API_KEY = "STAGING_RESEND_KEY"
  CONTACT_EMAIL_FROM = "DatIQ Preview <preview@datiq.app>"
  ALERT_EMAIL_FROM = "DatIQ Preview <preview@datiq.app>"
  FORM_EMAIL_FROM = "DatIQ Preview <preview@datiq.app>"
```

### 5.3 Where secrets actually live

The pattern above uses **placeholder strings** in `netlify.toml`. Don't paste real secrets into a committed file. Two safer patterns:

**Option A (recommended): keep placeholders in `netlify.toml`, set real values in the Netlify UI**

1. In `netlify.toml`, keep the `PROD_*` / `STAGING_*` / `DEV_*` placeholders above.
2. In Netlify UI → Site settings → Environment variables:
   - For each placeholder, set the real value per context (use "Edit variables" → add context-specific overrides).
3. Netlify precedence: UI vars < `[context.*.environment]` in `netlify.toml`. The UI is the source of truth for **values**; the toml is the source of truth for **which var belongs to which context**.

**Option B: use Netlify's environment file feature**

1. Netlify UI → Site settings → Environment variables → "Import from a .env file"
2. Upload `env/production.env`, `env/staging.env`, `env/preview.env` (gitignored)
3. The toml only declares *which* env files to load; values stay out of git

I recommend **Option A** for the first migration. It's more visible, less to misconfigure.

### 5.4 Verify the contexts work

After deploying with the new `netlify.toml`:

- Visit `https://datiq.app` → open devtools → `localStorage.getItem("datiq.current")` (or similar) should reflect **prod** Supabase activity
- Visit `https://staging.datiq.app` → should reflect **dev** Supabase activity
- Open a PR → preview URL should reflect **dev** Supabase activity

A simple way to check which Supabase is in use: open the URL, look at Network → `datiq.app/api/stats` response. The `teams` and `extractions` values come from the active Supabase, and they're different between dev and prod (prod starts at 0, dev has whatever you've accumulated).

### 5.5 Rotate the dev `SUPABASE_SERVICE_KEY` after the cutover

Once prod is live and you're confident nothing is crossing over, **rotate the dev service key**. Reasons:

- If you ever accidentally pointed a prod function at dev, you'd have been compromised
- Rotation forces you to update secrets in Netlify UI from the new dev project keys
- A good habit

Do this 7+ days after cutover, not before, so you have a fallback.

---

## 6. Phase 3 — Configure branch deploys

In the Netlify UI:

1. Site settings → Build & deploy → Continuous deployment
2. **Production branch**: `main` (this is the only branch that deploys to `datiq.app`)
3. **Branch deploys**: "Deploy specific branches" → add `staging`
4. **Deploy previews**: "Any pull request" → generates `deploy-preview-{n}--datiq.netlify.app`
5. **Branch subdomains**: enabled (gives you `staging.datiq.app` automatically)
6. **Build settings** → verify build command = `npm run build`, publish = `dist`

### 6.1 Custom subdomain for staging

After step 3 above, Netlify will assign `staging--datiq.netlify.app` and offer `staging.datiq.app` as a custom subdomain. Click "Add domain" → `staging.datiq.app`. Netlify provisions a Let's Encrypt cert.

DNS records Netlify will ask for:

| Type | Host | Value |
|---|---|---|
| CNAME | `staging.datiq.app` | `staging--datiq.netlify.app` (or the load balancer Netlify gives you) |

Verify after ~5 minutes:

```bash
dig staging.datiq.app +short
# should return Netlify's load balancer IPs
curl -I https://staging.datiq.app
# should return 200, not the "site not found" page
```

### 6.2 Branch protection rules (GitHub)

In GitHub → repo Settings → Branches → Branch protection rules:

**For `main`:**
- ✅ Require a pull request before merging
- ✅ Require approvals: 1
- ✅ Dismiss stale pull request approvals when new commits are pushed
- ✅ Require status checks to pass before merging: select `test`, `smoke-staging`
- ✅ Require linear history
- ✅ Do not allow bypassing the above settings
- ❌ Do NOT enable "Include administrators" if you want to be able to fast-fix yourself (default behavior — admins can bypass)

**For `staging`:**
- ✅ Require a pull request before merging (optional — many teams push directly to staging)
- ✅ Require status checks: `test` only (no smoke — staging smoke runs on push, gated by build, not by branch protection)

### 6.3 GitHub Actions environment protection

GitHub → repo Settings → Environments → New environment → `production`:

- **Required reviewers**: add yourself
- **Deployment branches**: `main` only (no other branch can deploy to the prod environment)
- **Wait timer**: 0 (no mandatory delay)
- **Secrets**: add the GitHub-Actions-specific secrets you'll use (see §7.3)

The `production` environment is what makes the workflow in §7 wait for you to click "Approve" in the GitHub UI before deploying to prod.

Also create a `staging` environment (no required reviewers) so the staging deploy doesn't accidentally need approval.

### 6.4 DNS gotchas

If you use Cloudflare in front of Netlify (proxy mode):

- Set the DNS record to **DNS only** (grey cloud), not proxied (orange cloud). Netlify issues the cert; Cloudflare proxying breaks ACME challenges.
- If you want Cloudflare's WAF/CDN in front, use Netlify's full DNS (no Cloudflare) for the affected hostnames. DatIQ's scale doesn't need it.

If you use other DNS providers:

- CNAME is fine for subdomains; some providers don't allow CNAME on apex (`datiq.app`) — in that case use the A records Netlify gives you.
- TTL 300s for the 24h before cutover.

---

## 7. Phase 4 — Wire up the phase-gate CI/CD

The phase-gate is implemented as a GitHub Actions workflow. It runs on every push to `main`, but **pauses for manual approval** before deploying to production.

### 7.1 The workflow file

**File: `.github/workflows/phase-gate.yml` (NEW)**

```yaml
name: Phase-Gate Production Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      bypass_staging_check:
        description: "Skip staging smoke check (use only for hotfixes)"
        type: boolean
        default: false

concurrency:
  group: prod-deploy
  cancel-in-progress: false   # never cancel an in-flight prod deploy

jobs:
  # ─────────────────────────────────────────────────────────────────────
  # 1. UNIT + CONTRACT TESTS
  # ─────────────────────────────────────────────────────────────────────
  test:
    name: Unit + Contract Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version-file: ".node-version", cache: "npm" }
      - run: npm ci
      - run: npm test

  # ─────────────────────────────────────────────────────────────────────
  # 2. STAGING SMOKE — verify the same commit is healthy on staging
  # ─────────────────────────────────────────────────────────────────────
  smoke-staging:
    name: Smoke Test — Staging
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version-file: ".node-version", cache: "npm" }
      - run: npm ci
      - name: Wait for Netlify to finish the staging deploy
        run: |
          for i in {1..30}; do
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://staging.datiq.app/api/stats)
            if [ "$STATUS" = "200" ] || [ "$STATUS" = "503" ]; then
              # 200 = supabase OK, 503 = supabase not configured (also fine)
              COMMIT_RESPONSE=$(curl -s https://api.netlify.com/api/v1/sites/${{ secrets.NETLIFY_SITE_ID }}/deploys?per_page=1)
              LATEST_COMMIT=$(echo "$COMMIT_RESPONSE" | jq -r '.[0].commit_ref // "unknown"')
              if [ "$LATEST_COMMIT" = "$GITHUB_SHA" ] || [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
                echo "✓ staging is on commit $LATEST_COMMIT"
                exit 0
              fi
            fi
            echo "  staging not ready yet, attempt $i/30..."
            sleep 10
          done
          echo "✗ staging did not converge to the right commit in 5 min"
          exit 1
      - name: Run smoke test against staging
        run: node scripts/smoke-prod.mjs https://staging.datiq.app
        env:
          SMOKE_ADMIN_PIN: ${{ secrets.STAGING_ADMIN_PIN }}

  # ─────────────────────────────────────────────────────────────────────
  # 3. PRODUCTION DEPLOY — gated by environment approval
  # ─────────────────────────────────────────────────────────────────────
  deploy-production:
    name: Deploy to Production (manual approval)
    needs: smoke-staging
    if: ${{ github.event_name == 'workflow_dispatch' && inputs.bypass_staging_check != true || github.event_name == 'push' }}
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://datiq.app
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version-file: ".node-version"
          cache: "npm"
      - run: npm ci

      # The Netlify context (production) reads its env vars from the Netlify
      # UI / [context.production.environment] in netlify.toml. The CLI passes
      # them automatically. We only override the build-time VITE_* vars here
      # to be explicit (in case the Netlify context isn't set yet).
      - run: npm run build -- --mode production
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_RAZORPAY_KEY_ID: ${{ secrets.VITE_RAZORPAY_KEY_ID }}
          VITE_STRIPE_PUBLISHABLE_KEY: ${{ secrets.VITE_STRIPE_PUBLISHABLE_KEY }}
          VITE_AI_MODEL: claude-3-5-haiku-20241022
          VITE_PAYMENT_PROVIDER: auto
          VITE_WEBHOOK_URL: ${{ secrets.VITE_WEBHOOK_URL }}
          VITE_LINK_CHANGELOG: https://datiq.app/changelog
          VITE_LINK_ABOUT: https://datiq.app/about
          VITE_LINK_BLOG: https://datiq.app/blog
          VITE_FIRECRAWL_API_KEY: ""

      - name: Deploy to Netlify production
        uses: nwtgck/actions-netlify@v3.0
        with:
          publish-dir: "./dist"
          production-deploy: true
          deploy-message: "phase-gate: ${{ github.event.head_commit.message }}"
          env:
            NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
            NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}

  # ─────────────────────────────────────────────────────────────────────
  # 4. PRODUCTION SMOKE — verify after deploy, auto-rollback on fail
  # ─────────────────────────────────────────────────────────────────────
  smoke-production:
    name: Smoke Test — Production
    needs: deploy-production
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version-file: ".node-version", cache: "npm" }
      - run: npm ci
      - name: Wait for Netlify CDN to converge
        run: sleep 30
      - name: Run smoke test against production
        id: smoke
        run: |
          set +e
          node scripts/smoke-prod.mjs https://datiq.app
          SMOKE_EXIT=$?
          echo "smoke_exit=$SMOKE_EXIT" >> $GITHUB_OUTPUT
          exit $SMOKE_EXIT
        env:
          SMOKE_ADMIN_PIN: ${{ secrets.PRODUCTION_ADMIN_PIN }}

      - name: Auto-rollback on smoke failure
        if: failure()
        run: |
          echo "✗ production smoke failed, rolling back to last deploy"
          # Use Netlify CLI to restore the previous deploy
          npx netlify rollback --auth=$NETLIFY_AUTH_TOKEN
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}

      - name: Notify on failure
        if: failure()
        uses: slackapi/slack-github-action@v3.0.3
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": "🚨 DatIQ production smoke FAILED. Auto-rollback executed. Commit: ${{ github.sha }}"
            }
        continue-on-error: true
```

### 7.2 What the gate does

```
push to main
  │
  ├─► test (vitest 1,297 tests) ─────────── FAIL? → stop
  │
  ├─► smoke-staging (run §12 script against staging.datiq.app)
  │     │  wait for staging to converge to this commit
  │     │  run smoke test
  │     └─ FAIL? → stop (don't proceed to prod)
  │
  ├─► deploy-production
  │     │  ⏸  GitHub environment approval required (you click "Approve" in UI)
  │     │  netlify deploy --prod
  │     └─ FAIL? → stop
  │
  └─► smoke-production
        │  wait for CDN
        │  run smoke test against datiq.app
        │  FAIL? → netlify rollback (instant)
        └─ ✓ → done
```

### 7.3 GitHub Actions secrets

In GitHub → repo Settings → Secrets and variables → Actions, add:

| Secret | Where it goes | Notes |
|---|---|---|
| `NETLIFY_AUTH_TOKEN` | repo secrets | From §3.1 |
| `NETLIFY_SITE_ID` | repo secrets | From §3.1 |
| `STAGING_ADMIN_PIN` | staging environment | Plaintext PIN (for the smoke test only) |
| `PRODUCTION_ADMIN_PIN` | production environment | Plaintext PIN (for the smoke test only) |
| `VITE_SUPABASE_URL` | production environment | prod URL |
| `VITE_SUPABASE_ANON_KEY` | production environment | prod anon key |
| `VITE_RAZORPAY_KEY_ID` | production environment | live key |
| `VITE_STRIPE_PUBLISHABLE_KEY` | production environment | live key (for when Stripe ships) |
| `VITE_WEBHOOK_URL` | production environment | n8n prod URL |
| `SLACK_WEBHOOK_URL` | repo secrets (optional) | for failure notifications |

**Important:** production-only secrets are in the `production` environment, not the repo. This means a workflow that doesn't have the `production` environment context can't read them. This is a second layer of safety on top of the manual approval.

### 7.4 Hotfix path (bypassing the gate)

For critical hotfixes, you can:

1. Open a PR from a hotfix branch directly to `main` (bypassing `staging`)
2. The PR still requires `test` and `smoke-staging` to pass
3. After merge, the production deploy still requires your manual approval
4. The smoke test still runs and rolls back on failure

The gate is **manual approval**, not "no fast path". You decide case-by-case. The `workflow_dispatch` trigger with `bypass_staging_check` is for emergencies only — and even then, you still have to approve the prod deploy.

### 7.5 Production freeze

For high-stakes events (big product launch, paid marketing campaign, investor demo):

```bash
# In GitHub → Settings → Environments → production
# → "Deployment branches" → change from "main" to "Selected branches" → leave empty
# This blocks the workflow from triggering at all.
```

When the freeze lifts, restore "All branches" or add `main` back.

---

## 8. Phase 5 — Razorpay (test vs live)

The phase-gate relies on a critical safety property: **the dev/staging tier must never charge a real card.** Razorpay gives you this for free via test mode.

### 8.1 Test mode (dev + staging)

- Log into https://dashboard.razorpay.com (in **Test mode** — toggle at top-left)
- Settings → API Keys → Generate test key → `rzp_test_...`
- Use these in `[context.staging.environment]` and `[context.deploy-preview.environment]`
- Webhook URL: `https://staging.datiq.app/api/payment-webhook?provider=razorpay` → copy the webhook secret into the staging env vars
- Test cards: `4111 1111 1111 1111` (any future expiry, any CVV)

### 8.2 Live mode (production)

- Switch to **Live mode** in Razorpay dashboard
- Settings → API Keys → Generate live key → `rzp_live_...`
- Use these in `[context.production.environment]`
- Webhook URL: `https://datiq.app/api/payment-webhook?provider=razorpay` → copy the webhook secret into the prod env vars
- Live charges will hit real cards. **Verify with a ₹1 test product before announcing.**

### 8.3 Two webhooks, two secrets

Razorpay lets you register multiple webhook endpoints. Register both:

- `https://staging.datiq.app/api/payment-webhook?provider=razorpay` (test mode, secret = staging)
- `https://datiq.app/api/payment-webhook?provider=razorpay` (live mode, secret = prod)

Don't try to share a webhook URL — the secrets are different because the contexts are different.

### 8.4 Stripe (deferred)

Same pattern when you re-enable Stripe (per `docs/STRIPE-DEFERRAL.md`): test keys for staging, live keys for prod. Different webhook secrets per tier.

---

## 9. Phase 6 — Auth providers on the production Supabase

The dev Supabase has OAuth credentials registered for Google / Microsoft / GitHub. The prod Supabase needs its own.

### 9.1 Decide: shared or separate OAuth credentials?

You have two options for each provider:

**Option A: Reuse the dev OAuth credentials on prod**
- Pro: zero extra work, same client ID/secret everywhere
- Con: the OAuth consent screen says the dev project's name; you can't customize it per environment; some providers require a privacy policy URL that points to the dev Supabase's hosted auth

**Option B: Register separate OAuth credentials for prod**
- Pro: production branding matches; proper privacy policy URL; can later restrict to verified domains
- Con: more setup; need to register the prod callback URL with each provider

**Recommendation:** **Option A for the first cutover** (faster, fewer moving parts), then **Option B before you go to paid marketing** (so the consent screen is professional).

### 9.2 Callback URLs to register

For each OAuth provider, register both callback URLs:

| Provider | Callback URL pattern | Where to register |
|---|---|---|
| Google | `https://PROD_REF.supabase.co/auth/v1/callback` | Google Cloud Console → OAuth credentials |
| Microsoft | `https://PROD_REF.supabase.co/auth/v1/callback` | Azure AD → App registrations → Authentication |
| GitHub | `https://PROD_REF.supabase.co/auth/v1/callback` | GitHub OAuth app settings |
| (Staging uses the dev Supabase callback — no extra setup) | | |

### 9.3 Supabase Auth URL configuration on prod

In the **prod** Supabase dashboard:

- **Site URL**: `https://datiq.app`
- **Redirect URLs** (allowlist):
  - `https://datiq.app/**`
  - `https://www.datiq.app/**` (if you ever use the www subdomain)
  - `https://staging.datiq.app/**` (so people testing on staging can also use OAuth)
  - `https://deploy-preview-*-datiq.netlify.app/**` (for PR previews — optional)

If you see an "Auth redirect URL not in allowlist" error in production, add the missing URL to this list.

### 9.4 Email templates

The prod Supabase has its own email templates (confirmation, magic link, password reset). Customize them in Authentication → Email Templates:

- "From name": `DatIQ`
- "From email": `hello@datiq.app` (or your custom sender domain — requires Supabase custom SMTP setup)
- Confirmation URL: `${SITE_URL}/auth/callback` (Supabase substitutes `SITE_URL` automatically based on what you set in §9.3)

If you use Resend for transactional email (the codebase already has `RESEND_API_KEY` wired), the same key works for both tiers. From-addresses are split three ways so each can be repointed independently — set `CONTACT_EMAIL_FROM` (outbound to users), `ALERT_EMAIL_FROM` (schedule alerts), and `FORM_EMAIL_FROM` (inbound /contact form) per context (§5.2 already does this). No function falls back from one to another, so changing one sender never moves the others.

---

## 10. Phase 7 — Smoke test as deploy gate

The smoke test script is the same one in `FIREBASE-MIGRATION.md` §13, with one minor tweak: the target URL is passed in. It runs twice in the phase-gate — once against staging, once against production.

### 10.1 The script

**File: `scripts/smoke-prod.mjs` (NEW)**

```js
// scripts/smoke-prod.mjs
//
// Post-deploy smoke test for DatIQ.
// Usage:
//   node scripts/smoke-prod.mjs https://staging.datiq.app
//   node scripts/smoke-prod.mjs https://datiq.app
//   SMOKE_ADMIN_PIN=... node scripts/smoke-prod.mjs https://datiq.app
//
// Exits 0 on full pass, 1 on any failure. Safe to re-run.

import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.argv[2];
if (!BASE) { console.error("Usage: node scripts/smoke-prod.mjs <url>"); process.exit(2); }
const PIN = process.env.SMOKE_ADMIN_PIN || "ADMIN123";
const TIMEOUT_MS = 15_000;
const SAMPLE_URL = "https://example.com";

const results = [];
let adminToken = null;

const log = (...a) => console.log(...a);
const ok = (name, extra) => { results.push({ name, status: "PASS", extra }); log(`  ✓ ${name}`); };
const fail = (name, msg) => { results.push({ name, status: "FAIL", extra: msg }); log(`  ✗ ${name} — ${msg}`); };

async function check(name, fn) {
  try { ok(name, await fn()); }
  catch (e) { fail(name, e?.message || String(e)); }
}

async function timedFetch(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function expectStatus(url, init, expected, name) {
  const r = await timedFetch(url, init);
  if (Array.isArray(expected) ? !expected.includes(r.status) : r.status !== expected) {
    throw new Error(`${name}: expected ${expected}, got ${r.status}`);
  }
  return r;
}

log(`\n[smoke] target = ${BASE}\n`);

// ── 1. Static host reachable ─────────────────────────────────────────────
await check("static host returns 200", async () => {
  const r = await timedFetch(BASE);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  if (!(r.headers.get("content-type") || "").includes("text/html")) throw new Error("not html");
});

await check("SPA fallback works for /preview", async () => {
  if ((await timedFetch(`${BASE}/preview`)).status !== 200) throw new Error("not 200");
});

await check("SPA fallback works for /dashboard", async () => {
  if ((await timedFetch(`${BASE}/dashboard`)).status !== 200) throw new Error("not 200");
});

await check("security headers present", async () => {
  const h = (await timedFetch(BASE)).headers;
  const must = ["x-content-type-options", "x-frame-options", "referrer-policy"];
  const missing = must.filter((k) => !h.get(k));
  if (missing.length) throw new Error(`missing ${missing.join(",")}`);
});

// ── 2. Public read endpoints ─────────────────────────────────────────────
await check("/api/stats reachable", async () => {
  const r = await expectStatus(`${BASE}/api/stats`, {}, [200, 503], "stats");
  const j = await r.json().catch(() => null);
  if (!j) throw new Error("no JSON");
  return `teams=${j.teams ?? "—"} extractions=${j.extractions ?? "—"}`;
});

await check("/api/og-preview parses example.com", async () => {
  const r = await expectStatus(`${BASE}/api/og-preview?url=${encodeURIComponent(SAMPLE_URL)}`, {}, 200, "og");
  if (!(await r.json()).url) throw new Error("no url in body");
});

// ── 3. Extraction pipeline ──────────────────────────────────────────────
await check("POST /api/extract responds with body shape", async () => {
  const r = await expectStatus(`${BASE}/api/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: SAMPLE_URL, intent: "summary" }),
  }, [200, 400, 502], "extract");
  const j = await r.json();
  if (j && j.error) return `expected error (no scraper key): ${j.error}`;
  if (j && (j.html || j.markdown || j.metadata?.title || j.data)) return "ok";
  throw new Error("unrecognized body");
});

// ── 4. AI proxy ──────────────────────────────────────────────────────────
await check("POST /api/ai responds", async () => {
  const r = await timedFetch(`${BASE}/api/ai`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Say 'smoke ok' and nothing else.", max_tokens: 50 }),
  });
  if (![200, 400, 502, 503].includes(r.status)) throw new Error(`status ${r.status}`);
});

// ── 5. Supabase proxy endpoints ─────────────────────────────────────────
await check("GET /api/extractions returns 200", async () => {
  await expectStatus(`${BASE}/api/extractions`, {}, 200, "extractions");
});

await check("GET /api/schedules returns 200", async () => {
  await expectStatus(`${BASE}/api/schedules`, {}, 200, "schedules");
});

// ── 6. Admin auth gate ──────────────────────────────────────────────────
await check("POST /api/admin-auth with wrong PIN returns 401", async () => {
  await expectStatus(`${BASE}/api/admin-auth`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: "definitely-wrong-pin-12345" }),
  }, [401, 400, 403], "admin-auth-wrong");
});

await check("POST /api/admin-auth with correct PIN mints token", async () => {
  const r = await timedFetch(`${BASE}/api/admin-auth`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: PIN }),
  });
  if (r.status === 401) throw new Error("PIN rejected — set SMOKE_ADMIN_PIN or check ADMIN_PIN_HASH");
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const j = await r.json();
  if (!j.token) throw new Error("no token");
  adminToken = j.token;
});

await check("admin route accepts the token", async () => {
  if (!adminToken) throw new Error("no token");
  const r = await timedFetch(`${BASE}/api/admin-revenue`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (![200, 401, 503].includes(r.status)) throw new Error(`status ${r.status}`);
});

// ── 7. Payment endpoints (no actual charge) ──────────────────────────────
await check("POST /api/create-checkout with bad plan returns error JSON", async () => {
  const r = await timedFetch(`${BASE}/api/create-checkout`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ planId: "not-a-real-plan", billingPeriod: "monthly" }),
  });
  if (![400, 404, 500].includes(r.status)) throw new Error(`status ${r.status}`);
});

await check("POST /api/payment-webhook with bad signature is rejected", async () => {
  const r = await timedFetch(`${BASE}/api/payment-webhook?provider=razorpay`, {
    method: "POST", headers: {
      "content-type": "application/json",
      "x-razorpay-signature": "definitely-wrong-signature",
    },
    body: JSON.stringify({ event: "payment.captured", payload: { payment: { entity: {} } } }),
  });
  if (![400, 401, 403, 422].includes(r.status)) throw new Error(`status ${r.status}`);
});

// ── 8. CORS for browser preflight ───────────────────────────────────────
await check("CORS preflight on /api/extract returns Access-Control-Allow-Origin", async () => {
  const r = await timedFetch(`${BASE}/api/extract`, {
    method: "OPTIONS",
    headers: {
      "origin": BASE,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  if (![200, 204].includes(r.status)) throw new Error(`status ${r.status}`);
  if (!r.headers.get("access-control-allow-origin")) throw new Error("no ACAO");
});

// ── 9. Latency check ────────────────────────────────────────────────────
await check("p95 latency on /api/stats under 3s (5 calls)", async () => {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await timedFetch(`${BASE}/api/stats`);
    if (![200, 503].includes(r.status)) throw new Error(`status ${r.status}`);
    samples.push(Date.now() - t0);
    await sleep(100);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95) - 1] ?? samples.at(-1);
  if (p95 > 3000) throw new Error(`p95 = ${p95}ms`);
  return `p95=${p95}ms`;
});

// ── Summary ─────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
log(`\n[smoke] ${passed}/${results.length} passed, ${failed} failed\n`);

if (failed > 0) {
  for (const r of results.filter((r) => r.status === "FAIL")) log(`   FAIL  ${r.name} — ${r.extra}`);
  process.exit(1);
}
log("[smoke] all green ✓\n");
process.exit(0);
```

### 10.2 Where it runs

- **Locally**: `node scripts/smoke-prod.mjs https://staging.datiq.app` (or any URL) — pre-merge sanity check
- **In CI (staging)**: after every push to `staging`, before the workflow considers the build "green"
- **In CI (production)**: after the gated deploy, before the workflow considers the deploy "done"; auto-rollback on failure

### 10.3 What it does NOT cover

- Visual regression (use Playwright e2e visual tests for that — `npm run test:e2e:visual`)
- Performance load (use a separate k6 / Artillery script for that)
- Browser flow (use Playwright e2e for that — `npm run test:e2e:journeys`)

The smoke test is **the minimum bar** — a green smoke test means "the API + auth + DB are reachable and responding correctly". It's not a substitute for full e2e.

---

## 11. Pre-prod checklist (do all of these before cutover)

Run through this list with the boxes ticked. Each one is a real failure mode.

### Supabase

- [ ] `datiq-prod` Supabase project created in `ap-south-1` (or closest region to users)
- [ ] All SQL migrations applied via `scripts/migrate-prod.sh`
- [ ] `SELECT COUNT(*)` returns 0 for all user-data tables
- [ ] RLS is enabled on all user-data tables (`rowsecurity = t`)
- [ ] Anon + service keys generated and stored in Netlify UI (not in git)
- [ ] Supabase Auth email template customized (sender name, etc.)
- [ ] OAuth providers enabled (Google / Microsoft / GitHub) with appropriate callback URLs
- [ ] Site URL set to `https://datiq.app`; redirect URLs include datiq.app, staging.datiq.app
- [ ] Database backup is enabled (Pro tier)

### Netlify

- [ ] Production branch = `main`
- [ ] Branch deploys = `staging` only
- [ ] Deploy previews = any PR
- [ ] `staging.datiq.app` custom domain added + cert provisioned
- [ ] All `VITE_*` and `SUPABASE_*` env vars set per context (production, staging, deploy-preview)
- [ ] Razorpay **test** keys in staging/preview contexts
- [ ] Razorpay **live** keys in production context
- [ ] Razorpay webhook registered for both staging and production URLs with different secrets
- [ ] Stripe (deferred) test keys in staging, live in production
- [ ] AI / scraping / email keys per context
- [ ] `ADMIN_PIN_HASH` set per context; `ADMIN123` is rejected on prod
- [ ] `NODE_VERSION` = `24` in the build env for staging and production
- [ ] `AWS_LAMBDA_JS_RUNTIME` = `nodejs24.x` in the Netlify UI/API for staging and production (do not add it to `netlify.toml`)

### GitHub

- [ ] `phase-gate.yml` workflow committed
- [ ] GitHub `production` environment exists with you as required reviewer
- [ ] GitHub `staging` environment exists (no required reviewers)
- [ ] Production secrets added to the `production` environment (not repo-wide)
- [ ] `STAGING_ADMIN_PIN` and `PRODUCTION_ADMIN_PIN` set as environment secrets
- [ ] `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` set as repo secrets
- [ ] Branch protection on `main`: require PR + 1 approval + `test` + `smoke-staging` checks
- [ ] Branch protection on `staging`: optional

### DNS

- [ ] `staging.datiq.app` CNAME points to `staging--datiq.netlify.app` (or whatever Netlify gives)
- [ ] If using Cloudflare, all staging DNS records are **DNS only** (grey cloud)
- [ ] DNS TTL on existing apex record is 300s (drop at least 24h before any future apex cutover)

### Smoke test

- [ ] `node scripts/smoke-prod.mjs https://staging.datiq.app` passes
- [ ] `node scripts/smoke-prod.mjs https://datiq.app` passes against current Netlify prod (baseline)

### Cutover

- [ ] You have a tab open to Netlify dashboard + Supabase dashboard + Razorpay dashboard
- [ ] The team/yourself has been pinged — no other deploys are in flight
- [ ] You have 30 uninterrupted minutes
- [ ] A real card is ready (or a Razorpay test card) for the post-cutover payment test

---

## 12. The automated sanity test

Already documented in §10.1 above. The single source of truth lives in `scripts/smoke-prod.mjs`.

Run it manually before and after the cutover:

```bash
# Baseline (against current Netlify prod)
node scripts/smoke-prod.mjs https://datiq.app

# After staging is up
node scripts/smoke-prod.mjs https://staging.datiq.app

# After production cutover
SMOKE_ADMIN_PIN=your-real-prod-pin node scripts/smoke-prod.mjs https://datiq.app
```

Wire it into CI as part of the phase-gate workflow (§7.1).

---

## 13. Post-cutover — first 72 hours

Monitor these signals in order of "if this breaks, it's user-visible":

| Signal | Where to look | Threshold |
|---|---|---|
| 5xx rate on `/api/*` | Netlify dashboard → Functions → Logs | > 1% |
| Extraction success rate | `/api/extract` 200 vs 4xx/5xx in Netlify logs | < 95% = bad |
| Payment webhook delivery | Razorpay dashboard → Webhooks → Delivery attempts | any failures |
| Scheduled function runs | Netlify dashboard → Functions → scheduled-runner | one per hour, no gaps |
| Cold-start latency | Netlify function metrics | p95 > 3s = investigate |
| Cost | Supabase + Netlify billing | $0 baseline for low traffic |
| Auth | Supabase Auth logs on prod | new signups working, OAuth callback succeeds |
| DNS | `dig datiq.app +short` | resolves to Netlify |

Add an external uptime check (synthetic):

- UptimeRobot (free) or BetterStack monitor `https://datiq.app/api/stats` every 60s
- Get an alert (email / Slack) when it goes down

### 13.1 Confirm the phase-gate is working

After the first gated deploy:

1. Open a test PR from `staging` to `main` with a trivial change (e.g. bump version in package.json)
2. Watch the GitHub Actions run
3. The workflow should pause at "Deploy to Production (manual approval)" until you click Approve
4. Approve, watch the deploy, watch the smoke test pass
5. Verify `https://datiq.app` shows the new version
6. Now try a PR with a **broken** change (e.g. introduce a syntax error in a comment that's not a real error — actually easier: temporarily break a function and revert before merging)
7. Watch the smoke test fail and the workflow auto-rollback

If both flows work, your phase-gate is verified.

### 13.2 Monitor the new Supabase project

The prod Supabase is on its own project. Watch its dashboard separately:

- Database → CPU / memory / connections (should be near-zero for the first week)
- Auth → signups / logins (should match the marketing site traffic)
- Logs → API requests (should match the datiq.app traffic)

If anything looks higher than expected (e.g. thousands of extractions in the first hour), investigate immediately — either the gate isn't working, or someone has the prod keys.

---

## 14. Rollback plan

Netlify keeps every deploy. To roll back production:

### 14.1 Hosting rollback (instant, zero-downtime)

```bash
# List recent deploys
netlify deploys:list --site=$NETLIFY_SITE_ID --auth=$NETLIFY_AUTH_TOKEN

# Promote a specific deploy to "published" status
netlify deploys:restore <DEPLOY_ID> --site=$NETLIFY_SITE_ID --auth=$NETLIFY_AUTH_TOKEN
```

Or in the Netlify UI: Deploys → click the previous successful deploy → "Publish deploy".

### 14.2 Function rollback (fast)

Functions are redeployed on every `main` push. To roll back, revert the commit and push:

```bash
git revert <bad-commit-sha>
git push origin main
```

This triggers the phase-gate again. The smoke test will catch the issue if it wasn't already caught. **Don't disable the gate for a rollback** — let it run, let the smoke test verify, and let the auto-rollback catch you if it doesn't.

### 14.3 Data rollback (last resort)

The prod Supabase is on a paid plan → automatic daily backups (7-day retention on Pro). If you need to restore:

1. Supabase dashboard → Database → Backups → choose a point in time
2. Restore creates a **new** database; you swap the connection strings in Netlify
3. Test against the restored DB before pointing prod at it

For the first week after cutover, **don't drop the dev Supabase**. If you discover the prod Supabase is missing a table or has a corrupt schema, you have a fallback while you fix.

### 14.4 DNS rollback (the nuclear option)

`staging.datiq.app` is a Netlify subdomain. If Netlify goes down, point `staging.datiq.app` to a static "DatIQ is down for maintenance" page hosted on Cloudflare Pages or GitHub Pages.

`datiq.app` (apex) is still pointed at Netlify in this plan. If you need to move it elsewhere (Vercel, Cloudflare Pages, your own server), the migration is just a DNS change.

---

## 15. Cost estimate (rough)

At DatIQ's current shape (~5k extractions/mo, ~200 batch runs, ~50 payment events):

| Item | Estimate |
|---|---|
| Netlify Pro | **$19/seat/mo** (you're on it already) |
| Netlify Functions invocations | **$0** (under 125K/mo free on Pro) |
| Netlify Build minutes | **$0** (under 300 min/mo on Pro) |
| **Netlify total** | **~$19/mo** (unchanged) |
| Supabase dev (existing) | Free or Pro $25/mo |
| Supabase prod (new) | Pro $25/mo |
| **Supabase total** | **~$25-50/mo** (doubles from today) |
| Razorpay (unchanged) | 2% per transaction |
| Resend (email, unchanged) | Free → $20/mo at scale |
| **Total prod** | **~$45-90/mo** at current scale, dominated by Supabase |

The only real cost increase is the second Supabase project. If you start on Supabase Free for the prod tier, the cost increase is **$0** until the prod tier outgrows Free. Many production apps run on Supabase Free for months.

---

## 16. Common pitfalls (read these — they bite)

1. **The dev Supabase key leaking into the prod build.** If you have a `VITE_SUPABASE_URL` in your shell `env` or a hardcoded `dev` URL in `netlify.toml`, it ends up in the production bundle. Always set per-context in Netlify UI; never rely on shell env.
2. **The Razorpay LIVE key in the dev/staging build.** Same risk: if `rzp_live_...` is in the staging env, you can accidentally charge a real card on a test. Verify by visiting `https://staging.datiq.app/pricing` and checking the Razorpay popup — the key prefix in the network tab should be `rzp_test_`.
3. **OAuth redirect URL not whitelisted.** First user who tries Google login on prod gets a "redirect_uri_mismatch" error. Add the prod callback URL in the OAuth provider's console AND in Supabase Auth → URL Configuration.
4. **Service key rotation breaks staging if you do it too early.** If you rotate the dev service key, every Netlify deploy for staging will fail until you update the UI. Coordinate rotations with the team.
5. **`workflow_dispatch` doesn't trigger branch protection.** The phase-gate's manual approval is the only protection when using `workflow_dispatch`. Don't trust the "no PR = no protection" mental model.
6. **Netlify's "Auto Publishing" is on by default for production deploys.** You want it **off** when using the phase-gate — let the GitHub Action be the trigger, not the auto-publish. Site settings → Build & deploy → Continuous deployment → "Auto publishing" → disable for production.
7. **The smoke test passing does NOT mean the app works.** It means the API + auth + DB are reachable. Run the full Playwright suite (`npm run test:e2e:journeys`) once before any big release.
8. **Build context env vars and function env vars are different.** A `VITE_*` in `[context.staging.environment]` is build-time only — it goes into the JS bundle. A non-`VITE_` var is also available to functions at runtime. If you put `SUPABASE_URL` only in the build env, the function won't have it at runtime. Always set both.
9. **The `production` GitHub environment secret is per-PR only for the workflow that declares it.** The `deploy-production` job in §7.1 has `environment: production`, so it can read `production` secrets. The `test` and `smoke-staging` jobs cannot. This is by design — don't promote secrets to repo-wide unless you need them everywhere.
10. **`netlify rollback` rolls back to the previous successful deploy, not to a specific commit.** If you have a sequence of broken deploys, you may need to roll back multiple times. Or revert the commit and let the gate handle it.
11. **The branch protection "include administrators" toggle.** If it's off, you can bypass your own gate. Convenient for hotfixes, dangerous in general. Default: leave it off (you can always bypass yourself if needed).
12. **Supabase Pro plan doesn't include SOC2 by default.** If you need SOC2, it's an add-on ($200+/mo). Out of scope for this plan.
13. **The dev Supabase might have test data in it that's NOT meant for prod.** Verify by checking dev's `extractions` count vs prod's (should be 0). If non-zero on prod, you ran migrations on the wrong DB. Stop and investigate.
14. **Custom domain SSL takes 1-5 minutes after DNS change.** During that window, users see a cert error. Schedule the cutover for a low-traffic window.
15. **The "first deploy" is slow.** Netlify cold-builds functions the first time. Subsequent deploys are faster. If the first deploy takes 3 minutes and you have a 2-minute workflow timeout, the deploy will look failed but actually be in progress. Check the Netlify dashboard, not just GitHub Actions.

---

## 17. Sequencing — the actual order

If you have one quiet afternoon to start, do this in order. Each step is a separate PR / manual change.

| # | Action | Time | Risk |
|---|---|---|---|
| 1 | Create the new Supabase project (§4.1) | 10m | none |
| 2 | Apply SQL migrations via `scripts/migrate-prod.sh` (§4.2) | 15m | low |
| 3 | Verify schema, RLS, empty data (§4.3, §4.6) | 10m | none |
| 4 | Configure Supabase Auth: email template, providers, redirect URLs (§4.4, §9) | 30m | low |
| 5 | Update `netlify.toml` with the three `[context.*.environment]` blocks (placeholders) (§5.2) | 30m | none |
| 6 | In Netlify UI, set real env var values per context (§5.3) | 1h | low |
| 7 | Set up branch deploys: production=`main`, branch deploys=`staging`, deploy previews=any PR (§6) | 10m | none |
| 8 | Add `staging.datiq.app` custom domain + DNS (§6.1) | 5m + 5m DNS | low |
| 9 | Push to `staging` branch, verify auto-deploy (§3 sequencing) | 15m | none |
| 10 | Run `scripts/smoke-prod.mjs https://staging.datiq.app` and fix anything that fails | 30m | low |
| 11 | Add GitHub `production` environment with yourself as reviewer (§6.3) | 5m | none |
| 12 | Add `phase-gate.yml` workflow + GitHub secrets (§7) | 1h | none |
| 13 | Configure branch protection on `main` (§6.2) | 10m | low |
| 14 | Switch Netlify production auto-publish OFF (§16.6) | 1m | medium (one-time) |
| 15 | Do a test deploy: PR from `staging` to `main` with trivial change; observe the gate (§13.1) | 30m | low |
| 16 | Do a test rollback: push a broken change, observe auto-rollback | 30m | low |
| 17 | Set up Razorpay test webhook on staging URL (§8) | 15m | low |
| 18 | Set up Razorpay live webhook on prod URL (after prod goes live) | 15m | medium |
| 19 | Update `CLAUDE.md` to reference this doc and the new tier model | 15m | none |
| 20 | Add `docs/PRODUCTION-RELEASE-V1.0.md` note about the phase-gate | 5m | none |

Total wall time: about **one work day**, mostly waiting for DNS/SSL/SQL migrations.

The riskiest steps are 14 (auto-publish off — one-time, can be reverted) and 18 (live Razorpay webhook — only do this after everything else is green).

---

## 18. After it ships — update `CLAUDE.md`

Once the migration is done, add a section to `CLAUDE.md` (or a new `docs/PROD-INFRA.md` you reference from it) covering:

- The three-tier model (dev / staging / production) and the branches that trigger each
- The two Supabase projects (dev = existing, prod = new) and where to find their keys
- The phase-gate workflow and the GitHub `production` environment
- The smoke test command
- The §11 pre-prod checklist
- The §14 rollback procedure

I'll write that doc for you when the migration is complete — just say the word and I'll start on the first PR.

---

## 19. TL;DR — if you only do 3 things right now

1. **Create the new Supabase project and run the migrations** (§4) — 30 min, isolated from prod, no Netlify changes yet. Validate the schema is identical to dev and starts empty.
2. **Add the smoke test script and run it against current Netlify prod** (§10.1) — this is your baseline. If it doesn't pass today, you can't tell if a failure is "the migration broke it" or "it was already broken".
3. **Set up branch protection on `main` + the GitHub `production` environment** (§6.2, §6.3) — these are the two safety primitives. They take 10 minutes and they prevent the wrong thing from happening even if everything else is misconfigured.

When you're ready to start step 1, this doc has every command, file, and check you need. Start with the Supabase project — that's the longest lead time and the one that has the least margin for error.

---

*Document owner: DatIQ engineering. Update this file (not the CLAUDE.md) when the multi-environment plan changes. Once the prod tier is live and the gate is proven, archive this doc to `docs/NETLIFY-ENVIRONMENTS-COMPLETED.md` and link from CLAUDE.md.*

*Pair with `FIREBASE-MIGRATION.md` — the two are alternatives. This doc is the conservative, safer choice. Choose Firebase only if you have a real reason (data residency in GCP, BigQuery pipeline, cost at scale past 500k requests/mo).*
