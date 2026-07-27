# Session handoff — 2026-07-27 (late) — migrations executed, release merged to `staging`

> **Read this first if you are starting fresh.**
>
> Entry point: `AGENTS.md` → `CLAUDE.md` → this file → `git log --oneline -10` → `git status`.
>
> **State in one line:** the invoicing & subscription-lifecycle release is merged to
> `staging` and pushed (`origin/staging` = `0b207cf`); the migrations have now
> actually been **executed** and are covered by a permanent gate; **production is
> NOT done** and is a separate, deliberately-gated decision.

---

## 1. What changed this session

The previous handoff's single biggest open risk was that migrations `0012`–`0017`
**had never been executed anywhere** — no Postgres, no Docker, no psql on the dev
machines, so they shipped having only been checked for `$$` balance and structure.

That risk is now closed, and closed repeatably.

### 1.1 The migrations ran — 89 assertions, zero defects

[scripts/db-verify.mjs](../scripts/db-verify.mjs) applies every numbered
migration to **in-process WASM Postgres (PGlite)** with minimal Supabase shims,
then exercises what they create. ~5 seconds, **no Docker, no psql, no network, no
credentials** — which is why it can be a permanent gate rather than a manual
ritual. It is wired into `test:all` as **`npm run test:db`**.

All 17 apply cleanly → **26 tables, 9 functions, 2 triggers, 66 indexes, 20
policies, 0 tables without RLS.**

**Zero defects were found in the migrations themselves.** Every failure while
building the harness was the harness's own bug (jsonb key ordering, a `void`
return, a guessed column name).

Proven rather than assumed:

| Object | What is now verified |
|---|---|
| `fy_of()` | FY boundary is 1 April **IST**: `2026-03-31 18:31Z` → FY **26-27** (a UTC implementation returns 25-26) |
| `next_invoice_no()` | zero-padded, per-`(series, fy)`, restarts in a new FY, and **a rollback leaves no gap** |
| `issue_invoice()` | idempotent on replay — same number, no duplicate row, **no duplicated lines**; `taxable+tax===total`; `cgst+sgst===tax` |
| `invoices_immutable` | blocks `total_minor` / `invoice_no` / `user_id` re-point; allows status, `refunded_minor`, pdf fields, and NULL→set guest adoption; bumps `updated_at` |
| `plan_rank()` | full ordering, case-insensitive, **unknown plans rank 0** so they never win a merge |
| `merge_entitlement_…` | never downgrades (free ✗ over pro, agency ✓ over pro); version increments; null user no-ops |
| `claim_billing_session()` | `no_auth` without JWT; stamps all three tables; idempotent for the same user; **refuses a second user** without moving `user_id` |
| `redeem_coupon()` | `ok` / `already_redeemed` / `cap_reached`; cap-reached **rolls its own row back**; counter stops at the cap |
| RLS (`role=authenticated`) | owner sees exactly their own invoices and **strictly fewer than the table holds**; another user sees none, and no subscription rows; cannot INSERT invoices or UPDATE subscriptions |
| 0015 | column-level REVOKE on `system_paused` / `system_pause_reason` is in force |

### 1.2 ⚠️ What this does NOT replace

PGlite has **no GoTrue, no PostgREST, no Supabase roles** — `auth.users`,
`auth.uid()` and `anon`/`authenticated`/`service_role` are shims, so grants are
asserted structurally and not through the real PostgREST request path. It also
says nothing about connection strings, the pooler, or Supabase's own default grants.

**The scratch-project apply is still mandatory before production.** The gate makes
that apply boring; it does not substitute for it. Commands, the staged-rollout
subset applier, the state probe and verification SQL are in
[DB-MIGRATION-RUNBOOK.md](DB-MIGRATION-RUNBOOK.md).

### 1.3 Three real defects found and fixed

- **`docs/capture-screenshots.mjs` was broken.** The onboarding tour auto-starts
  on a fresh profile and its full-screen backdrop swallowed every click, so the
  first click (theme toggle) retried until timeout and **no screenshots were
  written at all**. That is why the readiness audit had been stuck warning
  "regenerate screenshots" with nobody able to comply. Fixed by seeding
  `datiq.onboardingTour.v1` as completed via `addInitScript` before any navigation.
