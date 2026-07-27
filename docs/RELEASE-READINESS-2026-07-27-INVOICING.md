# Release readiness — invoicing & subscription lifecycle (2026-07-27)

> **Status: green locally, NOT merged. Merge to `staging` is deliberately held pending explicit instruction.**
>
> Branch: `claude/prod-db-migration-commands-8ea1bc`
> Contents: the 4 invoicing/lifecycle commits (`26b9374` → `6194b0b`) + the
> release-readiness work recorded here.
> Gate: `node .claude/skills/production-readiness/scripts/audit.mjs` → **0 FAIL**.

This is the pre-merge issue register. Section 1 is what must be true before
`staging`; section 2 is what must be true before `main`; section 3 is what was
found and fixed getting here; section 4 is accepted risk.

---

## 0. Verification performed

| Gate | Result |
|---|---|
| `npm run test:unit` | **1436 passed** / 96 files |
| `npm run test:contract` | **496 passed**, 14 skipped / 35 files |
| `npm run test:integration` | **205 passed** / 38 files |
| `npm run test:system` | **7 passed** / 5 files |
| `npm run test:db` (**new**) | **17 migrations applied · 89 assertions passed** |
| `npm run build` | clean, 713 ms |
| `npm run test:e2e:smoke` | **98 passed**, 1.2 min (chromium) |
| `npm run test:security` | passes — but see §4.1, it is a stub |
| `node scripts/check-vulnerabilities.mjs` | pass (2 advisories formally bypassed — §4.2) |
| readiness audit | **6 pass · 1 warn · 0 fail** |
| `npm run build:sql -- --check` | `run-all.sql` up to date (17 migrations) |

### What `npm run test:db` proves — and what it does not

New in this release: [scripts/db-verify.mjs](../scripts/db-verify.mjs) applies
every numbered migration to **in-process WASM Postgres (PGlite)** and then
exercises what they create. It runs in ~5 seconds with no Docker, no psql, no
network and no credentials, which is why it can be a permanent gate — it is
wired into `npm run test:all`.

**Executed for the first time ever, and passing:**

- All **17** migrations apply cleanly in order → 26 tables, 9 functions,
  2 triggers, 66 indexes, 20 policies, **0 tables without RLS**.
- `fy_of()` — the FY boundary is 1 April **IST**. Proven with the case that
  matters: `2026-03-31 18:31Z` is FY **26-27**, which a UTC implementation would
  get wrong.
- `next_invoice_no()` — zero-padded, per-`(series, fy)` independent, restarts at
  1 in a new FY, and **a rollback leaves no gap** (the reason it is a counter
  table and not a sequence).
- `issue_invoice()` — idempotent on replay by `(provider, provider_payment_id)`:
  second call returns `created:false` with the *same* invoice number, no
  duplicate row, no duplicated lines. `taxable + tax === total` and
  `cgst + sgst === tax` both hold.
- `invoices_immutable` trigger — blocks `total_minor`, `invoice_no`, and
  re-pointing a set `user_id`; allows `status` / `refunded_minor` / `pdf_path` /
  `pdf_sha256` and the NULL→set guest adoption; bumps `updated_at`.
- `plan_rank()` — full ordering, case-insensitive, and **unknown plans rank 0** so
  they can never win a merge.
- `merge_entitlement_from_subscriptions()` — never downgrades (free does not
  displace pro; agency does upgrade pro), version increments, null user no-ops.
- `claim_billing_session()` — `no_auth` without a JWT, stamps `user_id` on all
  three tables, is idempotent for the same user, and **refuses a different user**
  (`already_linked`) without moving `user_id`.
- `redeem_coupon()` — `ok` / `already_redeemed` / `cap_reached`, the cap-reached
  path rolls its own redemption row back, and the counter stops exactly at the cap.
- **RLS as `role=authenticated`** — an owner sees exactly their own invoices and
  strictly fewer than the table holds; another user sees none of them and no
  subscription rows; `authenticated` can neither INSERT invoices nor UPDATE
  subscriptions.
- 0015's column-level REVOKE on `system_paused` / `system_pause_reason` is in force.

**Zero defects were found in the migrations.** Every failure during development
was a bug in the harness (jsonb key ordering, a `void` return, a guessed column
name), not in the SQL.

**What it does NOT prove — still required before production:**

- PGlite has **no GoTrue, no PostgREST, no Supabase roles**. `auth.users`,
  `auth.uid()` and `anon`/`authenticated`/`service_role` are shims. Grants are
  asserted structurally, not through the real PostgREST request path.
- It says nothing about connection strings, the pooler, Supabase's own default
  grants, or extensions available only on Supabase.
