# Test Execution Record — DatIQ Intelligence Workflows (PRD 1–5)

> **Environment:** staging (`staging--datiqapp.netlify.app`, Supabase project `aubwoo…`)
> **Scope:** Phases 0–7 plus the three execution engines added 2026-09-04 (PRD 3 durability,
> PRD 4 crawler/differ, PRD 5 dispatcher).
> **Companion documents:** `WORKFLOWS-CONFORMANCE-REVIEW-2026-09-04.md` (findings),
> `INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md` (status board),
> `MANUAL-TEST-INTELLIGENCE-WORKFLOWS.md` (the 137-check manual pass).
>
> 🔒 **No credential appears in this document, by policy.** The staging test account is
> referred to as `<STAGING_TEST_EMAIL>` throughout. Its password lives only in the operator's
> own password manager and in `STAGING_TEST_PASSWORD` in a local shell. Nothing in this
> repository reads, stores, prints, or logs either value — `scripts/seed-staging-test-account.mjs`
> masks the address in its own output and refuses to run without the env vars.

---

## 0. Execution status at a glance

| Suite | Cases | Passed | Failed | Result |
|---|---:|---:|---:|---|
| TS-1 Unit (pure models) | 2 905 | 2 905 | 0 | ✅ |
| TS-2 Contract (Netlify functions) | 1 951 | 1 951 | 0 | ✅ (+14 skipped) |
| TS-3 Integration | 411 | 411 | 0 | ✅ |
| TS-4 System | 8 | 8 | 0 | ✅ |
| TS-5 Database (WASM Postgres, 45 migrations) | 461 | 461 | 0 | ✅ |
| TS-6 Referral E2E (real Postgres) | 17 | 17 | 0 | ✅ |
| TS-7 Playwright smoke (chromium) | 132 | 131 | 0 | ✅ (1 skipped by design) |
| TS-8 Build / prerender / security / readiness | 4 gates | 4 | 0 | ✅ |
| **TS-9 Live staging, authenticated** | 24 | — | — | ⏸ **operator-run — see §6** |
| **TS-10 Live staging, unauthenticated (security)** | 15 | 15 | 0 | ✅ **`0044` applied — verified live, see §7** |

**Automated total: 5 753 assertions across 8 suites, 0 failures. TS-10 verified live: 15/15.**
TS-9 remains operator-run: it needs a signed-in staging session, and account creation and password
handling are outside what this agent may do. It is recorded ⏸ rather than passed because marking it
green on the strength of the automated suites would be the same "the pipeline said success" mistake
this whole review exists to correct. See §8 Deviations.

---

## 1. What was under test

| PRD | Feature | Engine added this pass |
|---|---|---|
| 1 | Workflow templates & guided onboarding | — (already complete) |
| 2 | Shareable intelligence reports | — (already complete) |
| 3 | Bulk account intelligence | `bulk-runner.js` cron + **real** enrichment (`bulkEnrich.js`) |
| 4 | Competitor watchlists & change intelligence | `watchlist-monitor.js` cron + `snapshotModel.js` differ |
| 5 | Native signal routing | `signalDispatch.js` — the dispatcher that never existed |

---

## 2. TS-1 · Unit — pure models

Run: `npx vitest run src scripts --exclude '**/*.integration.test.*' --exclude '**/__tests__/system/**'`