- **`public/help/15-glossary.html` was a stale orphan** — still publicly served,
  carrying a sidebar that predated the section renumber and omitted Keyboard
  shortcuts entirely. `build-help.mjs` wrote pages but never pruned them, so every
  renumber left a wrong page live. Pruning added (scoped to files the generator
  owns); it now self-heals.
- **Admin leaked onto a public surface.** `src/pages/Changelog.jsx`'s SEO meta
  description advertised an "admin" capability area — on the public changelog, and
  inaccurately, since `FEATURE_GROUPS` has no admin group. The readiness audit's
  term list does not catch a bare "admin" in prose. Removed; verified in-browser
  (0 admin mentions on the rendered page).

### 1.4 Release collateral synced

- User guide §11 gains **"Invoices & receipts"** and **"If a plan lapses"**, plus a
  lapse note in §8 Scheduling. Deliberately hedged to what actually ships:
  receipt-or-tax-invoice, and **no deletion promise**, because the purge is disarmed.
- Changelog: 6 invoicing/lifecycle features (now 87 features / 11 areas).
- `llms.txt`: one billing line.
- New release blog post + a new **`10-account-billing.png`** screenshot framed on
  the invoices card (the first capture came out cropped on plan/usage, so the
  capture script now scrolls the card into view).

---

## 2. Where things stand

| Ref | SHA | Note |
|---|---|---|
| `origin/staging` | `0b207cf` | **merged and pushed this session** |
| `staging` (local) | `0b207cf` | in sync with origin |
| `main` / `origin/main` | `f56306d` | **unchanged — production not touched** |
| `claude/prod-db-migration-commands-8ea1bc` | `80acd0d` | the release commit; tree identical to staging |
| `claude/datiq-invoicing-model-e16ea3` | `6194b0b` | the original 4 invoicing commits; 1 behind the release branch |

`staging` is 7 commits ahead of `main` (4 invoicing + 1 release + 1 handoff + the
merge commit). `git diff claude/prod-db-migration-commands-8ea1bc staging` is
**empty** — the merge introduced nothing beyond what was verified.

### Netlify configuration — audited and corrected 2026-07-27

Read with `netlify api getSite --data '{"site_id":"0ac65a7e-bd3f-4cde-a8d3-66c23899c473"}'`.

| Setting | Value | Note |
|---|---|---|
| `custom_domain` | `datiq.app` | ✅ |
| `domain_aliases` | `[]` | ✅ the `staging.datiq.app` alias was the root of the misroute |
| `branch_deploy_custom_domain` | `datiq.app` | ✅ a **base** domain — Netlify serves `<branch>.<base>` |
| `published_deploy.locked` | `true` | ✅ **keep it** — this is what stops a push to `main` bypassing the phase gate |
| `force_ssl` | `true` | ✅ |
| `allowed_branches` | `['main','staging']` | ✅ |
| DNS zone | `datiq.app`, `www.datiq.app`, `*.datiq.app` | ✅ on Netlify DNS (`nsone.net`) |
| Functions on staging | 23, incl. all 5 new billing ones | ✅ `admin-billing`, `billing-lifecycle`, `billing-purge`, `invoice-email`, `invoice-pdf` |
| `PURGE_ENABLED` | **unset** | ✅ was briefly `1` in all three contexts — keep unset |
| `SUPPLIER_GSTIN` | **unset** | ✅ documents stay Payment Receipts until CA review |
| `SUPPLIER_STATE` | **unset** | ⚠️ set to `Maharashtra` (not `Mahareshatra, India`) **before** setting GSTIN |
| Env vars | 49 total | `BILLING_EMAIL_FROM`, `RESEND_API_KEY`, `SUPABASE_URL`/`SERVICE_KEY` all present ✅ |

Two pre-existing items carried forward: `ADMIN_PIN_HASH` is a single value shared
across contexts (should be per-context), and `SUPABASE_ACCESS_TOKEN` is present in
Netlify env — a Supabase *management* token is broader than the service key the
functions actually need, so it is worth reviewing whether it belongs there.

### Gate at merge (run on the staging merge commit, not just the branch)

