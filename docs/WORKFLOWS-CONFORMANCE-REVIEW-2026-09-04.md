# Intelligence Workflows — BRD conformance, security and coverage review

**Date:** 2026-09-04 · **Branch:** `claude/workflow-automation-plans-review-869dbc` (cut from `origin/staging`)
**Source of truth:** *DatIQ — Persona Specific Templates & Shareable Reports* (BRD/PRD PDF, 25pp)
**Scope:** Phases 0–7 of `docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md`, i.e. PRD 1–5 plus
the PQL/activation and packaging work.

---

## 1. Headline

Phases 0–3 (spine, templates, shareable reports, PQL) conform to the BRD and are built to the
standard the rest of this repository sets: service-role-only RLS, entitlement gating, an
append-only credit ledger, and 114 unit tests across the four pure models plus 44 contract tests.

**Phases 4–6 (bulk account intelligence, competitor watchlists, signal routing) shipped the data
model and the UI without the security spine, the plan enforcement, or the engines that make them
run.** They were recorded as ✅ DONE and passed a green Staging Gate. They had **zero contract
tests**, which is the single fact that explains everything below.

The most serious finding was **live and remotely exploitable on the staging database**, and would
have been live on production the moment `staging` merged to `main`.

---

## 2. Security findings — all fixed in this pass

### S1 · Critical · Unauthenticated read/write on 15 tables via the public anon key

Migrations `0041`, `0042` and `0043` each shipped two mistakes, either of which alone would have
been sufficient:

```sql
grant all on public.lists to anon, authenticated, service_role;

create policy lists_owner_access on public.lists
  for all using (user_id = auth.uid() or auth.uid() is null);
```

`auth.uid()` **is** null for the anon role. The clause that reads like a local-development
convenience is in fact *"…or the caller is anonymous"*, so the policy evaluates TRUE for every row
for exactly the caller it was written to exclude. `canonical_entities_insert`'s
`with check (auth.uid() is null or auth.uid() is not null)` is a tautology — literally `true`.