| ID | Scenario | Input | Expected | Result |
|---|---|---|---|---|
| U-SNAP-01 | Price extraction reads real prices | Pricing page text with `$0`, `$49`, `$99` | All three captured in `pricing.amounts` | ✅ |
| U-SNAP-02 | Plan names come from headings only | Body prose `"We provide a process for product teams"` | `pricing.tiers` **undefined** — "provide/process/product" must not become a plan ladder | ✅ |
| U-SNAP-03 | A year is not a price | `"Founded in 2019. Trusted by 500 companies."` | `pricing.amounts` undefined | ✅ |
| U-SNAP-04 | Unobservable field is omitted, not defaulted | Empty page | `observed === 0`, no fields invented | ✅ |
| U-SNAP-05 | Determinism | Same page extracted twice | Identical fields **and** identical hash | ✅ |
| U-SNAP-06 | Whitespace reflow is not a change | `"Simple   pricing"` vs `"Simple pricing"` | Same hash | ✅ |
| U-SNAP-07 | 🔴 Absence is not deletion | prev `{pricing.amounts:"$49"}` → current `{}` | **No change reported** | ✅ |
| U-SNAP-08 | A real move is reported with both sides | `$49` → `$59` | One change, old and new both present | ✅ |
| U-SNAP-09 | Newly observed field reads as an addition | `{}` → `{pricing.tiers:"Free \| Pro"}` | `oldValue === ""` | ✅ |
| U-SNAP-10 | Null inputs do not throw | `diffSnapshots(null, {a:"1"})` | One change, no exception | ✅ |
| U-SNAP-11–24 | URL classification, hash stability, normalisation caps | — | — | ✅ 14/14 |
| U-ENT-01 | `bulk.enrich` within allowance | Free plan, 3 domains | Allowed | ✅ |
| U-ENT-02 | `bulk.enrich` over allowance | Free plan, 500 domains | Denied `PLAN_LIMIT` | ✅ |
| U-ENT-03 | Batch bundles raise the bulk ceiling | Free + 50 bonus | Allowed | ✅ |
| U-ENT-04 | `watchlist.create` with no monitoring in plan | Free plan | Denied `PLAN_REQUIRED` | ✅ |
| U-ENT-05 | `watchlist.create` at cap | Select at its cap | Denied | ✅ |
| U-ENT-06 | `rule.create` agrees with `integrations` | Every paid plan | Verdicts identical | ✅ |
| U-JOB-01 | Registry pins all eight platform jobs | `AUTOMATION_JOBS` | Exact list incl. the two new crons | ✅ |

**Suite total: 2 905 passed / 0 failed** (172 files).

---

## 3. TS-2 · Contract — Netlify functions

Run: `npx vitest run netlify`

### 3.1 Tenancy and entitlement (`workflow-tenancy.test.js`, 25 cases)

| ID | Scenario | Input | Expected | Result |
|---|---|---|---|---|
| C-TEN-01..03 | Unauthenticated GET on each of the three endpoints | No `Authorization` header | **401**, empty body, **zero database calls** | ✅ ×9 |
| C-TEN-04 | Unauthenticated POST | No header | 401, nothing written | ✅ ×3 |
| C-TEN-05 | Cross-tenant change injection | `record_change` on a watchlist the caller does not own | **404** (not 403 — no id enumeration), no `field_changes` insert | ✅ |
| C-TEN-06 | Owner id cannot come from the body | Body carries `user_id: "user-2"` | `user-2` never reaches any outbound request | ✅ |
| C-TEN-07 | Cross-tenant job advance | `process_chunk` on another tenant's job | 404 | ✅ |
| C-TEN-08 | Bulk plan cap | Free plan, 50 domains | **402**, no `/lists` write | ✅ |
| C-TEN-09 | Rule creation without integrations | Free plan | 402 | ✅ |
| C-TEN-10 | SSRF destinations refused | `169.254.169.254`, `127.0.0.1`, `10.0.0.5`, `file://` | 400 each, no row written | ✅ |
| C-TEN-11 | Slack action pinned to Slack | `https://attacker.example.com` | 400 | ✅ |
| C-TEN-12 | Email header injection | `to: "ok@x.com\nBcc: …"` | 400 | ✅ |

### 3.2 Signal dispatch (`signalDispatch.test.js`, 18 cases) — **PRD 5's "Must" set**