unit **1436** · contract **496** (+14 skipped) · integration **205** · system **7** ·
db **89** · e2e **98** · build clean · `run-all.sql` current ·
readiness **6 pass · 1 warn · 0 fail**.

The single remaining WARN is **gallery / persona coverage**, which is unprovable
from source by design (the gallery is populated at runtime from Supabase
`public_reports`). It needs a manual confirmation of ≥1 curated sample per persona.

---

## 3. Next session — do these, in this order

1. ~~Confirm the Staging Gate run~~ — **DONE this session. Run `30238457217` for
   `0b207cf` is green on all four jobs** (Vulnerabilities, Open Issues/Defects,
   Test Suites, Deployed & Smoke Tested 12/12). The gate confirmed Netlify
   converged on `0b207cfcc7e24d6934b766cc23ac61b16f27615e` before smoking, and
   `npm run smoke:staging` re-run locally is 10/10.

   ### 🔴 None of the four cron functions was ever scheduled — fixed, verify in production

   The biggest defect found this session, and it had been live since R19.
   `scheduled-runner`, `reengagement`, `billing-lifecycle` and `billing-purge` were
   all deploying as **ordinary HTTP functions**. So the hourly change-detection
   runner had never run, and `billing-lifecycle` — the entire subscription
   lifecycle and dunning engine this release ships — would never have fired at all.

   **Cause:** each declares `export const config = { schedule: … }` beside
   `export const handler`. That export is honoured **only for v2 functions**
   (`export default`). All of ours are v1, and `@netlify/functions` is not a
   dependency, so the v1 `schedule()` wrapper is not in use either. `netlify.toml`
   declared no schedules, so nothing registered them.

   **Three independent confirmations** on the staging deploy: Netlify's
   `searchSiteFunctions` API reported `schedule: null` for every function;
   `GET /.netlify/functions/reengagement` returned **200 and ran the handler**
   ("Re-engagement complete. 0 email(s) sent."); deployed functions report
   `runtimeAPIVersion: 1`.

   **Fixed** in `netlify.toml` via `[functions."<name>"] schedule = …` for all four
   — the v1-compatible path — plus a note in each source file so the ignored
   `config` export is never trusted again. This also closed an exposure: as a plain
   function, **`billing-purge`, the only destructive job in the system, was a
   publicly reachable HTTP endpoint.**

   ⚠️ **Verification is only possible in production.** Netlify runs scheduled
   functions for the **production deploy only**, so a 200 on a branch deploy
   neither proves nor disproves registration. Once this reaches `main`:

   ```bash
   netlify api searchSiteFunctions --data '{"site_id":"0ac65a7e-bd3f-4cde-a8d3-66c23899c473"}'
   # expect a non-null "schedule" for all four
   curl -s -o /dev/null -w '%{http_code}\n' https://datiq.app/.netlify/functions/reengagement
   # expect 404 — registered scheduled functions are not HTTP-invocable
   ```

   Until that is confirmed, **treat the lifecycle/dunning system as not running.**

   ### `staging.datiq.app` — fixed in Netlify after two wrong turns

   Found and fixed this session, and it is worse than the old note suggested.

   The hostname was a plain **domain alias on the production site**, so it served
   the site's *published* (production) deploy — bundle `index-BFw7HNTs.js`,
   identical to `datiq.app`, versus the staging deploy's `index-ngjyYV0n.js`;
   homepage MD5 `ef6c88c6d52e` vs `a62346cc14b1`; all four release artifacts absent.
   That **supersedes the 2026-07-25 "not provisioned / no cert" note** — TLS worked,
   which is exactly why it failed *silently* instead of erroring.

   **Two fixes were tried and did not work. Do not repeat either.**

   1. **Repointing DNS.** The CNAME was changed to `staging--datiqapp.netlify.app`
      and **nothing changed** — that host and `datiqapp.netlify.app` resolve to the
      *same* Netlify edge IPs (`52.74.6.109`, `13.215.239.219`), and Netlify picks
      the deploy from the **`Host` header**, not the IP or the CNAME target.
   2. **`branch_deploy_custom_domain = staging.datiq.app`.** That field is a **base**
      domain — Netlify serves `<branch>.<base>`. Proven: `staging.staging.datiq.app`
      served the staging build and `main.staging.datiq.app` the main build, while the
      bare name resolved to nothing. It also polluted production deploy URLs
      (`…6a65b51f….staging.datiq.app`).

   **The correct configuration, now applied:**
   - `branch_deploy_custom_domain = datiq.app` (so branch `staging` → `staging.datiq.app`)
   - `domain_aliases = []`
   - zone: `datiq.app`, `www.datiq.app`, wildcard `*.datiq.app`

   Netlify now reports the staging deploy's own URL as `https://staging.datiq.app`,
   production deploy URLs are clean again, and the certificate has been re-issued as
   a proper wildcard (`SAN: *.datiq.app, datiq.app`, replacing the alias-era
   `datiq.app, staging.datiq.app, www.datiq.app`). So TLS is ready.

   ### ⚠️ STILL OPEN: `staging.datiq.app` does not resolve

   **This did not resolve itself, and a fresh branch deploy did not fix it** — tested
   after the `ac82be0` deploy completed. Current symptom:

   - `dig @dns1.p01.nsone.net staging.datiq.app` → **NODATA** (authoritative, so not
     a caching artifact)
   - `https://staging.datiq.app/` → `http=000`
   - but the wildcard **does** answer for other names: `foo-test-27070.datiq.app`
     resolves to the Netlify edge

   A wildcard `*.datiq.app` NETLIFY record exists and works, yet this one specific
   name returns nothing. That points to Netlify holding a **pending claim** on
   `staging.datiq.app` that shadows the wildcard rather than resolving.

   **Next action (Netlify UI):** re-add `staging.datiq.app` as the branch subdomain
   for `staging` (Domain management → branch subdomains). If the UI errors — it did
   once already, Request ID `01KYHE6WPK5Q8SP7DPQW3TA7NJ`, on an object that no longer
   existed — that Request ID is what Netlify support needs.

   This is **not** blocking: the release is fully verified on
   `staging--datiqapp.netlify.app`, and the CI gate already targets that host.

   **Two things were wrong in-repo, both now fixed:**
   1. `package.json`'s `smoke:staging` targeted that hostname, so it was
      **smoke-testing production while reporting on staging**. Now
      `${STAGING_URL:-https://staging--datiqapp.netlify.app}`, matching CI. Verified
      10/10 against the real staging deploy.
   2. `staging-gate.yml` and `phase-gate.yml` both advised "once `staging.datiq.app`
      is a domain alias and its cert issues, set `STAGING_URL` to it". **That
      condition has now been met, so following that advice would make the
      phase-gate's staging smoke test production — while that green is what gates a
      production release.** The advice is removed and replaced with the reasoning.

   **Verify by build identity, never by a 200** — a 200 is exactly what made the
   original misroute look healthy:

   ```bash
   curl -s https://staging.datiq.app/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'
   ```

   Anything other than the current staging bundle (and specifically
   `index-BFw7HNTs.js`, the production one) means it is still wrong. Until it returns
   the staging bundle, verify staging at `staging--datiqapp.netlify.app` and leave
   the `STAGING_URL` repo variable unset.
