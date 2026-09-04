# DatIQ Intelligence Workflows (Phases 0–7) — Deployment Guide & Release Checklist

> **Scope:** Full operational guide for deploying and promoting DatIQ Intelligence Workflows (Phases 0 through 7) across Staging and Production environments.
> **Source Plan:** `docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md` (derived from BRD & PRDs 1–5).
> **Verification Companion:** `docs/MANUAL-TEST-INTELLIGENCE-WORKFLOWS.md`.
> **Target Branches:** `staging` (current tip, deployed & verified) → `main` (production promotion target).
> **Status:** ⚠️ **CORRECTED 2026-09-04 after a BRD-conformance, security and coverage review.**
> This guide was written against a status board that recorded Phases 4-6 as complete. They are
> **partial**, and they shipped a critical vulnerability. Read §0 before following any step here.

---

## 0. STOP — read this before promoting anything

A review on 2026-09-04 found that migrations `0041`, `0042` and `0043` grant **full read and write
on 15 tables to the anonymous role**, via `grant all … to anon` combined with a policy reading
`using (user_id = auth.uid() or auth.uid() is null)` — and `auth.uid()` **is** null for the anon
role. The anon key is public by design and ships in every browser bundle.

**Verified exploitable, read-only, against staging:** `GET /rest/v1/lists?select=id&limit=1` with
only the committed publishable key returned HTTP 200 and real row ids, with no Authorization
header and no session. `review_queue` holds unverified contact PII.

**Consequences for this runbook:**

1. **The migration range is `0036`–`0044`, not `0036`–`0043`.** `0044_lock_down_workflow_rls.sql`
   is the fix. Applying `0041`–`0043` to production **without** `0044` reproduces the vulnerability
   in production. Never run this runbook's §3 as originally written.
2. **`0044` must be applied to the STAGING project immediately.** Staging is exposed today.
   Verify afterwards: the probe above must return **401**, not 200.