| ID | Scenario | Input | Expected | Result |
|---|---|---|---|---|
| C-DSP-01 | Canonical event vocabulary complete | — | All 10 PRD event kinds present | ✅ |
| C-DSP-02 | Unknown kind refused loudly | `monitor.typo` | `unknown_event_kind`, nothing dispatched | ✅ |
| C-DSP-03 | Event with no owner refused | no `userId` | `event_has_no_owner` | ✅ |
| C-DSP-04 | Slack action fires | critical change event | One POST to `hooks.slack.com` | ✅ |
| C-DSP-05 | **Execution history written** | as above | `rule_executions` row: status, payload, latency | ✅ |
| C-DSP-06 | Recorded payload carries the facts | as above | domain + field + kind present | ✅ |
| C-DSP-07 | Non-matching condition does not fire | rule requires `materiality in [low]`, event is `critical` | 0 fired, 0 recorded | ✅ |
| C-DSP-08 | Slack 404 is a recorded failure | Slack returns 404 | Run OK, action `failed`, error contains 404 | ✅ |
| C-DSP-09 | Network error caught | fetch throws | Recorded `failed`, no exception escapes | ✅ |
| C-DSP-10 | One broken rule does not starve the next | rule 1 throws, rule 2 succeeds | `["failed","success"]` | ✅ |
| C-DSP-11 | Unconfigured mailer is `skipped`, not `failed` | no `RESEND_API_KEY` | status `skipped` — an operator fault is not the user's rule breaking | ✅ |
| C-DSP-12 | 🔴 Destination re-validated **at dispatch** | stored rule pointing at `169.254.169.254` | `refused`, no fetch | ✅ |
| C-DSP-13 | Loopback / RFC1918 refused at dispatch | `127.0.0.1`, `10.0.0.5` | `refused` | ✅ |
| C-DSP-14 | Slack rule pointed elsewhere refused | `attacker.example.com` | `refused`, no fetch | ✅ |
| C-DSP-15 | HubSpot ignores a URL in the rule body | `action_config.url = attacker` | Only `api.hubapi.com` called | ✅ |
| C-DSP-16 | Tenancy on rule lookup | — | Only the event owner's rules returned (mock enforces `.eq` filters) | ✅ |
| C-DSP-17 | Fan-out capped | — | `MAX_ACTIONS_PER_EVENT ≤ 10` | ✅ |
| C-DSP-18 | Wrong trigger_source fires nothing | `report.shared` vs a `watchlist` rule | 0 fired | ✅ |

### 3.3 Execution engines (`workflow-engines.test.js`, 21 cases)

| ID | Scenario | Input | Expected | Result |
|---|---|---|---|---|
| C-CAD-01 | Never-checked target is due | `last_checked_at: null` | due | ✅ |
| C-CAD-02 | 🔴 Cadence honoured per tier | hourly@59m / daily@1h / weekly@6d | not due; hourly@61m, daily@25h, weekly@8d due | ✅ |
| C-CAD-03 | Unknown cadence falls back to daily | `"fortnightly"` | not due after 1h — does not crawl every run | ✅ |
| C-CAD-04 | Unparseable timestamp = never checked | `"not a date"` | due (fails toward action, not toward a frozen target) | ✅ |
| C-CAD-05 | Budget and fan-out caps declared | — | budget ≤ 26 s, target/page caps > 0 | ✅ |
| C-CAD-06 | Unconfigured Supabase skips cleanly | no service key | `skipped: supabase_unconfigured`, no throw | ✅ |
| C-RUN-01..03 | Bulk runner budget, job cap, stuck threshold | — | All declared and bounded | ✅ |
| C-ENR-01 | Observed fields read off the page | HTML with `/pricing` link, title, meta | `company_name`, `has_pricing`, provenance `observed`, confidence 1 | ✅ |
| C-ENR-02 | AI reading labelled `inferred` | model returns industry + 0.8 | provenance `inferred`, confidence 0.8 | ✅ |
| C-ENR-03 | 🔴 AI down ⇒ inferred fields **absent** | chain throws | `industry`/`employee_band` undefined; observed fields still land | ✅ |
| C-ENR-04 | 🔴 No hardcoded headcount | any page | `employee_count` undefined (old code emitted 55 for everyone) | ✅ |
| C-ENR-05 | Model value outside the enum refused | `industry: "Sorcery"` | field omitted | ✅ |
| C-ENR-06 | Observed absence vs unobservable | page with no `/pricing` link | `has_pricing: false`, method `observed` | ✅ |
| C-ENR-07 | robots.txt honoured, costs nothing | disallowed | `ok:false`, `pagesFetched: 0` | ✅ |
| C-ENR-08 | Private address refused | non-public host | `url_not_public` | ✅ |
| C-ENR-09 | Empty response is a failure | empty HTML | `empty_response`, not an empty company | ✅ |
| C-ENR-10 | Confidence is the weakest link | 3 observed + 1 inference @0.3 | overall 0.3, not an average | ✅ |
| C-ENR-11 | Weak inference routed to review | inference @0.4 | `industry` in review queue | ✅ |
| C-ENR-12 | Observed fields never routed to review | AI down | review list empty | ✅ |