2. **Apply `0012`–`0017` to a scratch Supabase project** per the runbook. This is
   the last unverified surface (§1.2).
3. **Decide the migration staging before touching a DB with real users.**
   `npm run migrate:prod` has **no stop-at-N flag** — a bare run applies
   `0001`→`0017` in one pass, `0014` (the RLS flip) included. Correct on a fresh
   project, wrong where `0012` must ship for a release cycle first. Runbook §4 has
   the subset applier.
4. **Read the orphan count before `0014`.** `0013` reports it via `raise notice`,
   which the runner swallows. Runbook §6.2 has the query — and it needs `0012`
   first; on a pre-`0012` DB it fails with `42703: column "user_id" does not
   exist`, which is the signal that `0012` has not run, not a bad query.
5. **Drive one real Razorpay test-mode payment end to end.** Confirm one invoice
   row, one number, one email with a `%PDF-` attachment, `taxable+tax===total`.
   The DB layer is proven; the provider → invoice → email path is not.
6. **Only then consider production.** See §4.

---

## 4. Production is a separate gate — two human acts, by design

Do **not** treat a green staging as permission to ship.

1. **Netlify production deploys are LOCKED.** That lock is the protection that
   stops a push to `main` bypassing the gate, and it blocks **every** publish path
   including `netlify deploy --prod`. Releasing requires (a) unlocking production
   in the Netlify UI, then (b) commenting `approved` on the approval issue.
   `deploy-production` only *verifies* the unlock and fails fast; `relock-production`
   re-locks at the end, so every release needs a fresh unlock.