The anon key is public by design (`public/runtime-config.js` says so in its own comment: *"RLS
protects data, not the key"*). These three migrations removed the thing that was protecting it.

**Verified exploitable**, read-only, against the staging project:

```
GET https://<staging-ref>.supabase.co/rest/v1/lists?select=id&limit=1
    apikey: <the publishable key committed to this repo>
→ HTTP 200  [{"id":"e0997913-…"}]
```

No Authorization header, no session, no application endpoint involved. Reads were confirmed and the
probe stopped there; the same policy grants `insert`, `update` and `delete`, and `review_queue`
holds unverified **contact PII** — names, titles and email addresses scraped from third-party sites.

Phases 0–3 (`0036`–`0040`) do not have this defect: they use
`for all to service_role using (true) with check (true)` and grant nothing to anon, matching
`0029_referrals.sql` and `0031_team_workspaces.sql`.

**Fix:** `supabase/migrations/0044_lock_down_workflow_rls.sql` drops all 18 permissive policies,
revokes the anon/authenticated grants, and installs the service-role-only policy across all 15
tables. Idempotent. Pinned by **+76 assertions** in `scripts/db-verify.mjs` covering, per table:
RLS enabled · exactly one policy · that policy is the service-role one · no policy expression still
contains `uid() IS NULL` · anon and authenticated hold zero grants.

> ⚠️ **`0044` must be applied to the staging Supabase project.** Until it is, staging remains
> exposed. It has been verified against WASM Postgres only (44 migrations, 460 assertions).

### S2 · Critical · Application-layer auth fail-open

All three handlers did:

```js
const userId = auth.ok ? auth.user?.id : null;
```

An authentication *failure* — absent, expired or forged token — became an anonymous request rather
than a refusal. Each store then did `if (userId) q = q.eq("user_id", userId)`, so a null id meant
**no filter** on a query running under the service key. An unauthenticated `GET /api/signal-rules`
returned every tenant's rules, `action_config` included — which is where Slack webhook URLs live.

Every older function in `netlify/functions/` returns 401 correctly. Only these three deviate.

**Fix:** all three now `return json(auth.status, auth.body)`. The stores refuse independently
(`ownerless()` → 401), so a future caller cannot reopen the hole by forgetting the handler check.

### S3 · High · Cross-tenant writes (IDOR)

| Function | Defect |
|---|---|
| `recordFieldChange` | Took **no user id at all**. Anyone knowing a watchlist id could inject fabricated competitor "changes" into another tenant's feed — the alerts they act on. |
| `resolveReviewItem` | Updated `review_queue` by `.eq("id", …)` only. Any signed-in user could accept/reject another tenant's review items and write an arbitrary `resolvedValue` into their enriched record. |
| `processJobChunk` | No ownership check — any user could advance, and spend the credits of, another tenant's job. |
| `deleteRule` | `.eq("id", ruleId)` with the user filter conditional — could delete any rule. |

**Fix:** `assertWatchlistOwner()` and `assertJobOwner()` added; every mutation scoped by `user_id`.
Refusals return **404, not 403**, so ids cannot be enumerated — the rule `templates.js` already
follows for runs and `invoice-pdf.js` for invoices.

### S4 · High · `getIcpRules` leaked another tenant's ICP criteria

The query selected every row for a persona regardless of owner, then fell back to `data[0]` when the
caller had no rule of their own — handing them **another customer's custom ICP scoring criteria**,
which is competitively sensitive. Fixed by scoping in SQL (`own rule OR a genuine shared default`)
and removing the positional fallback.

### S5 · High · No entitlement or credit enforcement on Phases 4–6

`templates.js` and `reports.js` gate correctly on `resolveRequestEntitlement` + `checkCapability`.
The three new endpoints had **no check of any kind**, which:

- left three cost-bearing operations (bulk crawling, scheduled monitoring, outbound dispatch)
  entirely unmetered; and
- made three of the BRD's own stated upgrade triggers unenforceable. Its Commercial Packaging table
  names *"batch size", "monitored URLs"* and *"automation volume"* as the primary limits for the
  Team and Business tiers.

**Fix:** three new capabilities in `entitlementModel.js`, checked **before** the write so a refused
request costs nothing:

| Capability | Gated on | Why that limit |
|---|---|---|
| `bulk.enrich` | `batch_max_urls` (+ purchased bundles) | A bulk list is a batch of URLs by another name. A separate ungated path would let a user on a 5-URL batch limit enrich 500 domains from the other screen. |
| `watchlist.create` | `scheduled_monitoring` | A watchlist *is* a recurring monitor. `audit.schedule` already reuses this limit for the same reason: a user who may keep no schedules must not acquire the right by pointing them at a different object. |
| `rule.create` | `integrations` | A rule exists to push into HubSpot/Slack/a webhook. Gating it elsewhere reopens the four push providers `integrations` was added to gate. |

**Each reuses a limit the pricing page already sells.** Choosing new per-tier allowances is a
pricing decision for the owner, not something to attach to a security fix — and a limit nobody has
priced is worse than an honest reuse of one that is. If you want dedicated numbers (e.g. "Team = 25
monitored watchlists"), that is a deliberate follow-up and the gate is already in place to carry it.

### S6 · Medium · Unvalidated `action_config` — a stored SSRF primitive

`createRule` stored any URL a client sent. Since PRD 5's dispatcher does not exist yet (G1), nothing
POSTs to it today — but the row would be waiting when it does, which is the worst version of this
bug because it is dormant and invisible.

**Fix:** `validateActionConfig()` validates at **write** time via `isPublicHttpUrlAsync`, with Slack
actions pinned to `hooks.slack.com`, HubSpot resolved server-side from the stored connection rather
than the rule body, and email recipients rejected if they carry a header-splitting newline.

> ⚠️ **Trap worth recording.** `isPublicHttpUrl` **throws** for a bad scheme but **returns `false`**
> for a private IP, despite a JSDoc that documents only the first (*"returns true if safe; throws a
> typed Error otherwise"*). A caller that only wraps it in `try/catch` silently accepts
> `http://169.254.169.254/` — the cloud instance-metadata endpoint, the highest-value SSRF target
> there is. **The first version of this very fix had that bug, and the new test caught it.**
> `extract.js` gets it right by using the async variant and checking the return value; do the same.

### S7 · Medium · Three private workspaces were indexable

`/lists`, `/watchlists` and `/rules` were never added to the private-prefix invariant, so they were
missing from `PRIVATE_PREFIXES`, `robots.txt`, the `X-Robots-Tag` rules and `index.html`'s inline
guard. `page-ownership.test.mjs` asserts the four stay in sync but cannot catch a route never added
to the list. Adding the three to `PRIVATE_PREFIXES` turned that test red in exactly three places,
which then drove the other three fixes.

`/r/:slug` is deliberately **not** listed: its `public` visibility state is meant to be indexable, so
`Report.jsx` writes the robots meta per report. That is correct as built.

---

## 3. Functional gaps — NOT fixed, and why

These are real feature work of several sessions each. Building them half-way would be worse than
recording them precisely, so they are recorded precisely. All three are **"Must" requirements** in
the BRD.

### G1 · PRD 5 never dispatches anything

`recordExecution` has **zero callers**. `rule_executions` is never written. `evaluateSignalRule` is
reached only from the sandbox preview (`SignalRules.jsx`) and `testRuleWithPayload`. A user can
build a rule, test it against a sample payload, and save it — and it will never fire.

Unimplemented BRD requirements: *"Native actions: Slack message, email via Resend, webhook, HubSpot
create/update/task — Must"*, *"Action execution history and error status — Must"*, *"Retry failed
actions — Must"*.

### G2 · PRD 4 has no scheduled crawler or differ

`recordFieldChange` fires only from a client HTTP call. There is no crawl, no snapshot comparison,
and **no cron block in `netlify.toml`** — so the `cadence` a user picks when creating a watchlist is
stored and never honoured.

Unimplemented: *"Scheduled crawling at plan-defined frequency — Must"*, *"Structured snapshot of
configured fields — Must"*, *"Field-level comparison against previous snapshot — Must"*,
*"Slack/email digest delivery — Must"*, *"Weekly/monthly digest — Must"*.

### G3 · PRD 3's async processing is browser-driven

`processJobChunk` advances only while the tab is open and polling it. Closing the tab strands the
job mid-list. No cron.

Unimplemented as specified: *"Queue-based asynchronous processing with progress — Must"*.

> **The pattern.** G1–G3 are the same shape as two defects this repository has already recorded: the
> intelligence-workflow `prompt_bundle` that no code consumed, and `discoverability.createSchedule`
> which had zero callers. In each case the tables, the UI and the tests existed while nothing ever
> drove the system, and the failure mode was **silence** — no error, no alert, just a feature that
> quietly does nothing. `cron-registry-parity.test.js` exists to catch the scheduling half of this
> and should be extended to cover these three once the engines land.

---

## 4. Coverage

| Module | Tests before | After |
|---|---|---|
| `templateModel` (Ph 0) | 40 | 40 |
| `creditModel` (Ph 0) | 26 | 26 |
| `visibilityModel` (Ph 2) | 20 | 20 |
| `pqlModel` (Ph 3) | 28 | 28 |
| `icpModel` (Ph 4) | 5 | 5 |
| `identityModel` (Ph 4) | 7 | 7 |
| `materialityModel` (Ph 5) | 5 | 5 |
| `ruleModel` (Ph 6) | 4 | 4 |
| `entitlementModel` | 72 | **84** (+12) |
| `bulk-enrichment.js` contract | **0** | **25** (shared file) |
| `watchlists.js` contract | **0** | ↑ |
| `signal-rules.js` contract | **0** | ↑ |
| `db-verify` assertions | 384 | **460** (+76) |

The cliff between Phases 0–3 and 4–6 is stark and is the root cause of every S-finding. The pure
models for Phases 4–6 (5, 7, 5 and 4 tests) remain thin relative to their Phase 0–3 counterparts
(40, 26, 20, 28) and are the obvious next place to invest.

**Every new behavioural test was confirmed RED against the pre-fix code before being accepted**, per
this repository's own convention: the RLS assertions fail 76 times with `0044` removed, and the
tenancy tests fail when the `auth.ok ? … : null` fall-through is restored.

---

## 5. Conformance against the BRD, by PRD

| PRD | Verdict |
|---|---|
| **1 — Templates & guided onboarding** | ✅ Conforms. 7 templates published, covering 6 of the BRD's 8 recommendations — consistent with its own instruction to *"build 6 templates only; avoid creating 30 before observing adoption."* Versioned JSON config, not hard-coded UI, as required. Not shipped: *Competitor Product & Messaging Monitor*, *Lead List Builder for Indian SMBs*. |
| **2 — Shareable intelligence reports** | ✅ Conforms. Five-state visibility machine, private by default, slug minted only at first publish, revocation terminal, per-request server-side resolution (no edge cache), free-tier attribution enforced server-side at render, per-report `noindex`. |
| **3 — Bulk account intelligence** | ⚠️ Partial. Import, dedup, ICP scoring, review queue and the UI conform. Plan enforcement was **absent** (S5, now fixed). Queue-based async processing is **not** implemented (G3). |
| **4 — Competitor watchlists** | ⚠️ Partial. Materiality model, fact-vs-interpretation separation and feedback loop conform and are well designed. Scheduled crawling, snapshotting and diffing are **not** implemented (G2). |
| **5 — Native signal routing** | ⚠️ Partial. Rule model, builder and sandbox conform. **Nothing dispatches** (G1); execution history and retry do not exist. |
| **Data provenance as a product feature** | ✅ Conforms. `0038` carries source URL, method, version, confidence and the `observed \| inferred \| ai_generated` distinction the BRD asks for. |
| **Compliance boundaries** | ✅ Conforms. robots.txt honoured, consent override signed-in only, personal contact data routed through the review queue with confidence labelling. |

---

## 6. Recommended order of work

1. **Apply `0044` to the staging Supabase project.** Nothing else matters until this is done —
   staging is exposed today. Verify with the read-only probe in §S1: it must return 401.
2. Extend the same probe into `smoke-prod.mjs` so an anonymous PostgREST read of these tables is a
   standing gate, not a one-off check.
3. **G2** — the watchlist crawler and differ. Highest customer value of the three: it is what makes
   PRD 4 a *product* rather than a data model, and the BRD ranks watchlists 4th overall.
4. **G1** — the rule dispatcher. Depends on G2 producing real events to route. The SSRF validation
   is already in place, so this is now safe to build.
5. **G3** — move the chunk runner onto a cron (a `netlify.toml` block plus the existing
   `workflow_events` queue; §1.3 of the plan already specifies the durable pattern).
6. Bring `icpModel`, `materialityModel` and `ruleModel` up to the test density of the Phase 0–3
   models.
7. Decide whether the three new capabilities want **dedicated** per-tier allowances rather than
   reusing `batch_max_urls` / `scheduled_monitoring` / `integrations`. That is a pricing call; the
   gates are in place either way.

---

## 7. Verification

All run on this branch after the fixes:

| Gate | Result |
|---|---|
| Unit | 171 files / **2 883** passed |
| Contract | 105 files / **1 912** passed, 14 skipped |
| Integration | 49 files / **411** passed |
| Database | **44** migrations / **460** assertions, 0 failed (+ referral 17) |
| Build | clean |
| `check:prerender` | 23 pages / 92 refs, all present |
| Security scan | clean |
| Browser | signed-out `/lists`, `/watchlists`, `/rules` verified rendering the sign-in state, not an error |