### 3.4 Cron registry parity (5 cases)

| ID | Scenario | Expected | Result |
|---|---|---|---|
| C-CRP-01 | `netlify.toml` declares schedules | ≥ 6 | ✅ (8) |
| C-CRP-02 | Every registered job is scheduled | none missing | ✅ |
| C-CRP-03 | Every scheduled function is registered | none unmonitored | ✅ |
| C-CRP-04 | Cadences agree between the two | identical | ✅ |
| C-CRP-05 | Discoverability monitor still daily | unchanged | ✅ |

**Suite total: 1 951 passed / 14 skipped / 0 failed** (107 files).

---

## 4. TS-5 · Database — 45 migrations on WASM Postgres

Run: `npm run test:db`

| ID | Scenario | Expected | Result |
|---|---|---|---|
| D-RLS-01..15 | RLS enabled on every Phase 4–6 table | `relrowsecurity = true` | ✅ ×15 |
| D-RLS-16..30 | Exactly one policy per table, and it is the service-role one | count 1, name `service full access` | ✅ ×15 |
| D-RLS-31..45 | 🔴 No policy grants access when `auth.uid()` is null | 0 matches on the stored expression | ✅ ×15 |
| D-RLS-46..60 | anon and authenticated hold zero grants | 0 rows in `role_table_grants` | ✅ ×15 |
| D-045-01 | `list_records.provenance` exists | jsonb, default `{}` | ✅ |
| D-045-02 | `rule_executions.attempt` / `next_retry_at` exist | for PRD 5 retry accounting | ✅ |

**45 migrations applied · 461 assertions passed · 0 failed.**

> Each RLS assertion was confirmed **RED** against the pre-`0044` schema before being accepted:
> removing `0044` produces 76 failures, including `anon and authenticated hold no grants — got=14`.

---

## 5. TS-7 · Playwright smoke

Run: `npm run test:e2e:smoke` — **131 passed, 1 skipped, 0 failed.**
The skip is the deliberately CSS-hidden Pillar-0 banner, expected and long-standing.

Browser-verified by hand in addition to the suite:

| ID | Scenario | Expected | Result |
|---|---|---|---|
| B-01 | `/lists` signed out | Sign-in state, not a thrown "Authentication required" | ✅ |
| B-02 | `/watchlists` signed out | as above | ✅ |
| B-03 | `/rules` signed out | as above | ✅ |
| B-04 | Console clean of app errors | only the local dev-proxy 502s | ✅ |

---

## 6. TS-9 · Live staging, authenticated — ⏸ OPERATOR-RUN

**Why this section is unexecuted and not marked pass.** Creating an account and signing in with a
password are actions this agent is not permitted to perform, and no service key was available in
the session. Recording these as passed on the strength of the automated suites would be exactly the
"a green pipeline reported success" mistake this whole review exists to correct.

### 6.1 Prerequisites

```bash
# 1. Create the user in the Supabase dashboard (Authentication → Users → Add user,
#    'Auto Confirm User' ticked). Do NOT reuse a password that has appeared in any
#    transcript or chat.
# 2. Grant the plan and seed fixtures — nothing is read from the repo:
STAGING_SUPABASE_URL=https://<ref>.supabase.co \
STAGING_SUPABASE_SERVICE_KEY=<service key> \
STAGING_TEST_EMAIL=<the address> \
  node scripts/seed-staging-test-account.mjs --dry-run     # inspect first
```

Then drop `--dry-run`. Optionally set `STAGING_TEST_WEBHOOK_URL` (e.g. a webhook.site URL) to arm
the seeded signal rule; without it the rule is created **paused**, so a fixture can never POST to a
destination the operator did not choose.

### 6.2 Cases to record