2. **Never "fix" a lock error with `--prod-if-unlocked`.** While locked, that makes
   a DRAFT deploy — the smoke job then tests *old* production and passes, and the
   run claims a release that never shipped.

Also still true before production: leave **`PURGE_ENABLED` unset** (the purge is
the only destructive job; arm it only after `billing-lifecycle` has run cleanly for
a full cycle, and with `PURGE_DRY_RUN=1` first), and **do not set
`SUPPLIER_GSTIN`** until a CA has reviewed one rendered invoice — noting that
checkout *already* adds 18% labelled GST to every INR charge, which is its own review.

---

## 5. Accepted risk carried forward

| Item | Assessment |
|---|---|
| **`npm run test:security` is a stub that always passes** — prints "M0 stub passed — full scan lands in M6" and exits 0. It is the last step of `test:all`, so the pipeline presents a security gate it does not have. | Not a regression, but do not read it as coverage. Real work is M6. |
| 2 high-severity advisories in `react-router` / `react-router-dom` (GHSA-qwww-vcr4-c8h2, RSC-mode CSRF bypass). | Already **formally bypassed** with a TODO expiring **2026-12-31** (React 19 + react-router 8); `scripts/check-vulnerabilities.mjs` passes. DatIQ runs SPA mode, not RSC. Tracked and time-boxed. |
| **`reengagement.js:182` selects `user_email` from `scheduled_tasks`, which has no such column** — the query 400s, the error is swallowed, so that cron is a **silent no-op in production**. | **Verified against the executed schema**: `scheduled_tasks` is exactly `created_at, cron, data, id, next_run_at, status, system_pause_reason, system_paused, updated_at, user_id`. `user_email` exists on `reengagement_log` (0011) and in 0017 — never on `scheduled_tasks`. Pre-existing; the new billing crons key on `user_id`. |
| `usage_records` / `usage_alerts` keep `anon full access`. | A privacy leak, **not** an entitlement escalation. Locking them breaks guest usage sync; move guest writes behind a function first. |
| Unbuilt from the invoicing scope: `/admin/billing` UI (API + 34 tests exist, no consumer), billing-details capture UI, proration wired into checkout, `PlanChangeWarning` unmounted, scheduled-downgrade UI, e2e specs for suspended/invoice-download. | Feature gaps, not correctness risks. |
| The Stripe branch writes no invoice draft — only Razorpay does. | Must be added when Stripe is re-enabled (deferred to v2.0). |
| **No auto-renewal.** v1.0 uses one-time Razorpay Orders, so a "scheduled downgrade" records intent for the next purchase and the account lapses to `suspended` in the same sweep. | Razorpay Subscriptions / UPI Autopay is the highest-value follow-up; the `subscription.charged` / `.cancelled` webhook handlers already exist and are unused. |

---

## 6. New in the repo this session

```
scripts/db-verify.mjs                                  NEW — the DB gate (npm run test:db)
docs/DB-MIGRATION-RUNBOOK.md                           NEW — commands, staged apply, verification SQL
docs/RELEASE-READINESS-2026-07-27-INVOICING.md          NEW — the pre-merge issue register
docs/SESSION-HANDOFF-2026-07-27-MIGRATIONS-EXECUTED…   NEW — this file
docs/assets/screenshots/10-account-billing.png         NEW — invoices card
package.json                                           +test:db, +@electric-sql/pglite (dev), test:all wired
docs/capture-screenshots.mjs                           tour dismissal + account shot
docs/build-help.mjs                                    prunes stale generated pages
src/pages/Changelog.jsx                                admin leak removed, +6 features
src/pages/Blog.jsx                                     +release post
docs/DatIQ-User-Guide.md                               +invoices/lapse sections
public/llms.txt                                        +billing line
public/help/15-glossary.html                           DELETED (stale orphan)
```
