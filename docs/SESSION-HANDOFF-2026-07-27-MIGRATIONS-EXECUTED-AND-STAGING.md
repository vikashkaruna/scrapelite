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

   ### ⚠️ `staging.datiq.app` SERVES PRODUCTION — never smoke-test it, never set `STAGING_URL` to it

   Found and fixed this session, and it is worse than the old note suggested.

   ### ⚠️ DNS IS NOT THE CAUSE — do not "fix" the CNAME again

   The CNAME was already repointed to `staging--datiqapp.netlify.app` (confirmed
   across system / 1.1.1.1 / 8.8.8.8 **and the authoritative NS**
   `athena.dns-parking.com`) and **the content did not change at all.** DNS is now
   correct and the hostname still serves production.

   The reason: `staging--datiqapp.netlify.app` and `datiqapp.netlify.app` resolve to
   the **same Netlify edge IPs** (`52.74.6.109`, `13.215.239.219`). Netlify selects
   the deploy from the **`Host` header**, not from the IP or the CNAME target. Since
   `staging.datiq.app` is registered as a **domain alias on the site**, that Host
   maps to the site's *published* (production) deploy. So no DNS change can fix this
   — it must be fixed in Netlify's domain configuration.

   **Proven, not inferred:**
   - Build identity (per-build bundle hash, the strongest signal):
     `staging.datiq.app` → `/assets/index-BFw7HNTs.js`;
     `datiq.app` → the **same** `index-BFw7HNTs.js`;
     `staging--datiqapp.netlify.app` → `index-ngjyYV0n.js`.
   - Content: homepage MD5 identical to `datiq.app` (`ef6c88c6d52e`); the real
     staging deploy is `a62346cc14b1`. All four release artifacts (new screenshot,
     `llms.txt` billing line, help invoices section, pruned orphan page) are present
     on the branch deploy and **absent** on `staging.datiq.app`.
   - TLS: cert is `CN=datiq.app`, SAN `datiq.app, staging.datiq.app, www.datiq.app`
     — one production certificate covering it, i.e. the alias relationship is intact.

   This **supersedes the 2026-07-25 "not provisioned / no cert" note** — TLS works
   now, which is exactly why this is worse than the old outage: it fails silently
   instead of erroring.

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

   **Open infra task — Netlify UI only, DNS is already correct.** On site
   `datiqapp` → **Domain management**:
   1. **Remove** `staging.datiq.app` as a domain alias on the site.
   2. **Re-add it as a branch subdomain bound to the `staging` branch** (branch
      deploys must be enabled for `staging`).

   Then verify by build identity, not by a 200: `staging.datiq.app` must serve
   `/assets/index-ngjyYV0n.js` (the staging build), **not** `index-BFw7HNTs.js` (the
   production build). Until it does, verify staging only at
   `staging--datiqapp.netlify.app` and leave `STAGING_URL` unset.
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