3. **Phases 4-6 are NOT complete.** Three BRD "Must" requirements have no implementation:
   PRD 5 never dispatches (`recordExecution` has zero callers, so the "execution audit logging"
   this guide's Phase 6 row claims does not exist); PRD 4 has no scheduled crawler or differ, so a
   chosen cadence is stored and never honoured; PRD 3's chunk runner is browser-driven and strands
   a job when the tab closes.
4. **A green Staging Gate proved none of this.** The three endpoints had zero contract tests.

Full detail, with the fixes applied and what remains:
[`docs/WORKFLOWS-CONFORMANCE-REVIEW-2026-09-04.md`](WORKFLOWS-CONFORMANCE-REVIEW-2026-09-04.md).

---

## 1. Executive Summary & Delivered Architecture

DatIQ Intelligence Workflows transitions the platform from isolated web extraction into structured, automated business intelligence. The implementation spans 8 foundational and user-facing phases:

| Phase | PRD Reference | Core Deliverables & Key Subsystems | Primary Technical Assets |
|---|---|---|---|
| **Phase 0** | **Spine** | Versioned templates, append-only credit ledger, field-level provenance, shared pure models. | Migrations `0036`–`0038`, `templateModel.js`, `creditModel.js`, `visibilityModel.js`, `workflowEnqueue.js`. |
| **Phase 1** | **PRD 1** | 6 persona workflow templates, guided onboarding, dynamic input forms, structured output renderers. | `/templates`, `TemplateRunner.jsx`, `templates.js`, `seedTemplates.js`. |
| **Phase 2** | **PRD 2** | Shareable intelligence reports, private-by-default visibility state machine, RLS server resolution, zero-indexed links. | Migration `0039`, `/r/:slug`, `Report.jsx`, `public-reports.js`, `visibilityModel.js`. |
| **Phase 3** | **Activation / PQL** | Compound activation tracking per persona, 9-signal 130-pt PQL scoring engine, revenue dashboard funnel, recipe gallery. | Migration `0040`, `pqlModel.js`, `pql-intake.js`, `/admin/revenue`, `/integrations`. |
| **Phase 4** | **PRD 3** | Bulk Account Intelligence: CSV/Paste import, pre-enrichment dedup preview, chunked durable runner, ICP scoring with §1.6 coverage rule, ICP Rule Simulator sandbox, Human Review Queue. | Migration `0041`, `identityModel.js`, `icpModel.js`, `bulkStore.js`, `bulk-enrichment.js`, `bulkClient.js`, `/lists`. |
| **Phase 5** | **PRD 4** | Competitor Watchlists & Change Intelligence: automatic page discovery, deterministic materiality classification (`critical`, `high`, `medium`, `low`), Fact vs AI tabs, user feedback loop. | Migration `0042`, `materialityModel.js`, `watchlistStore.js`, `watchlists.js`, `watchlistClient.js`, `/watchlists`. |
| **Phase 6** ⚠️ | **PRD 5** | Native Signal Routing: If-This-Then-That rule builder and Rule Evaluation Sandbox. ⚠️ **Dispatch and execution audit logging are NOT implemented** — `recordExecution` has zero callers and rules never fire. See §0. | Migration `0043`, `ruleModel.js`, `ruleStore.js`, `signal-rules.js`, `rulesClient.js`, `/rules`. |
| **Phase 7** | **Packaging & Gate** | Interactive Workflow Run History Modal (`WorkflowRunModal.jsx`), TopBar navigation parity, pre-push verification, Staging Gate CI green. | `WorkflowRunModal.jsx`, `TopBar.jsx`, `App.jsx`, GitHub Actions Staging Gate `#33829281244`. |

---

## 2. Pre-Deployment Prerequisites

### 2.1 Tooling & Environment
- **Node.js**: `v24.x` (managed via `nvm use 24`).
- **Package Manager**: `npm` (lockfile version 3).
- **Netlify CLI**: Installed or run via local tooling (`tools/netlify-cli`).
- **Supabase CLI / PostgreSQL Client**: Direct connection access to Supabase PostgreSQL on port `5432`.
- **Git**: Clean working directory on the active branch.

### 2.2 Required Environment Variables & Secrets

#### Client Environment Variables (Bundled by Vite via `.env`)
```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_FIRECRAWL_API_KEY=fc-...
VITE_AI_API_KEY=sk-ant-...          # Required for client-side summarization & synthesis
VITE_AI_MODEL=claude-3-5-haiku-20241022
VITE_WEBHOOK_URL=https://...        # n8n webhook endpoint
```

#### Netlify Serverless Function Environment Variables (Netlify Site Settings)
```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...    # Required for administrative RLS bypass on private reports & ledger
RESEND_API_KEY=re_...                      # Required for native email dispatch
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
HUBSPOT_ACCESS_TOKEN=pat-na1-...           # Required for HubSpot company creation/updates
ADMIN_EMAILS=vikash@...                    # Admin authorization list
```

---

## 3. Database Migration Runbook (`0036`–`0044`)

> ⚠️ **`0044` is not optional and must never be skipped.** See §0: `0041`-`0043` without it leave
> every table in this feature readable and writable by anyone holding the public anon key.

The workflow engine introduces 9 sequential, idempotent SQL migrations (`0044` alters policies and grants added by `0041`-`0043`; it adds no tables and removes no data). **No existing tables or columns are deleted or destructively altered.**

### 3.1 Migration Sequence & File Manifest

| # | Migration File | Target Subsystem | Tables / Objects Created |
|---|---|---|---|
| 1 | [`0036_workflow_templates.sql`](file:///Users/vikash/Extracta/supabase/migrations/0036_workflow_templates.sql) | Template Catalog & Runs | `workflow_templates`, `template_runs`, `template_run_sources` |
| 2 | [`0037_credit_ledger.sql`](file:///Users/vikash/Extracta/supabase/migrations/0037_credit_ledger.sql) | Billing & Credits | `credit_ledger` (append-only trigger), `credit_estimates` |
| 3 | [`0038_field_provenance.sql`](file:///Users/vikash/Extracta/supabase/migrations/0038_field_provenance.sql) | Evidence & Provenance | `extracted_fields`, `field_provenance` |
| 4 | [`0039_report_access.sql`](file:///Users/vikash/Extracta/supabase/migrations/0039_report_access.sql) | Shareable Reports | `reports`, `report_grants`, `report_access_log` |
| 5 | [`0040_pql.sql`](file:///Users/vikash/Extracta/supabase/migrations/0040_pql.sql) | Activation & PQL | `pql_scores`, `activation_events` |
| 6 | [`0041_bulk_enrichment.sql`](file:///Users/vikash/Extracta/supabase/migrations/0041_bulk_enrichment.sql) | Bulk Account Intelligence | `lists`, `canonical_entities`, `list_records`, `icp_score_rules`, `enrichment_jobs`, `enrichment_job_items`, `review_queue` |
| 7 | [`0042_watchlists.sql`](file:///Users/vikash/Extracta/supabase/migrations/0042_watchlists.sql) | Competitor Watchlists | `watchlists`, `watchlist_targets`, `monitored_pages`, `entity_snapshots`, `field_changes`, `change_feedback` |
| 8 | [`0043_signal_rules.sql`](file:///Users/vikash/Extracta/supabase/migrations/0043_signal_rules.sql) | Signal Routing | `signal_rules`, `rule_executions` |
| 9 | [`0044_lock_down_workflow_rls.sql`](file:///Users/vikash/Extracta/supabase/migrations/0044_lock_down_workflow_rls.sql) | **SECURITY — mandatory** | Revokes the anon/authenticated grants and replaces the permissive policies from `0041`-`0043` with the service-role-only pattern used by `0029`, `0031` and `0036`-`0040`, across all 15 tables |

### 3.2 Pre-Flight Local Verification (WASM PostgreSQL / PGlite)
Before applying migrations to any remote Supabase instance, execute the in-memory database test suite:
```bash
npm run test:db
```
**Expected Outcome:**
```text
✓ Applied 44 migrations (0001_initial_schema.sql -> 0044_lock_down_workflow_rls.sql)
✓ Passed 460 schema assertions across RLS, triggers, functions, and seed data.
```

### 3.3 Production Supabase Apply Procedure
To apply migrations `0036`–`0044` directly to the production Supabase instance (`0044` is mandatory — see §0):

#### Option A: Direct Connection Migration Runner (Recommended)
```bash
PROD_SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" npm run migrate:prod
```

#### Option B: Supabase Web SQL Editor
Open **Supabase Dashboard → Project → SQL Editor**, and execute migration scripts in exact numerical order: `0036` → `0037` → `0038` → `0039` → `0040` → `0041` → `0042` → `0043` → **`0044`**.

### 3.4 Post-Apply SQL Data Integrity Sweep
Run the following SQL script to confirm schema health:
```sql
-- 1. Assert exactly 42 public tables present
select count(*) as table_count
  from pg_tables
 where schemaname = 'public'
   and tablename in (
     'extractions', 'usage_records', 'public_reports', 'user_settings',
     'plans', 'subscriptions', 'invoices', 'coupons', 'checkout_sessions',
     'scheduled_tasks', 'workflow_events', 'workflow_runs', 'analytics_events',
     'audits', 'audit_comparisons',
     'workflow_templates', 'template_runs', 'template_run_sources',
     'credit_ledger', 'credit_estimates', 'extracted_fields', 'field_provenance',
     'reports', 'report_grants', 'report_access_log', 'pql_scores', 'activation_events',
     'lists', 'canonical_entities', 'list_records', 'icp_score_rules',
     'enrichment_jobs', 'enrichment_job_items', 'review_queue',
     'watchlists', 'watchlist_targets', 'monitored_pages', 'entity_snapshots',
     'field_changes', 'change_feedback',
     'signal_rules', 'rule_executions'
   );
-- Expect: 42

-- 2. Assert RLS enabled on all newly created tables
select count(*) as unshielded_tables
  from pg_tables
 where schemaname = 'public'
   and tablename in (
     'lists', 'canonical_entities', 'list_records', 'icp_score_rules',
     'enrichment_jobs', 'enrichment_job_items', 'review_queue',
     'watchlists', 'watchlist_targets', 'monitored_pages', 'entity_snapshots',
     'field_changes', 'change_feedback',
     'signal_rules', 'rule_executions'
   )
   and not rowsecurity;
-- Expect: 0 (zero unshielded tables)

-- 3. Assert append-only ledger immutability
select count(*) from credit_ledger where credits = 0;
-- Expect: 0
```

---

## 4. Netlify Functions Bundling Architecture

### 4.1 Relative Import Path Rules
The serverless functions reside at two different directory depths in `netlify/functions`:
1. **Depth 2 (`netlify/functions/*.js`)**:
   - Must import from root `src` using `../../src/...`.
   - Examples: `netlify/functions/templates.js`, `netlify/functions/bulk-enrichment.js`.
2. **Depth 3 (`netlify/functions/lib/*.js`)**:
   - Must import from root `src` using `../../../src/...`.
   - Examples: `netlify/functions/lib/bulkStore.js`, `netlify/functions/lib/watchlistStore.js`, `netlify/functions/lib/ruleStore.js`.

### 4.2 Local Bundling Verification
To verify that all 62 serverless functions bundle cleanly without esbuild resolution errors:
```bash
npx @netlify/zip-it-and-ship-it netlify/functions .netlify-bundle-test
```
**Expected Outcome:** Exits with code `0`; output JSON confirms 62 functions compiled with 0 errors. (Clean up test folder: `rm -rf .netlify-bundle-test`).

---

## 5. Pre-Deployment Quality Checklist

All 9 quality gates must pass locally prior to promoting any branch:

| Gate | Verification Command | Expected Output | Status |
|---|---|---|---|
| **1. Release Readiness** | `npm run audit:readiness` | 0 admin leaks, email split verified, clean asset refs | ✅ PASS |
| **2. Unit Tests** | `npm run test:unit` | 171 test files passed, 2,871 unit tests passed | ✅ PASS |
| **3. Contract Tests** | `npm run test:contract` | 104 test files passed, 1,887 contract tests passed | ✅ PASS |
| **4. Integration Tests** | `npm run test:integration` | All API endpoint integration suites green | ✅ PASS |
| **5. System Tests** | `npm run test:system` | End-to-end system flows green | ✅ PASS |
| **6. Database Verifier** | `npm run test:db` | 43 migrations applied, 384 assertions passed | ✅ PASS |
| **7. Production Build** | `npm run build` | Vite production build clean in `< 2.5s` | ✅ PASS |
| **8. Prerender Integrity** | `npm run test:prerender` | All prerendered HTML routes match build asset hashes | ✅ PASS |
| **9. Security Scan** | `npm run security:check` | 0 high+ vulnerabilities (with valid unexpired bypasses) | ✅ PASS |

**Fast Full Gate Command:**
```bash
npm run test:all -- --quick
```

---

## 6. Staging Deployment Procedure & Verification

### 6.1 Deployment to Staging
1. Commit all verified changes to the local `staging` worktree.
2. Push to `origin/staging`:
   ```bash
   git push origin staging
   ```
3. Netlify automatically detects the push and triggers deploy on site `datiqapp` for branch `staging`.

### 6.2 Monitoring Build & Deploy
- Netlify Build URL: `https://app.netlify.com/projects/datiqapp/deploys`
- Verify Deploy State:
  - Deploy transitions to **`state: ready`** (Site is live ✨).
  - All 62 serverless functions successfully packaged.

### 6.3 GitHub Actions Staging Gate
Monitor run progress on GitHub Actions:
- Workflow: [Staging Gate](https://github.com/vikashkaruna/scrapelite/actions/workflows/staging-gate.yml)
- **Checklist:**
  - [x] `Staging Gate: Vulnerabilities` (green)
  - [x] `Staging Gate: Open Issues/Defects` (green)
  - [x] `Staging Gate: Test Suites` (green: Unit, Contract, Integration, System, Build, Prerender, Playwright E2E 131 tests, Security)
  - [x] `Staging Gate: Deployed & Smoke Tested` (green: verified live staging deploy)

### 6.4 Live Staging Smoke Test Checklist
Navigate to `https://staging--datiqapp.netlify.app`:
- [ ] **Templates (`/templates`)**: All 6 published cards load, persona filters work, template forms open.
- [ ] **Run Detail Modal (`/dashboard?view=runs`)**: Clicking any run row opens `WorkflowRunModal.jsx` displaying facts, confidence %, credit breakdown, and source URLs.
- [ ] **Bulk Account Lists (`/lists`)**: Pre-enrichment dedup preview functions, chunk runner executes, ICP Rule Simulator sandbox updates scores, Review Queue operates.
- [ ] **Competitor Watchlists (`/watchlists`)**: Auto-discovers pages, change feed sorts by materiality, Fact vs AI interpretation tabs separate cleanly.
- [ ] **Native Signal Routing (`/rules`)**: Rule builder saves if-this-then-that rules, interactive Rule Evaluation Sandbox evaluates test JSON payloads.
- [ ] **Reports (`/r/:slug`)**: Publishing state machine transitions cleanly, `noindex` tag present on link-shared reports.

---

## 7. Production Promotion & Cutover Runbook

Once the Staging Gate has completed with 100% green status, follow this step-by-step cutover protocol to promote changes to Production.

### Step 1: Confirm Working Directory Safety
Ensure the local production repository `/Users/vikash/Extracta` is on branch `main` and completely clean:
```bash
cd /Users/vikash/Extracta
git status
```
*Expect: `On branch main. Your branch is up to date with 'origin/main'. nothing to commit, working tree clean.`*

### Step 2: Apply Database Migrations to Production Supabase
Apply migrations `0041`, `0042`, and `0043` to the live production database before code cutover:
```bash
PROD_SUPABASE_DB_URL="postgresql://postgres:[PROD_PASSWORD]@db.[PROD_REF].supabase.co:5432/postgres" npm run migrate:prod
```
Run the post-apply SQL integrity sweep (§3.4) to confirm all tables and RLS policies are active.

### Step 3: Fast-Forward Merge Staging to Main
Merge the verified `staging` branch into `main`:
```bash
git checkout main
git fetch origin
git merge origin/staging --ff-only
```
*(If `--ff-only` is not possible due to prior branch divergence, create and merge a release PR on GitHub).*

### Step 4: Push to Production
```bash
git push origin main
```
Netlify immediately initiates the production build for `https://datiq.app`.

### Step 5: Monitor Production Deploy & CI
- Netlify site: `datiqapp` (`0ac65a7e-bd3f-4cde-a8d3-66c23899c473`).
- Confirm deploy state reaches `state: ready`.
- Confirm GitHub Actions `Production Gate` completes with all green jobs.

### Step 6: Post-Deploy Production Verification Checklist
- [ ] Open `https://datiq.app` in an incognito window.
- [ ] Verify TopBar links: `Extract`, `Templates`, `Lists`, `Watchlists`, `Rules`, `Discover`, `Dashboard`.
- [ ] Execute a live run of `account_brief` on a sample domain (`stripe.com`).
- [ ] Open the completed run in `/dashboard?view=runs` and confirm the detail modal displays extracted facts and exact credits.
- [ ] Verify that legacy routes (`/`, `/dashboard`, `/discoverability`, `/pricing`) function without regression.

---

## 8. Rollback & Incident Response Runbook

In the unlikely event of an issue post-deployment:

### 8.1 Instant Frontend Rollback (Netlify 1-Click Rollback)
Because Netlify deployments are atomic and immutable:
1. Open **Netlify Dashboard → Project `datiqapp` → Deploys**.
2. Find the prior verified production deploy (or deploy tag `pre-integration-merge` @ `ebaa4bf`).
3. Click **"Publish deploy"**.
4. The production site reverts to the previous artifact in `< 5 seconds`.

### 8.2 Database Backward Compatibility
- Migrations `0036`–`0043` are **strictly additive**.
- If the frontend is rolled back to a pre-workflows commit, older frontend code does not query the new tables (`lists`, `watchlists`, `signal_rules`), and all existing queries on `extractions`, `usage_records`, and `public_reports` continue functioning without error.
- **Do not run destructive `DROP TABLE` commands in production** during an incident unless instructed by the lead engineer.