| ID | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S-01 | Sign in | Sign in as `<STAGING_TEST_EMAIL>` | Agency plan shown on `/account` | ⏸ |
| S-02 | Template catalogue | Open `/templates` | 7 published templates, persona filter works | ⏸ |
| S-03 | Run a template | Account Brief on a domain you own | Output carries source URLs + timestamp; run in `/dashboard?view=runs` | ⏸ |
| S-04 | Credit ledger | After S-03, open the run modal | Itemised credit breakdown, actual ≈ estimate | ⏸ |
| S-05 | Publish a report | Publish the S-03 run as `link` | `/r/<slug>` loads; `<meta robots>` is `noindex` | ⏸ |
| S-06 | Revoke a report | Revoke the link | Immediate 404/refusal on reload, not a cached body | ⏸ |
| S-07 | Bulk list creation | `/lists` → new list, 2 domains | Dedup preview correct; job queued | ⏸ |
| S-08 | 🔴 **Bulk durability** | Start the job, **close the tab**, wait ≤ 10 min, reopen | List is **complete** — advanced by `bulk-runner`, not the tab | ⏸ |
| S-09 | 🔴 **Enrichment is real** | Inspect an enriched row | `provenance` shows `observed` vs `inferred` per field; no `employee_count: 55` | ⏸ |
| S-10 | Unreadable domain | Add a domain that 404s | Row is **failed** with a reason, `credits_used = 0` | ⏸ |
| S-11 | ICP coverage honesty | A domain where AI could not infer | Score reflects reduced **coverage**, not a wrong score | ⏸ |
| S-12 | Review queue | Inspect `/lists` → Review | Only low-confidence **inferred** fields listed | ⏸ |
| S-13 | Watchlist creation | `/watchlists` → add a domain, cadence hourly | Pages auto-discovered | ⏸ |
| S-14 | 🔴 **Baseline does not alert** | First crawl | Snapshot stored, **no** change feed entries | ⏸ |
| S-15 | 🔴 **Cadence honoured** | Wait for the hourly tick | `last_checked_at` advances; a daily watchlist does **not** re-crawl | ⏸ |
| S-16 | Change detection | Point a target at a page you can edit; change a price | Change appears with old/new, materiality, source URL | ⏸ |
| S-17 | Fact vs interpretation | Open the change | Fact and AI tabs separate | ⏸ |
| S-18 | 🔴 **Failed fetch ≠ deletion** | Make the target 500 for one cycle | **No** "field removed" changes generated | ⏸ |
| S-19 | robots refusal | Add a robots-disallowed target | Page paused with a stated reason, not retried hourly | ⏸ |
| S-20 | 🔴 **Rule fires** | Arm the webhook rule, trigger S-16 | Webhook receives the payload | ⏸ |
| S-21 | 🔴 **Execution history** | `/rules` → history | Row with status, latency, response | ⏸ |
| S-22 | Failed dispatch recorded | Point the rule at a URL returning 500 | Recorded `failed` with the status, run itself OK | ⏸ |
| S-23 | Credit debit for monitoring | After S-15 | `monitor_check` entries in the ledger | ⏸ |
| S-24 | Admin visibility | `/admin/monitoring` | Both new crons listed, with run history | ⏸ |

---

## 7. TS-10 · Live staging, unauthenticated (security) — ✅ PASSED

```bash
npm run verify:rls          # staging
npm run verify:rls -- --prod   # before any production promotion
```

**Measured 2026-09-04, BEFORE `0044`: 15/15 tables HTTP 200 — exposed, exit 1.**
**Measured 2026-09-04, AFTER `0044` was applied by the operator: 15/15 tables HTTP 401, exit 0.**

| ID | Table | Expected | Before `0044` | After `0044` |
|---|---|---|---|---|
| X-01 | `lists` | 401 anonymous | 200 ❌ | **401 ✅** |
| X-02 | `canonical_entities` | 401 | 200 ❌ | **401 ✅** |
| X-03 | `list_records` | 401 | 200 ❌ | **401 ✅** |
| X-04 | `icp_score_rules` | 401 | 200 ❌ | **401 ✅** |
| X-05 | `enrichment_jobs` | 401 | 200 ❌ | **401 ✅** |
| X-06 | `enrichment_job_items` | 401 | 200 ❌ | **401 ✅** |
| X-07 | `review_queue` (contact PII) | 401 | 200 ❌ | **401 ✅** |
| X-08 | `watchlists` | 401 | 200 ❌ | **401 ✅** |
| X-09 | `watchlist_targets` | 401 | 200 ❌ | **401 ✅** |
| X-10 | `monitored_pages` | 401 | 200 ❌ | **401 ✅** |
| X-11 | `entity_snapshots` | 401 | 200 ❌ | **401 ✅** |
| X-12 | `field_changes` | 401 | 200 ❌ | **401 ✅** |
| X-13 | `change_feedback` | 401 | 200 ❌ | **401 ✅** |
| X-14 | `signal_rules` (webhook URLs) | 401 | 200 ❌ | **401 ✅** |
| X-15 | `rule_executions` | 401 | 200 ❌ | **401 ✅** |