- **The scratch-project apply in [DB-MIGRATION-RUNBOOK.md](DB-MIGRATION-RUNBOOK.md)
  is still mandatory.** This gate makes that apply boring; it does not replace it.

---

## 1. Blockers / required before merge to `staging`

Nothing here blocks the merge mechanically — the gate is 0 FAIL. These are the
decisions and manual acts that must be *acknowledged* first.

| # | Item | Why it matters |
|---|---|---|
| 1.1 | **Apply 0012–0017 to a scratch Supabase project.** | PGlite is not Supabase (§0). This is the last unverified surface, and the runbook now has exact commands and verification SQL. |
| 1.2 | **Decide the migration staging.** `npm run migrate:prod` has **no stop-at-N flag** — a bare run applies `0001`→`0017` in one pass, `0014` (the RLS flip) included. Correct for a scratch/fresh DB, **wrong** for a DB with real users, where `0012` must ship for a release cycle first. | Runbook §4 has a subset applier. Getting this wrong hides guest payment history earlier than intended. |
| 1.3 | **Read the orphan count before `0014`.** `0013` reports it via `raise notice`, which the runner swallows. | Runbook §6.2 has the query. It requires `0012` first — on a pre-`0012` DB it fails with `42703: column "user_id" does not exist`, which is the signal that `0012` has not run, not a bad query. |
| 1.4 | **Leave `PURGE_ENABLED` unset.** | The purge is the only destructive job. It ships disarmed and must stay that way until `billing-lifecycle` has run cleanly for a full cycle, then `PURGE_DRY_RUN=1` first. |
| 1.5 | **Do not set `SUPPLIER_GSTIN` yet.** | Setting it flips every document from Payment Receipt to Tax Invoice. Needs a CA review of one rendered invoice first — and note checkout **already** adds 18% labelled GST to every INR charge, which is its own review. |

## 2. Required before merge to `main` (production)

| # | Item |
|---|---|
| 2.1 | ✅ **Done.** Staging Gate run `30238457217` for `0b207cf` is green on all four jobs (Deployed & Smoke Tested 12/12, after confirming Netlify converged on the exact SHA); `npm run smoke:staging` re-run locally is 10/10 against `staging--datiqapp.netlify.app`. ⚠️ **But see §4.9 — `staging.datiq.app` serves PRODUCTION**, and `smoke:staging` used to point there, so any earlier "staging is green" from that command proved nothing. |
| 2.2 | **Netlify production must be manually unlocked**, then `approved` commented on the approval issue. Two deliberate human acts. Do **not** work around a lock error with `--prod-if-unlocked` — while locked that makes a DRAFT deploy and the smoke job then passes against *old* production, claiming a release that never shipped. |
| 2.3 | Drive **one real Razorpay test-mode payment end to end** and confirm: one invoice row, one number, one email with a `%PDF-` attachment, and `taxable + tax === total`. The DB layer is proven (§0); the provider→invoice→email path is not. |

## 3. Found and fixed in this pass

| # | Issue | Fix |
|---|---|---|
| 3.1 | **`docs/capture-screenshots.mjs` was broken.** The onboarding tour auto-starts on a fresh profile and its full-screen backdrop swallowed every click, so the first click (theme toggle) retried until timeout and **no screenshots were written at all**. This is why the readiness audit had been stuck warning "regenerate screenshots" — nobody could. | Seed `datiq.onboardingTour.v1` as completed via `addInitScript` before any navigation. All 10 shots now capture. |
| 3.2 | **`public/help/15-glossary.html` was a stale orphan**, still publicly served, carrying a sidebar that predated the section renumber and omitted Keyboard shortcuts entirely. `build-help.mjs` wrote pages but never pruned them, so every renumber leaves a wrong page live. | Added pruning to `build-help.mjs` (scoped to files the generator owns) and removed the orphan. It now self-heals. |
| 3.3 | **Admin leaked onto a public surface.** `src/pages/Changelog.jsx`'s SEO meta description advertised an "admin" capability area — on the public changelog page, and inaccurately, since `FEATURE_GROUPS` has no admin group. The audit's term list did not catch a bare "admin" in prose. | Removed. Verified in-browser: 0 admin mentions on the rendered page. |
| 3.4 | **The public user guide had zero mention of invoices** — the headline feature of this release. | Added §11 "Invoices & receipts" and "If a plan lapses", plus a lapse note in §8 Scheduling. Rebuilt help. Hedged to what actually ships: receipt-or-tax-invoice, and **no deletion promise**, because the purge is disarmed. |
| 3.5 | **The migrations had never been executed anywhere.** | `npm run test:db` (§0), wired into `test:all`. |
| 3.6 | Changelog feature listing and `llms.txt` did not mention invoicing; no release blog. | 6 items added to Plans & payments (87 features / 11 areas), a billing line in `llms.txt`, and a release blog post + a new `10-account-billing.png` screenshot focused on the invoices card. |
| 3.7 | The migration commands were undocumented and the runner's limits unknown. | [DB-MIGRATION-RUNBOOK.md](DB-MIGRATION-RUNBOOK.md) — commands, the no-stop-at-N limitation, subset applier, state probe, verification SQL, failure modes. |