The before/after pair is the evidence that matters: the same command, the same public key, the
same fifteen tables, run either side of the migration. Re-run it after any migration touching
these tables, and before any production promotion (`npm run verify:rls -- --prod`).

---

## 8. Findings and deviations

### 8.1 Findings fixed during this execution

| # | Found by | Finding |
|---|---|---|
| F-01 | New SSRF test (C-TEN-10) | The **first draft of the fix itself** accepted `http://169.254.169.254/`. `isPublicHttpUrl` **throws** for a bad scheme but **returns `false`** for a private IP, despite a JSDoc documenting only the first. A `try/catch` alone is not enough; both channels must be handled. Now uses `isPublicHttpUrlAsync` and checks the return value. |
| F-02 | New unit test (U-SNAP-10) | `diffSnapshots(null, …)` threw. JS default parameters fire only for `undefined`, and a snapshot column never written comes back from Postgres as `null` — so the first monitored page with no prior snapshot would have crashed the crawler loop. |
| F-03 | Code review during G3 | 🔴 **The shipped bulk enrichment was fabricated.** `industry: domain.includes("tech") ? "Software" : "Services"`, `employee_count: 55` for every company, `has_pricing: true` always — stamped `confidence_score: 0.95`. It never fetched the page. Every ICP score in the product derived from it. Replaced by `bulkEnrich.js` (observed / inferred / absent). |
| F-04 | Test-quality review | The dispatcher's first test mock returned the same rows regardless of `.eq()` filters, making "only this user's rules" and "only this trigger source" green **without testing either**. The mock now enforces the filters. A green test that asserts nothing is worse than no test. |

### 8.2 Deviations from the plan

| # | Deviation | Reason |
|---|---|---|
| D-01 | TS-9 recorded as ⏸, not ✅ | Account creation and password handling are outside what this agent may do. Marking them passed on the strength of unit tests would misrepresent evidence. |
| D-02 | ~~TS-10 blocked~~ — **RESOLVED** | `0044` was applied by the operator during this session and TS-10 now passes 15/15. The verifier ships as `npm run verify:rls` so the check stays one command. |
| D-03 | Enrichment reads **one** page (the homepage) | The BRD's schema lists eight field categories. Multi-page crawling per account is a real cost and latency decision; one page keeps the credit model honest and the change reviewable. Extending it is additive. |
| D-04 | `bulk.enrich` / `watchlist.create` / `rule.create` reuse existing plan limits | Choosing new per-tier allowances is a pricing decision for the owner. The gates are in place to carry dedicated numbers whenever those are set. |
| D-05 | Watchlist page **discovery** remains manual/seeded | The crawler monitors the pages a watchlist holds. Automatic discovery exists in `classifyUrl` but is not yet wired to a domain crawl — deliberately, so the first version cannot silently enrol pages a user did not choose to monitor. |
| D-06 | PRD 5 retry is **schema-only** | `0045` adds `attempt` / `next_retry_at`; a retry sweeper is not yet built. A failed dispatch is recorded and visible, which satisfies "action execution history and error status"; automatic retry is the remaining half. |

### 8.3 Still open

| # | Item | Owner |
|---|---|---|
| O-01 | ✅ `0044` applied to **staging** and verified 15/15. **Still required on production** before any promotion — run `npm run verify:rls -- --prod` to confirm. | Operator |
| O-02 | Create the staging test account and run §6 | Operator |
| O-03 | Retry sweeper for failed dispatches (D-06) | Next session |
| O-04 | Automatic watchlist page discovery (D-05) | Next session |
| O-05 | Bring `icpModel` / `materialityModel` / `ruleModel` up to the test density of the Phase 0–3 models (5/5/4 vs 40/26/20/28) | Next session |

---

## 9. How to re-run everything

```bash
npm run test:all        # all 10 gates, ~6 min
npm run test:db         # 45 migrations, 461 assertions
npm run verify:rls      # live staging RLS posture
npm run test:e2e:smoke  # Playwright chromium
```