## 4. Accepted risk / known and not fixed here

| # | Item | Assessment |
|---|---|---|
| 4.1 | **`npm run test:security` is a stub that always passes** — it prints "M0 stub passed — full scan lands in M6" and exits 0. It is the last step of `test:all`, so the pipeline presents a security gate it does not have. | Not a regression and not introduced here, but it should not be mistaken for coverage. Real work is M6. |
| 4.2 | **2 high-severity advisories** in `react-router` / `react-router-dom` (GHSA-qwww-vcr4-c8h2, RSC-mode CSRF bypass). | Already **formally bypassed** with a documented TODO expiring **2026-12-31** (upgrade to React 19 + react-router 8), and `scripts/check-vulnerabilities.mjs` passes. DatIQ runs SPA mode, not RSC. Tracked, time-boxed, not a new finding. |
| 4.3 | ~~Readiness WARN: screenshot integrity~~ — **RESOLVED.** | The check compares **git commit time**, not mtime, so it stayed WARN while the regenerated screenshots were uncommitted. Clean after the commit: the audit is now **6 pass · 1 warn · 0 fail**. |
| 4.4 | Readiness WARN: **gallery / persona coverage**. | Unprovable from source by design — the gallery is populated at runtime from Supabase `public_reports`. Needs a manual confirmation of ≥1 curated sample per persona; carried forward. |
| 4.5 | `usage_records` / `usage_alerts` keep `anon full access`. | A privacy leak, **not** an entitlement escalation. Locking them breaks guest usage sync; guest writes must move behind a function first. Pre-existing, carried forward. |
| 4.6 | **`reengagement.js:182` selects `user_email` from `scheduled_tasks`, which has no such column** — the query 400s, the error is swallowed, so that cron is a **silent no-op in production**. | **Verified against the executed schema**, not taken from the handoff: `scheduled_tasks` is exactly `created_at, cron, data, id, next_run_at, status, system_pause_reason, system_paused, updated_at, user_id`. `user_email` does exist — but on `reengagement_log` (0011) and in 0017 — never on `scheduled_tasks`. Pre-existing, out of scope here; the new billing crons key on `user_id` and avoid the pattern. |
| 4.7 | Still unbuilt from the invoicing scope: `/admin/billing` UI (API + 34 tests exist, no consumer), billing-details capture UI, proration wired into checkout, `PlanChangeWarning` not mounted, scheduled-downgrade UI, e2e specs for suspended/invoice-download. | Feature gaps, not correctness risks. Full list in the session handoff. |
| 4.8 | The Stripe branch writes no invoice draft — only Razorpay does. | Must be added when Stripe is re-enabled (it is deferred to v2.0). |
| 4.9 | **`staging.datiq.app` is aliased to the PRODUCTION deploy, and `npm run smoke:staging` pointed at it.** Found while verifying this release actually deployed. | The script has been fixed to `${STAGING_URL:-https://staging--datiqapp.netlify.app}` (what CI already used), so the hazard is closed in-repo. **The DNS/alias itself is still wrong and is an open infrastructure task.** Evidence: `staging.datiq.app` and `datiq.app` return the identical homepage MD5 `ef6c88c6d52e` while the staging deploy is `a62346cc14b1`, and `staging.datiq.app` lacks all four release artifacts. This is the same silent-pass shape as the `--prod-if-unlocked` trap in §2.2: the command reports green while testing the wrong deploy. Until the alias is repointed, treat `staging.datiq.app` as production. |

## 5. Branch consistency

- `claude/prod-db-migration-commands-8ea1bc` and `claude/datiq-invoicing-model-e16ea3`
  both sit on the same 4 invoicing commits; this branch adds the readiness work.
  No divergence, nothing to reconcile.
- 0 commits behind `main`, so the merge is a clean fast-forward-able history.
- `run-all.sql` is generated — `npm run build:sql -- --check` before merging if any
  migration changed.

## 6. Promotion sequence (held)

```bash
node .claude/skills/production-readiness/scripts/audit.mjs   # expect 0 FAIL
npm run test:all
```

Then, **only on explicit instruction**, per
`.claude/skills/production-readiness/references/merge-and-deploy.md`:

```bash
git checkout staging
git merge --no-ff claude/prod-db-migration-commands-8ea1bc
git push origin staging
npm run smoke:staging
```

Production is a separate decision gated on §2.
