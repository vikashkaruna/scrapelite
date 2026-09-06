# DatIQ — Session Log (active, consolidated)

> **Newest entry first.** One file, appended in place — do **not** create a new
> `SESSION-HANDOFF-*.md` per session.
>
> **Why one file:** by 2026-09 the per-session convention had produced 70+
> archived records plus a growing tail of loose files, and finding "what
> happened to X" meant grepping a directory rather than reading a log. Session
> records are read newest-first far more often than they are read individually,
> so the format now matches the access pattern.
>
> **How to add an entry:** prepend a new `## ` block directly beneath this
> header, using the template at the bottom of this file. Never edit an existing
> entry except to correct a factual error — and say so in the correction.
>
> **Deep archive:** everything before 2026-08-30 lives in
> [`SESSIONS-HISTORY.md`](./SESSIONS-HISTORY.md) (70 sessions, frozen).

---

## 2026-09-06 — The v2 dispatch loop had never once run on a cron, and scheduling it would have 404'd n8n

**Branches.** `main` and `staging` were **already content-identical** — an empty tree diff; the
4 commits `main` led by were all `Merge pull request #N from staging` commits with no content of
their own. `staging` fast-forwarded onto `main` at `e71b329`, then this session's three commits
landed on top. `workflow-implementation-and-optimization` has **zero unique commits** and is 116
behind: **nothing was ever stranded there** — all the n8n/v2 work has been on staging since
`157df70`, so "merge staging into it" is a pure fast-forward.

⚠️ Three branches are checked out in other worktrees (two belonging to a concurrent Gemini
session), so `git checkout` is impossible and `git fetch origin X:X` is refused. Every update had
to be an explicit-refspec push. The user's own primary checkout was fast-forwarded; the two
antigravity worktrees were deliberately left alone and need `git pull --ff-only`.

### 🔴 `workflow-orchestrator` declared a schedule and was scheduled nowhere

It carried `export const config = { schedule: "*/5 * * * *" }` — which `netlify.toml`'s own header
documents as honoured **only** for v2 `export default` handlers, and every function here is v1 —
while appearing in **neither `netlify.toml` nor `AUTOMATION_JOBS`**. So the entire v2 pipeline's
dispatch loop had never fired, and it was invisible to `/admin/monitoring`.

**Why it survived:** `cron-registry-parity.test.js` compares the two registries against each other
in both directions, and **absent from both is agreement**. The guard written precisely to catch
"declared a schedule, never actually scheduled" could not see the one instance of it. The function
source is a **third** registry — and the only one that does nothing on its own. The test now reads
all three: +4 assertions, **2 confirmed RED** against the pre-fix registries while the **7
pre-existing assertions stayed GREEN**, which is direct evidence the old suite was blind here.

### 🔴 And the obvious fix would have broken production

Declaring a schedule makes Netlify **refuse public HTTP access** to that function — the same
mechanism `netlify.toml` credits with keeping `billing-purge` off the open internet. But
`workflow-orchestrator` has three live HTTP callers: `00-datiq-smoke-test.json` → `/ping`,
`datiq_process_pending_workflow.json` → `/dispatch`, and the deployment guide's operator smoke
test → `/run-now`. **A Netlify function can be a cron or an HTTP endpoint, not both.**

Split: new **`workflow-orchestrator-cron.js`** carries the schedule and the `withJobRun`
bookkeeping; the original stays unscheduled and keeps serving HTTP. Both call the **same
`runOnce()`**, so there is no second copy of the poll to drift from the one n8n exercises. The dead
`config.schedule` export was removed from the HTTP function, since acting on it is precisely the
trap. `orchestrator-route-parity.test.js` (5 assertions, 2 confirmed RED by re-introducing the
exact mistakes) fails the build if anyone re-merges them.

⚠️ This is very likely **why it was never scheduled** — but nothing recorded that, so it read as an
oversight rather than a constraint. It is written down now, in three places.

### 🔴 Five "Run now" buttons were wired to nothing

`AUTOMATION_JOBS` marked 8 jobs `manualRunAllowed: true`; `RUNNABLE` in `admin-monitoring.js` wired
4. `discoverability-monitor`, `watchlist-monitor`, `bulk-runner` and `signal-retry` each rendered an
**enabled** button that answered `400 No runner is wired`. All four export a usable handler — they
were simply never added. Pre-existing, and fixed in the same pass because a control that looks live
and does nothing is worse than a disabled one: the operator believes the job just ran.

### 🔴 `/admin/automation` and `/admin/revenue` never loaded under `npm run dev`

Both used `useEffect(() => () => { alive.current = false; }, [])` — a cleanup with **no re-arm**.
`React.StrictMode` runs mount → cleanup → mount on the *same* component instance, so `alive` stayed
`false` for ever and every `if (!alive.current) return` bailed: permanent "loading", no error.
`AdminMonitoring` and `AdminHealth` already open their effect with `alive.current = true`.
Development-only (StrictMode is stripped in production builds), and a remount creates a fresh ref —
but it means neither page could be tested locally, **plausibly why neither ever got a browser
spec**. Found by the new e2e spec failing, not by reading the code.

### The "4 n8n credentials" in the docs were wrong, in both directions

`WORKFLOW-BRANCH-READINESS` said 4, `N8N-DEPLOYMENT-STATUS` said 3. Parsing all 18 workflow JSONs:
exactly **one** credential is bound — `datiq-slack-monitoring` (`slackOAuth2Api`, 3 workflows,
**name must match exactly**, they bind by name). Resend is a plain HTTP call authenticated from
`$env.RESEND_API_KEY`; there is **no `supabase.co` host in any workflow** (they call back to
DatIQ's own API); `datiq-orchestrator` appears nowhere. What K3 actually needs is **13 `$env` vars
on the n8n host**, of which `DATIQ_N8N_API_KEY` **must equal** Netlify's `N8N_WEBHOOK_SECRET`.

### Two n8n instances, easy to conflate

The v2 pipeline targets the **self-hosted GCP Cloud Run** box via `N8N_BASE_URL`. The browser-side
webhook targets **n8n Cloud** (`vkaruna.app.n8n.cloud`), hardcoded in `public/runtime-config.js`.
🔴 **`VITE_WEBHOOK_URL` is set in no Netlify context, yet that webhook is live**, because
`config.js`'s `endpoint()` prefers the runtime override over the env var — so `netlify env:list`
alone reports it off when it is not. `VITE_CONTACT_WEBHOOK_URL` falls back to it, and
`contactWebhook.js` is self-described scaffolding: nothing downstream consumes `contact.submitted`.

### Operator items closed — verified, not assumed

**P1** production RLS: `npm run verify:rls -- --prod` → **15/15 HTTP 401**. **P2**
`SCRAPE_PROVIDER_ORDER` deleted from production / branch-deploy / deploy-preview — and the sanity
check matters: **69 keys still visible** for production, so the absence is a real absence rather
than an empty result. **N1–N3**, **K1–K4** operator-confirmed. ⚠️ Netlify injects Function env vars
at **deploy** time, so P2 reaches production only on its next deploy.

### Doc cleanup

**Deleted** `WORKFLOW-BRANCH-READINESS-2026-08-02.md` — 0 inbound references, and two of its entries
were actively wrong (C3 pointed at a `scripts/env/` directory that does not exist; C1's advice would
have broken n8n). **Rewrote** `N8N-DEPLOYMENT-STATUS.md` as the current confirmed state. **New**
`POST-DEPLOYMENT-MANUAL-TEST.md` — the ordered post-deploy pass (M1–M3, T1–T6), replacing the
deleted doc's T-list. **Corrected** `HELP.md`'s `email.send` webhook fallback (it described
`emailService.js`, which was **deleted**) and `CLAUDE.md`'s own `SCHEDULE_ALERT_WEBHOOK` line
(**gone** — v2 replaced it with `enqueueEvent()`).

### Verified

unit **3 016** · contract **2 006** · integration **432** · e2e smoke **142** (+6 new) · db · build ·
prerender · security · readiness 5 pass / 2 warn / 0 fail. **All gates green in 221s, nothing
bypassed.** Every behavioural test confirmed RED against the pre-fix code first.

⚠️ The prerender gate fired on the admin-page edits. Rather than bypass it, the generator was run:
the diff was **31 insertions / 31 deletions across 28 pages — one line each, the entry bundle's
content hash**, no content change. `/admin` is in `PRIVATE_PREFIXES` ("never prerendered"), so the
change provably cannot affect prerendered output; running the generator proved it rather than
asserting it.

### Still outstanding

**Nothing is verified against real traffic.** The pipeline is configured and the cron is scheduled,
but no session has watched an event travel `pending → processing → done`; `/workflows` has never run
on a populated account; and the `EVENT_TO_SOURCE` routing fix is reasoned from the schema and pinned
by test, **not observed firing**. All of it is `POST-DEPLOYMENT-MANUAL-TEST.md`.

---


## 2026-09-05 (latest) — `/workflows` Phase 2, and the routing vocabulary that made 8 of 10 event kinds undeliverable

> **Branch:** `claude/missing-public-tables-107e72` → **`staging`**. `main` untouched.
> **Verified:** full suite **348 files / 5441 passed** (+49 new) · build · prerender · e2e smoke.

### 1. 🔴 THE FIND: eight of ten canonical event kinds could never fire a rule

Uncovered while building the dry-run trace — which is the point of building one.

`signalDispatch.findMatchingRules` selects rules with `.eq("trigger_source", source)`,
where `source` comes from `EVENT_TO_SOURCE`. That map emitted **`account`**,
**`extraction`**, **`report`** and **`system`** — and migration `0043` puts a CHECK
constraint on `signal_rules.trigger_source` limiting it to
**`watchlist` | `bulk_enrichment` | `workflow_run`**. So eight kinds queried for a
value **no row can hold**, matched zero rules every time, and dispatched nothing.
**Silently** — an empty result is indistinguishable from "no rule wanted this event".

**The mirror image was equally bad:** `bulk_enrichment` and `workflow_run` are offered
in the rule builder and accepted by the database, but **no event produced them** — so a
rule a user saved and saw listed as *active* could never fire. Only
`monitor.change_detected` / `monitor.digest_ready` ever routed at all.

✅ Fixed by mapping onto the three real sources. ⚠️ **`integration.action_failed` and
`usage.limit_approaching` are deliberately left UNROUTED**, in a new `UNROUTED_EVENTS`
map **with a written reason each**: routing an integration failure to a rule whose
action is that same integration is a loop, and a billing signal belongs on an account
surface. A kind absent from both maps would look identical to one deliberately excluded,
which is why the reason is required rather than optional.

✅ **`signalDispatch.parity.test.js`** — 7 assertions, **2 confirmed RED** against the
old map, naming the exact impossible pairs. It **parses the CHECK constraint out of the
migration** rather than restating it: a copy here would drift from the database exactly
as `EVENT_TO_SOURCE` did. Same shape as `cron-registry-parity`.

### 2. Phase 2 of `/workflows`

**Dry trace** (`traceEvent`) — pick something that could happen, see which rules fire and
**which condition turned the others away**. ⚠️ **Uses `evaluateSignalRule`, the runtime's
own evaluator, not a copy** — a preview that disagrees with production is worse than none,
the same rule that makes "Check now" share the cron's differ. ⚠️ **Sample field names are
lifted from the real producers** (`watchlist-monitor.js` emits
`domain/company_name/watchlist/field/category/old_value/new_value/materiality/source_url`);
invented names would report every condition unmatched and send the user to "fix" a rule
that was already correct. **It sends nothing** — no Slack, no email, no ledger — and the
panel says so, because a preview a user is afraid to click is a preview nobody uses.

**Inline repair** (`InlineFix`) — create the missing link without leaving the diagnosis.
The trigger source is **derived from the issue, never asked**: the card already knows which
upstream has no listener. A rule created here uses **email to the signed-in address**, the
one destination needing no connection or webhook, so it works the moment it is saved.
⚠️ It ships with **no conditions — stated on the form** — because the evaluator treats
that as "matches everything", and a rule that silently matched *nothing* would reproduce
the exact defect this screen exists to surface. **Deliberately not offered for importing
an account list**: that is a paste-a-CRM-export flow with dedupe and a credit estimate,
and a three-field version inside a card would be a worse copy of a screen that exists.

**The guide** (`nextStep`) — ⚠️ **ONE step, not a checklist**: a user landing on an empty
pipeline with five equally-weighted suggestions does none of them. The order is the order
the pipeline runs, because a rule with nothing upstream is not progress — it is the
unreachable rule this screen warns about. It states the **model** as well as the action,
since this pipeline's failure mode is things that look configured and do nothing.

### 3. Open items

- [ ] 🔴 **CONFIRM PHASE 1 AGAINST REAL DATA, THEN RE-CHECK PHASE 2.** Both phases are
      pinned only against synthetic fixtures — staging is 401-gated, so no session here has
      opened `/workflows` on a populated account. The derived counts (`execution_count` from
      `rule_executions`, `change_count` from `field_changes`) are the likeliest to surprise.
      **Open it with real lists, watchlists and rules; confirm the issue list matches what
      you know to be true; then exercise the inline repair and the trace.**
- [ ] ⚠️ **The routing fix is reasoned from the schema and pinned by test, NOT observed
      firing.** Watch the first real `account.score_changed` / `extraction.completed` —
      those two paths have, on this analysis, never dispatched anything.
- [ ] **Adding targets to an EXISTING watchlist has no endpoint** — `InlineFix` says so and
      links out rather than pretending. A small `add_targets` action would close it.
- [ ] The rule builder offers operators `equals / not_equals / in / gte / lte / contains /
      not_empty`. A test here initially guessed `greater_than`; the trace surfaces the real
      vocabulary, but the builder could name it more plainly.

---

## 2026-09-05 (later) — The intelligence templates promised more than the runner and renderer could deliver; plus the orchestration screen, real watchlist checks, and a fabrication path removed

> **Branch:** `claude/missing-public-tables-107e72` → **`staging` = `fc64c00`**, deployed `ready`.
> **`main` = `d701f78`** — the owner promoted staging via **PR #153** mid-session, so the `/api/ai`
> budget fix from the entry below is now on `main` as well. `main` was not touched by this session.
> **Verification:** full suite **346 files / 5413 passed** (+38 new) · build · prerender 28 pages ·
> e2e smoke **136** · all 8 pre-push gates green in 200s. `/workflows` render verified in a browser.

### Why this session existed

Eight reported items. Three were "this template returns an incomplete/empty brief for datiq.app" and
read as model-quality problems. **None of them was.** All four causes were implementation, and two of
them were certain from source alone regardless of which run you looked at.

---

### 1. Items 1-3 — the templates promised more than the pipeline could produce

Found by diffing what each seed template **promises** against what the runner and renderer can
**deliver** — a gap analysis, not a per-template hunt, because each half looked correct alone.

🔴 **THE RENDERER IGNORED `from:` ENTIRELY, AND `table` WAS NEVER IMPLEMENTED.**
`Templates.jsx` filled every `list` block from `talking_points` **whatever the block's `from:` said**,
and had no `table` branch at all. Since `tiers`, `case_studies` and `named_customers` are **real
extraction fields**, the data was being extracted correctly and **discarded at the last step**:

| Template | Block | Before |
|---|---|---|
| Customer Proof | `{kind:"table", from:"case_studies"}` | **never rendered on any site** |
| Competitor Pricing | `{from:"tiers"}` | **never rendered on any site** |
| Due Diligence | `{kind:"list", from:"questions"}` | title rendered, filled from `talking_points` — a prompt that template does not have |

A block whose **title is honoured but whose source is ignored is worse than an unrendered one**: it
puts a promise on screen and fills it with something else.

🔴 **`questions` WAS DECLARED AND NEVER RUN.** The runner executed exactly `summarize` +
`talking_points`. Same defect this repo already fixed once for those two; `questions` was missed
because only one template declares it. (`comparison` and `delegate` belong to other execution paths
and are now recorded as such.)

🔴 **NO TEMPLATE DECLARED WHICH SUBPAGES IT NEEDS.** `CAPABILITY_SCHEMAS` is keyed by *capability*
(`contacts`, `pricing`, …) and templates by *template key* — **disjoint sets** — so `enrichKey` was
never set explicitly and every template fell through to `guessRelatedPageHintsKey()`, a first-match
regex written for free-text prompts typed on Home. **Measured, it sent FIVE of seven templates to
`pricing`**, because every extract prompt happens to mention a price:

- **Due Diligence** wants team, founding year, customers, hiring signals → fetched **`/pricing`**, never opened `/about`
- **Customer Proof** guessed **`null`** → **homepage only**, never opened `/customers` or `/case-studies`

Fixed with explicit `related_key` on every seed plus two new hint buckets (`diligence`, `proof`) that
gather **up front** like the other entity capabilities — a homepage yielding a couple of fields is not
`ABSENT`, so the retry never fired and the subpages were never read.

✅ **A null finding now names what it searched for**, beside the Sources list naming the pages read.
*"We found nothing" is only credible if we say what we looked for* — without it the reader must take
our word for both the search and the conclusion.

⚠️ **On item 2 (Customer Proof vs datiq.app) the template is RIGHT and the fix is not code.** DatIQ
publishes no named customers, case studies or testimonials — deliberately: this repo removed four
fabricated testimonials from the use-case pages and keeps Home's behind `{false && …}`. Making that
template return something requires **real, attributable** customer proof.

✅ **`templateContract.test.js`** pins all three template-side gaps as a parity test — one side
declares, the other executes, and nothing asserted they agreed. Same shape as `cron-registry-parity`.

---

### 2. Item 6 — "Run Enrichment" could never work, for any list, ever

`Lists.jsx` **fabricated its job id** as `` `job_${currentList.id}` `` and POSTed it to
`process_chunk`; jobs carry a database-generated id, so `assertJobOwner` failed and the server
answered **404 "Job not found"** every time. `createList()` **already returns the real id** and the
client threw it away. `getList()` now returns the list's jobs plus an `active_job_id`, the button
advances the real one, and the jobs are listed on screen with status and progress — so the button's
behaviour is predictable instead of a dead click naming an id the user never saw.

---

### 3. Items 4, 5, 7, 8

🔴 **ITEM 7 — "Simulate Delta" WAS FABRICATING DATA.** It POSTed a hardcoded **`$49/mo → $79/mo`**
through `record_change`, writing **invented competitor movement into the same feed as observed
movement** — indistinguishable once stored, in the list a RevOps user routes real outbound off. This
repo has had to undo that exact shape twice (fixture prose badged `ai_generated`; firmographics
invented from a domain string). Replaced with a real **"Check now"** that runs the **same differ the
`@hourly` cron runs** — a preview that disagrees with the scheduled run makes every diff noise —
budgeted from the request, ownership-checked **404 not 403**, charged only for pages actually read.

✅ **ITEM 5 — the multi-domain box accepts company NAMES.** The *single*-domain field already resolved
a typed name; the *multi*-domain box — the one people paste a CRM export into — was a bare textarea.
⚠️ **Resolution is SUGGESTED, never auto-applied**: `candidateDomains()` is a heuristic and enriching
the **wrong** company produces firmographics that look perfectly valid and describe somebody else.

✅ **ITEM 4 — one progress surface.** Template runs lived in the page body with their own bar, so
navigating away **hid AND abandoned** the run. Now owned by `TemplateRunProvider` above the router,
like `BatchRunProvider`, reporting through the shared dock. Its percent is **real** (`executeRun`
emits stage progress), unlike the single-extraction branch's cosmetic pacing.

✅ **ITEM 8 — NEW `/workflows`, the orchestration view.** Lists → Watchlists → Rules is ONE pipeline
presented as three unrelated screens, so nothing told a user a rule could never fire because no
watchlist feeds it, or that a watchlist produced changes no rule acts on. Each screen was individually
correct and **the system was silently inert**. Two design rules:

- **THE ISSUES LEAD, THE DIAGRAM IS CONTEXT.** A picture of what is wired is decoration; every gap
  named here fails silently today. Eight detected, incl. a watchlist legitimately at **baseline**
  (INFO, not an error — a first sighting never alerts).
- ⚠️ **EDGES ARE BY KIND, NEVER ID-TO-ID.** `signal_rules.trigger_source` names a *class* of event, so
  an id edge would imply a precision the schema does not have and show a rule as connected to one
  watchlist when it fires for all of them.

Pure model (`src/lib/workflows/workflowGraph.js`) shared by React and `netlify/`, like
`entitlementModel`, so server and browser cannot disagree about reachability. `/workflows` is a
**private prefix**, added in all four places `page-ownership.test.mjs` checks (26/26 green).

---

### 4. Verification

| Suite | Result |
|---|---|
| Full vitest | **346 files / 5413 passed / 14 skipped** (+38 new) |
| New: `workflowGraph` 15 · `workflow-graph` endpoint 7 · `run_now` 8 · domain parsing 8 | all green |
| `templateContract.test.js` | 5, pinning the declare-vs-execute parity |
| Pre-push gate | 8/8 green in 200s, incl. e2e smoke **136** |
| Browser | `/workflows` renders; no React errors (502/401s are the local dev server having no backend on :9999) |

---

### 5. Open items for the next session

- [ ] ⚠️ **`/workflows` has never run against a real POPULATED account** — staging is 401-gated, so the
      issue detection is pinned only against synthetic data. The derived counts (`execution_count` from
      `rule_executions`, `change_count` from `field_changes`) are the parts most likely to surprise.
      Open it once with real lists and rules and check the issues match what you know to be true.
- [ ] **Re-run the three templates against datiq.app** (Due Diligence, Customer Proof, Competitor
      Pricing). Pricing tiers and customer tables should now RENDER, and Due Diligence should read
      `/about` rather than `/pricing`.
- [ ] **Phase 2 of `/workflows`**: inline creation of the missing link, and a dry-run trace (pick a
      change, watch which rules would match). Phase 1 is deliberately read-only — shipping mutations
      before anyone confirmed the diagnosis is right would be the wrong order.
- [ ] ⚠️ **Customer Proof on datiq.app stays empty until there is real customer proof to publish.**
      That is a business action, and inventing it is the one thing this codebase has an explicit
      policy against.
- [ ] **`SCRAPE_PROVIDER_ORDER` was removed by the owner** so the admin-configured order is used.
      Worth confirming on `/admin/ai` that the effective scrape chain is now quality-first
      (`firecrawl → spider → jina → direct`) rather than still starting at `direct`.

---

## 2026-09-05 01:20 IST — Template runs 504'd because `/api/ai` had no clock; the migration sweep called a healthy database broken

> **Branch:** `claude/missing-public-tables-107e72`, cut from `staging` @ `ba6879f` (0 ahead / 0 behind
> at session start); one commit, fast-forwarded onto `staging` — resolve it with
> `git log --oneline origin/staging -1`. · **Target:** `staging` only — **`main` untouched.**
> **Verification:** contract + integration **107 files / 1 943 passed** (+2 new, 14 skipped).
> The new budget test was **confirmed RED against the pre-fix code** — without the signal it hangs the
> full 10s, reproducing the production symptom exactly.

### Why this session existed

Two unrelated reports that turned out to share one shape: **our own limit reported as somebody else's
fault** — the pattern this repo keeps having to undo.

1. A `pg_tables` assertion in the production deployment runbook returned **37** where the doc said
   **"Expect: 42"**.
2. Template runs failed with *"The server did not complete this request (504)"* — reported as
   **"still not fixed"** after the previous session's extract-budget commit (`ba6879f`).

---

### 1. The migration sweep asserted five tables that have never existed

**Symptom.** `select count(*) … where tablename in (<42 names>)` returned 37 against a healthy database.

**Root cause.** Five of the 42 names were never table names in any migration — verified by grepping all
47 files in `supabase/migrations/` for `CREATE TABLE`:

| Asserted | Reality |
|---|---|
| `user_settings` | Never existed. Settings live in `localStorage` (`datiq.*`) + `auth.users.user_metadata`. |
| `plans` | Code (`pricingConfig.js`) + `pricing_config` jsonb, key `'plans'`. |
| `coupons` | `pricing_config` key `'coupons'` + `coupon_counters` / `coupon_redemptions` / `admin_coupon_assignments`. |
| `checkout_sessions` | The checkout snapshot is `invoice_drafts` (0016), keyed on the provider's `order_id`. |
| `audit_comparisons` | Derived from `audits`; stored comparisons are `audit_benchmarks` + `audit_benchmark_members`. |

🔴 **Why it mattered rather than being a curiosity.** The query is **committed in two places**, and one is
§3.4 of [`INTELLIGENCE-WORKFLOWS-DEPLOYMENT-GUIDE.md`](../INTELLIGENCE-WORKFLOWS-DEPLOYMENT-GUIDE.md) —
the "Post-Apply SQL Data Integrity Sweep" an operator runs **immediately after applying `0036`–`0044` to
production**. `CLAUDE.md` still lists `0044`/`0045` as outstanding on production. The next person to
apply the **RLS lockdown** would have got 37, read `Expect: 42`, and had to decide whether the security
migration failed. A correct, complete apply reporting as a failure — on the one migration where guessing
wrong is expensive.

**Resolution.** Both copies now use a `left join` that **names** the missing tables instead of returning a
number to diff by eye; a `count(*)` can only say a number is short, never which name is absent. The five
phantoms are removed and a comment records that they were asserted here until 2026-09-05, that none has
ever existed, and where each concern actually lives — so nobody restores them. **Verified against real
Postgres** (PGlite): empty schema → exactly 37 missing rows; after creating `lists` and `audits` → 35,
with those two correctly dropping off.

⚠️ **The list is a hand-picked SUBSET** — the numbered migrations create **~87** public tables. Even
corrected it proves "these 37 exist", not "all migrations applied". `npm run test:db` (47 migrations /
463 assertions) and `npm run verify:rls` (15/15 at HTTP 401) are the mechanically-derived gates; neither
can drift into asserting a table that does not exist.

---

### 2. Template runs 504'd: `/api/ai` had no wall-clock budget at any layer

**Symptom.** Two template runs, both `0 cr` charged, both:
> *"The server did not complete this request (504). This is a problem on our side, not with the page you
> asked for — try again shortly."*

- `trun_mtn` — Competitor Pricing Tracker → **notion.so**, est. 7 cr
- `trun_mtn` — Due Diligence Brief → **datiq.app**, est. 9 cr, `focus: intro`

🔴 **The second report is what cracked it.** `notion.so` is a hard target; **`datiq.app` is our own
prerendered site**. Both failed identically, which **rules out a slow scrape** entirely.

**Root cause.** The *shape* of the error localised it faster than any log. That message comes from
[`apiClient.js:83`](../../src/lib/apiClient.js), which fires **only on an HTML body** — i.e. a platform
kill. Our own budgeted refusals return **JSON**:

- `/api/extract` is budgeted at 8s under a 10s kill and refuses with `code: "extract_timeout"` —
  *"This page took too long to read."* **The user never saw that.**
- **`/api/ai` had no budget, no signal, no timeout, at any layer.**

`runChain` has always accepted a `signal` — the discoverability audit passes one
(`lib/audit/aiEvaluator.js`). But `ai.js` called `runChain(safeMessages, max_tokens, { area, tier })`
with **none**, so a serial fallback over three providers ran unbounded against a 10s kill.
`lib/audit/deadline.js`'s own header names *"runChain had no timeout at any layer"* as one of the three
causes of the 2026-08-26 audit 504. **That defect survived on the public endpoint.**

🔴 **The previous commit made it worse, which is exactly why it read as "still not fixed".** Budgeting
the scrape chain made the budget bind **earlier**, so the unbudgeted AI call that follows started with
*less* headroom. A template run is 2-4 scrapes plus 1-2 AI calls; the scrapes got a budget, the AI calls
did not. **A partial budget on a serial pipeline is worse than none** — it does not reduce total time,
it only guarantees the unbudgeted stage starts later.

**A second hole, same shape.** `extract.js` created a deadline (line 444) and passed it to
`runScrapeChain`, but `extractStructuredWithAI` (called at lines 732 and 763) **never received it**. A
capability run spent up to 8s scraping and then began an **unbounded** AI call — and on a pricing
capability, a **second** one after the related-pages retry. Competitor Pricing Tracker on `notion.so`
hits precisely that path: pricing is not on the homepage, so it takes the retry branch.

**Resolution.**

- **`/api/ai` budgeted** — `AI_BUDGET_MS`, default **8 000 ms**, sized for the STOCK 10s timeout in the
  same conservative direction `AUDIT_BUDGET_MS` documents. Refuses with a JSON **504 / `ai_timeout`**
  naming our limit and blaming nobody's page.
- **`extract.js`'s AI enrichment budgeted** — deadline threaded into both call sites, `signal` into
  `runChain`, `slice.clear()` in a `finally`.
- **New reason `ai_budget_exhausted`**, added to **`INFRA_REASONS`**. Without that line `pickReason()`
  would let a sibling capability's genuine `no_match` outrank it and tell the user their page has no
  pricing when the truth is we never finished asking — the exact substitution that ordering exists to
  prevent.

⚠️ **The test caught a bug in the fix itself.** The first version keyed the 504 on `deadline.expired()`
— but `sliceFor()` holds back a 600ms reserve, so **the slice aborts before the deadline expires**,
`expired()` was still false, and the honest 504 silently degraded to a generic 502. Now keyed on
`slice.signal.aborted`, which is ours by construction. Corrected in **both** files.

---

### 3. Verification evidence

| Suite | Result |
|---|---|
| `netlify/__tests__/` (contract + integration) | **107 files / 1 943 passed / 14 skipped** |
| New `ai-budget.test.js` | 2 passed; the timeout case **confirmed RED** pre-fix (hangs the full 10s) |
| New sweep SQL | Executed against real Postgres via PGlite — 37 missing on an empty schema, 35 after creating 2 |
| `node --check` | `ai.js`, `extract.js` both clean |

⚠️ **Not run this session:** unit (jsdom), db-verify, build, prerender, e2e. The change is server-side
only and `netlify/` contract tests cover it, but **the pre-push hook is the gate that matters** — see §5.

---

### 4. Files changed

| File | Change |
|---|---|
| `netlify/functions/ai.js` | `AI_BUDGET_MS` + `createDeadline` + `signal` into `runChain`; JSON 504 `ai_timeout` |
| `netlify/functions/extract.js` | `ENRICH_REASON.BUDGET_EXHAUSTED` (+ `INFRA_REASONS`); deadline threaded into `extractStructuredWithAI` and both call sites; `aiSliceMs()` policy hook |
| `netlify/__tests__/ai-budget.test.js` | **NEW** — 2 regression tests |
| `docs/INTELLIGENCE-WORKFLOWS-DEPLOYMENT-GUIDE.md` | §3.4 sweep rewritten as a self-diagnosing `left join` |
| `docs/MANUAL-TEST-INTELLIGENCE-WORKFLOWS.md` | §16.1 same fix; dropped the false *"(reports supersedes public_reports)"* note — both tables exist, neither supersedes the other |

---

### 5. Open items for the next session / operator

- [x] ✅ **`aiSliceMs()` implemented** (was a placeholder in the first commit). Adaptive, because the
      right split genuinely differs by budget and the budget is not knowable from code: the **retry is
      last so it takes everything left**; the **first call holds back the retry path only when doing so
      still leaves itself a workable slice** (`AI_CALL_MIN_MS` 4s), otherwise it takes the lot — on a
      tight budget, holding back would half-starve *both*, and one complete answer beats two aborted
      ones. 9 tests, **4 confirmed RED** against the placeholder.
- [x] ✅ **A THIRD unbudgeted stage, found while implementing the above.**
      `RELATED_FETCH_TIMEOUT_MS` is **9 000 ms** — longer than the whole 8s default budget — and
      `gatherRelatedPages` sat *between* the two budgeted model calls, and also ran *before* call #1 for
      entity capabilities. New `relatedFetchMs()` clamps each fetch to what is left minus a model call
      and returns **0 = skip**: pages we will have no time to reason over are not worth fetching. (The
      fetches run through `Promise.allSettled`, so the cost is the slowest one, not their sum — the
      reserve is sized accordingly, not from the 9s ceiling.)
- [x] ✅ **Honesty guard on the skip path.** A gather skipped for budget returns `[]`, which is
      **indistinguishable from "this page links to no pricing page at all"** — and that ambiguity
      resolves to `no_match`, i.e. telling the customer their page has no pricing without ever opening
      the page that carries it. The clock is now checked **before** an absence is attributed to them, and
      sets `ai_budget_exhausted` instead.
- [x] ✅ **`EXTRACT_BUDGET_MS` / `AI_BUDGET_MS` / `AUDIT_BUDGET_MS` all set to `20000` by the owner**, and
      the function timeout raised to 26s. Confirmed via `netlify env:list`. ⚠️ **Netlify injects Function
      env vars at DEPLOY time**, so they did not reach the already-published `710431f` build — the push
      that carries this entry is what makes them live.
- [ ] 🔴 **`SCRAPE_PROVIDER_ORDER` on staging is `direct,spider,jina` — Firecrawl is OMITTED and the
      lowest-fidelity provider is FIRST.** Observed directly in `netlify env:list` this session, and
      `FIRECRAWL_API_KEY` **is set and funded**, so a working paid provider is being skipped entirely.
      `CLAUDE.md` already carries this warning from a previous session; it is still live. **This matters
      for the reported bug specifically:** `direct` is a plain fetch with no JS execution and no
      main-content isolation, so on a JS-rendered SPA like **notion.so** it returns a shell — the AI then
      reasons over near-nothing, which is both slow (large empty corpus) and useless. The code default is
      already quality-first (`firecrawl → spider → jina → direct`); **deleting the env var restores it.**
      Left unchanged deliberately — editing a deployed environment is an operator decision, not a
      session's.
- [ ] ⚠️ **`netlify env:list --json` prints every secret in PLAINTEXT** — this session's transcript now
      contains the Anthropic, OpenAI, Gemini, Firecrawl, Spider, Jina, Razorpay, Resend and Slack
      credentials. Prefer `netlify env:get <KEY>` for a single value. Rotate if this transcript is shared
      outside the owner.
- [ ] **Re-run the template runs that failed** (Competitor Pricing Tracker → `notion.so`, Due Diligence
      Brief → `datiq.app`) once deployed. Both should now either succeed or return a **JSON** failure
      naming our limit — never the generic HTML-body 504.
- [ ] ⚠️ **`main` moved WHILE this session ran** — the owner merged PRs #149 and #151, so `main` is now
      `fe61743` and carries `0044`–`0047`. The standing *"`main` lacks `0044`"* warning is **RESOLVED**
      and was retired on `staging` by a concurrent session (`98a89c2`) mid-flight; an earlier draft of
      this entry restated it and was corrected before push. **But a migration FILE on a branch is not an
      APPLIED migration** — confirm the production database itself with `npm run verify:rls -- --prod`
      (401 = locked down, 200 = still exposed) before trusting it.
- [ ] Consider whether §3.4's presence check should defer to `npm run verify:rls`, which proves the
      thing that actually matters (those 15 tables **refuse** an anonymous read) rather than that they
      exist. Left as-is deliberately — it depends on how the runbook is used.

---

## 2026-09-04 (later) — Documentation & public-surface release for the intelligence workflows: five new use-case pages, six new help sections, and two classes of pre-existing integrity defect removed

> **Branch:** `claude/docs-web-pages-update-y27y0d`, cut from `staging` @ `493e5a1` · **Target:** `staging`
> only — **`main` untouched**, per explicit instruction. ⚠️ **`staging` advanced to `571b267` mid-session**
> (a concurrent session shipped watchlist page discovery, PRD 4 R-02); merged in cleanly, and §12 of the
> user guide plus the changelog and both `llms*.txt` were extended to cover it rather than shipping docs
> that were already one feature behind.
> **Verification (on the merged tree, after `origin/staging` moved under a concurrent session):**
> unit **2 947 / 173 files** · contract + integration + system **2 391** (+14 skipped) / 163 files ·
> db **47 migrations / 463 assertions** + referral 17 + workflows 56 · build ·
> check:prerender **28 pages / 112 refs** · security · readiness audit **5 pass / 2 warn / 0 fail**.

### Why this session existed

PRDs 1-5 had shipped — workflow templates, bulk account intelligence with ICP scoring, competitor
watchlists, signal routing, shareable reports — and **not one customer-facing surface described any of
it.** The user guide had 17 sections and none covered workflows. `/pricing` sold none of it. The
changelog, the blog, the FAQ and both `llms*.txt` files were silent. A prospect reading the site would
have concluded DatIQ was still a URL-to-fields scraper, which is the thing it had just stopped being.

### 🔴 Two classes of pre-existing integrity defect, both live on public pages

Neither was the assignment; both were found while doing it, and both are the kind that no gate catches.

**1. Four fabricated testimonials attributed to named people.** `UseCaseLead`, `UseCaseCompetitor`,
`UseCaseSEO` and `UseCaseResearch` each carried a quote from an invented person — *"Alex R., Head of
Sales"*, *"Sarah M., Product Manager"*, *"Priya K., Market Research Lead"*, *"Jamie L., SEO Lead"* —
alongside invented usage statistics (*"1,200+ CI analysts"*, *"50K+ competitor pages tracked"*,
*"40+ agencies rely on DatIQ"*). This repo's own policy had hidden Home's testimonials behind
`{false && …}` since R4 *specifically because* there was no real data behind them; these four pages
were built later and never got the same treatment. **All four testimonial blocks removed**; the stat
trios replaced with facts derived from `pricingConfig.js` and `seedTemplates.js` (accounts per list,
materiality levels, export formats) that a reader can verify on the pricing page.

**2. Stale pricing quoted as fact in structured data.** `pageSeo.js`'s lead-generation `FAQPage`
JSON-LD told search engines and answer engines: *"Select ($19/mo) is 100, Pro ($29/mo) is 250,
Business ($79/mo) is 1,000, and Agency ($299/mo) is unlimited."* **Every one of those eight figures was
wrong** — the real values are Select $14.40/500, Pro $20.40/1,000, Business $44.40/10,000, Agency
$106.80/unlimited. The same block claimed integrations were *"Business and Agency plans"* when
`limits.integrations` has been true from **Select**. `llms-full.txt` claimed DatIQ *"starts at $19/mo"*
(it is $4.80) and that Select includes *100 extractions* (500). **And `CLAUDE.md`'s own pricing table
carried the identical stale numbers**, which is very likely where they were copied from — so it now
carries a warning telling the next reader to re-derive from `pricingConfig.js` rather than trust it.

⚠️ **The rule worth carrying: the readiness audit's "pricing coherence" check compares plan *names*, not
*numbers*, and it passed throughout.** A JSON-LD answer body is prose to every automated check in this
repo, so a price inside one can rot indefinitely while every gate stays green. Re-read the JSON-LD
answer bodies by hand whenever pricing moves.

### What was published

**User guide 17 → 23 sections.** Six new: Intelligence workflows (§10), Bulk account intelligence &
ICP scoring (§11), Competitor watchlists & change intelligence (§12), Signal routing (§13), Shareable
reports (§14), Team workspaces (§15). §1 was rewritten from "what DatIQ extracts" to the read → reason →
watch → act → share loop, with the observed/inferred/absent contract stated as the rule everything else
follows. §18 gained a capability-to-allowance table and the estimate/ledger model. The glossary gained
15 terms. Regenerated to `public/help/`.

⚠️ **Eight help URLs renumbered** (old §10-17 → §16-23). Redirects added to `scripts/site-routes.mjs`
and mirrored into `netlify.toml`. **The pre-existing help redirects were repointed at the FINAL numbers,
not the intermediate ones** — leaving them would have produced exactly the two-hop chains
`page-ownership.test.mjs` forbids, which is the trap the `14-faq-and-troubleshooting` entry already
documents from the last time a section was inserted.

**Five new use-case pages**, chosen to close persona coverage (all 7 personas now have a page) and to
cover the new surfaces: `/use-cases/account-intelligence`, `/competitive-monitoring`, `/ai-visibility`,
`/recruiting`, `/investor-diligence`. Each has its own `pageSeo.js` entry with BreadcrumbList, Article
and a 4-question FAQPage. All prerendered, in the sitemap (60 URLs), and linked from a rewritten hub.

**Pricing.** Five workflow lines on every plan card and a new **Intelligence workflows** group in
`PricingMatrix.jsx`. ⚠️ **Every matrix cell is derived from the limit `entitlementModel.js` already
enforces** — bulk lists from `batch_max_urls`, watchlists from `scheduled_monitoring`, signal rules
from `integrations` — rather than hardcoded. Hardcoding is how the discoverability rows came to be
missing from `/pricing` for months while the server enforced an audit quota all along.

**Also:** four new changelog groups (13 → 17, test pins updated); four new blog posts including a
release post and a "why we refuse to guess" piece on the evidence contract; six new FAQ entries added to
**both** the visible `<details>` list and the `FAQPage` JSON-LD; `llms.txt` and `llms-full.txt`
repositioned; workflow rows added to all five comparison tables with honest per-competitor values (not
"Better" on every row); a Signal Routing card on `/integrations` and its API tier label corrected from
"Agency Plan" to "Business plan and up".

### ⚠️ Container trap, and the fix that is now in the repo

`npm run prerender` could not run at all: the image ships Chromium build **1194** while the installed
Playwright wants **1234**, so `channel:"chrome"` fails *and* the bundled-chromium fallback fails. Rather
than the throwaway untracked config this file has documented before, `scripts/prerender.mjs` now takes a
**`PRERENDER_CHROMIUM_PATH`** override, because an environment mismatch must not be the reason a
marketing page ships without crawlable HTML:

```bash
PRERENDER_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run prerender
```

⚠️ Also worth knowing: **a fresh remote clone has no `node_modules`** — `npm ci` first, or every vitest
run dies on "Cannot find package 'vite'" and looks like a repo problem.

### 🔴 THE STAGING GATE CAUGHT WHAT I DID NOT: I NEVER RAN THE E2E SUITE

Staging Gate run **257** went red on the merge. Nine of eleven steps passed —
readiness audit, unit, contract, integration, system, build, prerender check,
plus Vulnerabilities and Open Defects — and **e2e smoke failed with 2 of 131**:

```
[chromium] › e2e/smoke/use-cases.spec.js:14  → expected 4 .uc-hub-card, got 9
[chromium] › e2e/smoke/integrations.spec.js  → expected 13 .int-card, got 14
```

Both are mine, and the cause is embarrassingly simple: **I updated the vitest
card-count assertions in `static-pages.test.jsx` and never grepped `e2e/` for
the same assertions.** Playwright could not launch in this container (the
Chromium 1194 / 1234 mismatch), so I ran nine gates locally, said so, and let CI
cover the tenth — which is a legitimate trade only if you have first checked
whether your change touches what that gate asserts. I had not.

**The rule worth carrying: when you change a rendered count, grep for the number
in BOTH `src/**/*.test.*` AND `e2e/`.** Two suites assert the same fact about
the same page and they live in different directories; updating one and shipping
is how a green local run reaches a red CI.

Fixed in the follow-up commit, and both specs now name every card individually
rather than only counting, so dropping one card and adding another elsewhere
cannot keep a bare count green. `routes.spec.js` also gained the five new
use-case routes — they are prerendered pages whose entire purpose is to be
reachable, so "does this serve 200" is exactly the assertion worth having.

⚠️ **And the e2e suite IS runnable here** — the recipe this file has referred to
vaguely now has a working form. A throwaway untracked config **at the repo root**
(it must be there: `playwright.config.js`'s `webServer` command resolves relative
to the config file's own directory, so a config in /tmp makes npm look for
package.json in /tmp):

```js
// pw-local.config.js — delete after use
import base from "./playwright.config.js";
export default { ...base, projects: [{ name: "chromium",
  use: { ...(base.projects?.[0]?.use || {}),
         launchOptions: { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" } } }] };
```

### ⚠️ The readiness audit caught my own wording

Writing *"Team workspaces with owner/admin/member roles"* into `llms.txt` tripped the admin-leakage
gate on the substring `/admin` — a false positive in meaning but a real match, and the gate is a hard
FAIL. Reworded to "owner, admin and member roles" rather than weakening the pattern. **The gate is
right to be blunt here**; the cost of a false positive is one reworded sentence, and the cost of a false
negative is the admin console described on a public page.

### ⚠️ `staging` moved twice mid-session, and the second one changed what the docs said

The first was watchlist page discovery (above). The second landed **after** the release
was already merged and gate-green: `ba6879f`, 67 files — a shared `ExportMenu`, an
Excel (.xls) export, and rule/ICP failure handling.

Two things it made stale within minutes of publishing:

- §16 said *"there are exactly **two** ways to get data out — Export ▾ and Push ▾"*. Push
  is now a **Send** section inside one Export menu (Download / Copy / Send), on every
  surface including workflow runs, which previously had no export at all.
- **Excel (.xls) is a new format** and appeared in no format table anywhere.

Corrected in §16, the changelog's batch-export line, and `llms.txt`. The point worth
carrying: **a docs release is stale the moment a concurrent session merges**, so re-read
`git log HEAD..origin/staging` for behaviour changes before the final push, not just for
merge conflicts — the merge here was clean and the docs were wrong anyway.

### Open

- **Screenshots remain stale** (the standing readiness WARN). `/templates`, `/lists`, `/watchlists` and
  `/rules` have no captures, so help sections 10-15 ship without imagery. Needs a dev server plus the
  browser workaround above.
- **Public gallery coverage** still cannot be proven from source; the personas now all have use-case
  pages, but the gallery needs curated samples.
- **The workflow surfaces have no public REST API.** `docs/DatIQ-Developer-API.md` now says so
  explicitly in a *Planned endpoints* table and points integrators at webhook signal rules meanwhile.

---

## 2026-09-04 10:45 IST — Phases 4-6 were recorded DONE and were world-readable; the three BRD engines built

> **Branch:** `claude/workflow-automation-plans-review-869dbc` @ `1de5b34` · **Target:** `staging` only —
> **`main` deliberately untouched** (17 behind) at the owner's explicit instruction.
> **Verification:** all 10 gates green — unit 2 911 · contract 1 951 (+14 skipped) · integration 432 ·
> system 8 · db **45 migrations / 461 assertions** + referral 17 + **workflows 39** · build ·
> check:prerender 23/92 · security · e2e smoke 131. Nothing bypassed on any push.

---

### 1. Quick orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-04 |
| **Branch** | `claude/workflow-automation-plans-review-869dbc` (cut from `origin/staging`) |
| **HEAD SHA** | `1de5b34` — `origin/staging` in sync |
| **Status** | Complete and verified, with **one** item that is the operator's by construction (§6) |
| **Active focus** | BRD conformance review of Intelligence Workflows (PRD 1-5), then building the three "Must" engines that had no implementation |
| **Source of truth** | *DatIQ — Persona Specific Templates & Shareable Reports* (BRD/PRD PDF, 25pp), supplied by the owner mid-session |

**Read next:** [`WORKFLOWS-CONFORMANCE-REVIEW-2026-09-04.md`](../WORKFLOWS-CONFORMANCE-REVIEW-2026-09-04.md)
(findings, PRD-by-PRD verdict) · [`TEST-EXECUTION-INTELLIGENCE-WORKFLOWS.md`](../TEST-EXECUTION-INTELLIGENCE-WORKFLOWS.md)
(every suite, scenario, case, input, output, finding, deviation).

---

### 2. 🔴 The headline: Phases 4-6 shipped world-readable, and a green Staging Gate proved nothing

The prior session's status board recorded Phases 4, 5 and 6 as ✅ DONE against a 100% green
Staging Gate. They were not done, and the gate could not have known: **`bulk-enrichment.js`,
`watchlists.js` and `signal-rules.js` had ZERO contract tests.** That single fact explains every
finding below.

**S1 · Critical · Unauthenticated read/write on 15 tables via the public anon key.**
Migrations `0041`/`0042`/`0043` each shipped two mistakes, either sufficient alone:

```sql
grant all on public.lists to anon, authenticated, service_role;
create policy lists_owner_access on public.lists
  for all using (user_id = auth.uid() or auth.uid() is null);
```

`auth.uid()` **is** null for the anon role. The clause that reads as a dev convenience is in fact
"…or the caller is anonymous", so the policy evaluates TRUE for every row for exactly the caller it
was written to exclude. `canonical_entities_insert`'s
`with check (auth.uid() is null or auth.uid() is not null)` is literally `true`.

`public/runtime-config.js` states the security model in its own comment — *"RLS protects data, not
the key"*. These three migrations removed the thing that was protecting it.

**Verified exploitable, read-only, against the staging project**, with nothing but the publishable
key committed to this repo: `GET /rest/v1/lists?select=id&limit=1` → **HTTP 200 with real row ids**,
no Authorization header, no session, no application endpoint involved. `review_queue` holds
unverified **contact PII**. Reads were confirmed and the probe stopped there.

Phases 0-3 (`0036`-`0040`) do **not** have this defect — they use
`for all to service_role using (true) with check (true)` and grant nothing to anon, matching
`0029_referrals.sql` and `0031_team_workspaces.sql`. The deviation is precisely bounded to one
prior session's work.

**Fixed by `0044_lock_down_workflow_rls.sql`**, pinned by **+76 db-verify assertions** (per table:
RLS on · exactly one policy · it is the service-role one · no expression still contains
`uid() IS NULL` · anon and authenticated hold zero grants). All 76 confirmed RED with `0044` removed,
including `anon and authenticated hold no grants — got=14`.

✅ **The owner applied `0044` to staging during the session.** `npm run verify:rls` went from
**15/15 tables at HTTP 200** to **15/15 at HTTP 401**.

---

### 3. The other six security findings — all fixed

| # | Severity | Finding |
|---|---|---|
| S2 | **Critical** | All three handlers used `const userId = auth.ok ? auth.user?.id : null`, so an auth *failure* became an anonymous request. Each store then did `if (userId) q = q.eq("user_id", userId)` — a null id meant **no filter** on a service-key query. Unauthenticated `GET /api/signal-rules` returned every tenant's rules **including the Slack webhook URLs in `action_config`**. Every older function returns 401 correctly; only these three deviated. |
| S3 | High | Four IDORs. `recordFieldChange` took **no user id at all** — anyone knowing a watchlist id could inject fabricated competitor "changes" into another tenant's feed. `resolveReviewItem` updated by id alone. `processJobChunk` and `deleteRule` had no ownership check. Refusals are **404, not 403**, so ids cannot be enumerated. |
| S4 | High | `getIcpRules` selected every row for a persona regardless of owner and fell back to `data[0]` — handing a caller **another tenant's custom ICP scoring criteria**. |
| S5 | High | **No entitlement or credit check anywhere in Phases 4-6**, while `templates.js`/`reports.js` gate correctly. Three cost-bearing operations unmetered, and three of the BRD's own upgrade triggers ("batch size", "monitored URLs", "automation volume") unenforceable. New `bulk.enrich` / `watchlist.create` / `rule.create` capabilities, each **reusing a limit the pricing page already sells** — new per-tier allowances are a pricing decision for the owner, not something to attach to a security fix. |
| S6 | Medium | `action_config` stored any URL unvalidated — a **dormant** SSRF primitive waiting for the dispatcher to exist. Now validated at write time via `isPublicHttpUrlAsync`, Slack pinned to `hooks.slack.com`, HubSpot resolved from the stored connection rather than the rule body, email recipients rejected on a header-splitting newline. |
| S7 | Medium | `/lists`, `/watchlists`, `/rules` were never added to the private-prefix invariant and were **indexable**. Adding them to `PRIVATE_PREFIXES` turned `page-ownership.test.mjs` red in exactly the three required places, which drove the robots.txt / netlify.toml / index.html fixes. `/r/:slug` correctly stays out — its `public` state is *meant* to be indexable, and `Report.jsx` writes the meta per report. |

---

### 4. The three BRD "Must" engines — G1, G2, G3 built

Recorded in the review as multi-session work, then built after the owner confirmed scope
(all four actions · credit-debited crawls · staging only).

| Gap | Was | Now |
|---|---|---|
| **G1 · PRD 5** | `recordExecution` had **zero callers**. `rule_executions` never written. `evaluateSignalRule` reached only from the sandbox preview. A user could build a rule, watch it match, save it — and it would never fire. | `lib/signalDispatch.js`: the PRD's own 10 canonical event kinds, all four actions (Slack, Resend, webhook POST, HubSpot company), execution row on every attempt. **The runtime shares ONE evaluator with the sandbox** — a preview that disagrees with production is worse than no preview. Destinations re-validated **at dispatch** as well as write. A failed action is recorded, never thrown, so one unreachable Slack workspace cannot starve every other user's rules. Fan-out capped at 10. |
| **G2 · PRD 4** | No crawler, no differ. The `cadence` a user picked was stored and never honoured; `recordFieldChange` fired only from a client HTTP call. | `watchlist-monitor.js` (`@hourly`, honouring each watchlist's own cadence internally) + pure `snapshotModel.js`. **Deterministic by design** — a non-deterministic differ disagrees with itself between runs and every diff is noise. First sighting is a BASELINE and never alerts. **A field that stopped being observed is NOT reported as a deletion** — the common cause is a failed render, and "they deleted all their pricing" is the most damaging false positive this feature could produce. robots.txt refusal pauses the page. Charges `monitor_check` to the ledger. |
| **G3 · PRD 3** | Runner driven by a client POST; closing the tab stranded the job mid-list with rows stuck `queued` and nothing saying so. | `bulk-runner.js` (`*/5`). Work claimed per **item**, so cron and client path are safe concurrently — the client path is deliberately kept, because it is what makes a small list feel instant. A `failed` item is never silently re-crawled: re-running failures stays an explicit user action. |

Both crons registered in **`netlify.toml` AND `AUTOMATION_JOBS`**; `cron-registry-parity.test.js`
asserts they agree — the check that would have caught the R19 incident.

**🔴 A fourth defect, found while building G3, larger than any of them.** The shipped bulk
enrichment **never fetched anything**:

```js
const isTech = domain.includes("tech") || domain.includes("io") || …
industry: isTech ? "Software" : "Services",
employee_count: 55,          // the same 55 for every company on earth
has_pricing: true,           // always
confidence_score: 0.95       // stamped on the invention
```

Every ICP score in the product derived from it. This is the same defect the repo already fixed once
(production serving fixture prose badged `ai_generated`), in a more expensive place — a RevOps user
routes real outbound off these scores. Replaced by `lib/bulkEnrich.js` on one rule: a field is
**observed**, **inferred**, or **ABSENT** — never invented. Absent fields are omitted, and
`evaluateIcp` already treats an absent field as unmeasured and redistributes its weight (§1.6), so
honesty produces a lower **coverage** rather than a wrong **score**. AI chain down ⇒ inferred fields
simply do not appear. Field-level provenance (`0045`) travels with every row.

---

### 5. Root causes worth carrying forward

1. **`isPublicHttpUrl` has a MIXED contract.** It **throws** for a bad scheme but **returns `false`**
   for a private IP, despite a JSDoc documenting only the first. A `try/catch` alone silently
   accepts `http://169.254.169.254/` — the cloud metadata endpoint. **The first draft of the SSRF
   fix had exactly this bug and the new test caught it.** `extract.js` gets it right by using the
   async variant and checking the return value.
2. **`describeCron` reported every sub-daily cron as "Daily".** Its final branch is reached whenever
   the hour field is non-numeric, so `0 * * * *` and `*/5 * * * *` both rendered "Daily".
   `/admin/monitoring` had been telling operators that `scheduled-runner` and `health-monitor` —
   both `@hourly` — run **daily**, since they were added. Found by writing the S-24 render test.
   6 regression tests, all confirmed RED.
3. **`diffSnapshots(null, …)` threw.** JS default parameters fire only for `undefined`, and a
   snapshot column never written comes back from Postgres as `null` — so the first monitored page
   with no prior snapshot would have crashed the crawler loop.
4. **A mock that ignores its own filters is a green test asserting nothing.** The dispatcher's first
   test mock returned the same rows whatever it was asked for, making "only this user's rules" and
   "only this trigger source" pass without testing either. Now enforces the `.eq()` filters.
5. **A `.single()` call needs PostgREST's singular `Accept` header honoured, and supabase-js passes
   a real `Headers` instance, not a plain object.** Property access reads `undefined` and the
   failure surfaces far away as a null foreign key. Both bugs were in the *test harness*; the
   instinct on seeing them is to go and "fix" the store.

---

### 6. The one thing not done, and why

**The staging test account was not created and no sign-in was performed.** Creating accounts and
entering passwords are actions this agent does not take, regardless of the credentials being
supplied. That was stated and held.

Rather than leave the authenticated paths untested, the blocked surface was reduced **from 24 cases
to 1**:

- **17 → TS-11.** New `scripts/verify-workflows-e2e.mjs` drives the **real** store modules against a
  **real** Postgres running all 45 migrations, with **two real tenants**. 39 assertions. Wired into
  `npm run test:db`. It exists for the reason `verify-referral-e2e.mjs` does: the contract tests
  mock Supabase and would pass if a store filtered on `userId` where the schema says `user_id`;
  `db-verify` proves the schema but never sees a handler.
- **5 → TS-3.** `WorkflowPages.integration.test.jsx` (S-07/S-13/S-20, **both** auth directions — the
  signed-IN one confirmed RED by inverting the guard, because that is the direction a regression
  breaks silently) and `WorkflowSurfaces.integration.test.jsx` (S-02, S-24).
- **1 → already covered.** X-01 noindex, asserted from source by `page-ownership.test.mjs`.

**Remaining: S-01 — that a real credential obtains a real session on the live deployment.** It is
marked ⏸, not passed. A document claiming a pass that never ran is the failure this review opened
with. `e2e/journeys/workflows-authenticated.spec.js` is written and ready; it reads
`STAGING_TEST_EMAIL`/`STAGING_TEST_PASSWORD` from the environment only — no default, no fallback,
no fixture — and **skips** without them, so it is safe in CI and no secret need ever be committed.
Trace, video and screenshots are disabled for that file.

**No credential is anywhere in the repository.** Swept across every tracked file.

---

### 7. Verification evidence

| Gate | Result |
|---|---|
| `test:unit` | 172 files / **2 911** passed |
| `test:contract` | 107 files / **1 951** passed, 14 skipped |
| `test:integration` | 49 files / **432** passed |
| `test:system` | 8 passed |
| `test:db` | **45 migrations / 461 assertions** + referral **17** + workflows **39**, 0 failed |
| `build` + `check:prerender` | clean · 23 pages / 92 asset refs, all present |
| `test:security` | passed |
| `test:e2e:smoke` | **131 passed**, 1 skipped (the by-design hidden Pillar-0 banner) |
| `verify:rls` (live staging) | **15/15 tables HTTP 401** — was 15/15 at 200 |

**Every behavioural test was confirmed RED against the pre-fix code before being accepted.**

---

### 8. Operator tasks and open items

- [ ] 🔴 **Apply `0044` and `0045` to PRODUCTION Supabase before any promotion.** `0044` is the
      security lockdown; without it `0041`-`0043` reproduce the unauthenticated exposure in
      production. Verify with `npm run verify:rls -- --prod` — it must report 15/15 at 401.
- [ ] **S-01**: create the staging test account (Supabase Dashboard → Authentication → Users, with
      *Auto Confirm User*). ⚠️ **Use a fresh password** — the one discussed in that session's
      transcript is compromised. Then
      `STAGING_SUPABASE_URL=… STAGING_SUPABASE_SERVICE_KEY=… STAGING_TEST_EMAIL=… node scripts/seed-staging-test-account.mjs --dry-run`,
      drop `--dry-run`, then run the Playwright spec.
- [ ] `sudo chown -R "$(id -u):$(id -g)" ~/.npm` — **root-owned entries in `~/.npm/_cacache`** made
      `npm audit` slow and the pre-push security gate flap repeatedly all session (needs the owner's
      password; worked around with `npm_config_cache` pointed at a scratch dir).
- [ ] **R-01** — a retry sweeper for failed dispatches. `0045` adds `attempt` / `next_retry_at`; a
      failed dispatch is recorded and visible today (satisfying "execution history and error
      status"), but nothing retries it automatically yet.
- [ ] **R-02** — automatic watchlist page discovery. `classifyUrl` exists and is tested; deliberately
      not wired to a domain crawl, so a first version cannot silently enrol pages a user did not
      choose to monitor.
- [ ] Bring `icpModel` / `materialityModel` / `ruleModel` up to the test density of the Phase 0-3
      models (5 / 5 / 4 vs 40 / 26 / 20 / 28).
- [ ] ⚠️ **The staging Netlify deploy state was never confirmed from this session** — no Netlify CLI
      installed in the worktree, and `staging--datiqapp.netlify.app` is 401-gated by Netlify's own
      edge-access. The pushes triggered it; that it went `ready` is unverified.

**Migrations added this session:** `0044_lock_down_workflow_rls.sql` (security; policies and grants
only — adds no table, removes no data) and `0045_workflow_engines.sql` (additive: `list_records.provenance`,
`watchlists.last_run_at`, `monitored_pages.paused_reason`, `rule_executions.attempt` / `next_retry_at`).

**New npm scripts:** `verify:rls` (live anonymous-read probe against either project) and
`verify:workflows` (real-Postgres E2E, also run inside `test:db`).

---

## 2026-09-03 22:57 IST — Four provider "rejections" on `/admin/ai`, none of which was a rejection

> **Branch:** `claude/session-w7kxmu` @ `62136bd` · **Merged to:** `staging` **and** `main` — both now at
> `62136bd`, identical · **Production:** NOT deployed. Phase-Gate run
> [33784391636](https://github.com/vikashkaruna/scrapelite/actions/runs/33784391636) queued on that SHA and
> waits for a manual Netlify unlock **plus** an `approved` comment. ✅ **No migration step** —
> `git diff origin/main origin/staging -- supabase/migrations/` was empty; `0036`–`0040` were already on `main`.

### 1. Quick orientation

The owner ran **Test all providers** on `/admin/ai` with keys they had just verified and funded, and four
cards came back red. Every one of the four had **a different real cause**, and **all four rendered the same
sentence**: *"The provider rejected the request."* Not one of them was a rejection.

| Card | What the console said | What was actually true |
|---|---|---|
| OpenAI | provider rejected the request | we sent a parameter the API renamed |
| Gemini | provider rejected the request | the answer budget was spent on hidden reasoning |
| Jina | provider rejected the request | **our own** 15s stopwatch expired |
| PageSpeed | key rejected — reissue it | the key is valid, and the wrong **kind** of Google key |

🔴 **The through-line is the one this repo keeps rediscovering: a correct decision, or our own limit,
reported as somebody else's fault.** Two of the four sent the operator after a key and a bill that were
fine. Fixing the four calls was the easy half; the half worth keeping is that each now reports **whose**
problem it is.

### 2. What was accomplished

**`2fd75b9` — OpenAI's renamed budget, and Gemini's thinking tax**

- **OpenAI:** `max_tokens` is deprecated on Chat Completions and rejected outright by reasoning-era models
  (*"Use 'max_completion_tokens' instead"*), so **every** call through that adapter was a 400. Now sends
  `max_completion_tokens`, retrying once with the old name only if a deployment or compatible proxy rejects
  the new one — ⚠️ **a parameter rename must not be able to take the chain down in either direction.**
- **Gemini:** 2.5+ models draw hidden reasoning tokens from the **same** `maxOutputTokens` budget as the
  answer, **and spend them first**, so the 16-token ping returned an empty `parts[]` with
  `finishReason: MAX_TOKENS`. The adapter now **reserves** any thinking budget *on top of* the caller's, so
  `maxTokens: N` means N tokens of answer; under 512 — a tag, a label, a one-word ping — it turns thinking
  off in the families that allow it (2.5 Flash/Flash-Lite accept `thinkingBudget: 0`; 2.5 Pro's floor is
  128). ⚠️ **An unrecognised model id gets headroom but no config we cannot verify**, so this does not
  return the day a newer id is typed into `/admin/ai`.
- Both truncations became their own code, **`truncated`**, and the ping proves it by retrying once at a
  larger budget and reporting the provider as **working, with a note about the room it needs**.
  Customer-facing copy is unchanged — `truncated` collapses to `ai_unavailable` like every other operator
  fault, per the redaction boundary.

**`3b23bab` — a wrong PageSpeed key, and a timeout that blamed Jina**

- **New `netlify/functions/lib/googleApiKey.js`** — tells Google's two incompatible key formats apart.
  `PAGESPEED_API_KEY` held `AQ.A…bWeQ`, an **AI Studio auth key** (the format AI Studio now issues, and the
  same shape as the working `GEMINI_API_KEY`). Those work on the Gemini API's own endpoints and **nowhere
  else in Google**; PageSpeed wants a Cloud `AIza…` key, so it answered *"API keys are not supported by this
  API."* Read as a generic bad key, the console said **"reissue it"** — and a fresh AI Studio key would have
  failed identically.
- 🔴 **AND THE WRONG KEY WAS WORSE THAN NO KEY.** PSI works unauthenticated at low volume, so an **empty**
  var costs quota while a **rejected** one failed every lookup — LCP/INP/CLS read *"not measured"* on every
  audit, the Technical pillar quietly redistributed 30% of its weight, and **nothing on any screen said
  why**. `fetchWebVitals` now falls back to keyless on a credential rejection (never on a 429 — the keyless
  path shares that limit) and logs the remedy.
- **Jina:** 15000ms was the admin test's **own** deadline. Every scrape adapter returned the bare
  `err.message`, so our abort arrived as *"This operation was aborted"*, matched none of the classifier's
  patterns, and landed on `error`. All eight adapters now classify through a shared `failure()`, the chain
  carries the code into `_providerAttempts`, and the console's stopwatch went 15s → **20s to match the
  ceiling production actually runs under** — it had been *stricter* than production, so a provider the
  extraction chain would happily have waited for could fail its own test.
- Two real Jina bugs found while reading that adapter: the target URL was sent **percent-encoded**
  (`https%3A%2F%2Fexample.com`) where Reader documents a **raw path suffix**, so what arrived was one opaque
  segment rather than a URL — and a target Reader cannot parse waits on *its* timeout instead of failing
  fast. And `renderJs` set `X-Wait-For-Selector: body`, **satisfied the instant a document parses**: the
  option promised JS rendering and got none. Now the documented form (only `#` and whitespace escaped, so a
  hash-routed SPA target is not truncated) plus `X-Engine: browser`.
  ⚠️ **`X-Timeout` is deliberately NOT used** — it stops Reader returning early and waits for network idle,
  so it makes a slow page *slower* ([jina-ai/reader#1101](https://github.com/jina-ai/reader/issues/1101)).
- **A remedy a test established for certain now outranks the generic copy**, server-side (`result.advice`
  in `testProvider`) and in `AdminAI.jsx` (`r.advice || CODE_COPY[r.code]`). Showing the generic line is
  precisely how "reissue the key" got printed for a key whose only problem was its kind.

### 3. Root cause analyses

| # | Symptom | Root cause | Resolution |
|---|---|---|---|
| 1 | OpenAI 400 on a funded key | `max_tokens` renamed to `max_completion_tokens`; we sent the retired name | send the new name, one-shot fallback to the old |
| 2 | Gemini "returned no text (MAX_TOKENS)" | 2.5+ spends hidden reasoning tokens from the answer budget, first | reserve thinking on top of the caller's budget; disable it under 512 where the family allows |
| 3 | Jina "aborted" at exactly 15000ms | our AbortController; adapters returned an unclassifiable message, and returned rather than threw, so the caller's own AbortError branch never ran | shared `failure()` → `code: "timeout"`, propagated into the chain and the classifier |
| 4 | PageSpeed "API keys are not supported by this API" | an AI Studio `AQ.` key in a slot that needs a Cloud `AIza` key | name the kind, keyless fallback so vitals survive, precise operator advice |

⚠️ **A note on #3 that outlived the bug:** the adapter *returning* `{ok:false, error}` instead of throwing
is why the caller's AbortError branch was dead code. **A catch that flattens a typed error into a string
disarms every classifier downstream of it.**

### 4. Verification evidence

Run on the merged tree (`62136bd`), the exact tree that landed on both branches:

- `npm run test:unit` — **166 files / 2847 passed**
- `npm run test:contract` — **104 files / 1886 passed** (+14 skipped)
- `npm run test:integration` — **49 files / 411 passed**
- `npm run test:system` — 5 files / 8 passed
- `npm run test:db` — **40 migrations applied · 360 assertions** + `verify-referral` 17
- `npm run build` · `npm run check:prerender` — 23 pages / **92 asset refs, all present**
- `npm run test:security` — passed
- `npm run test:e2e:smoke` — **131 passed / 1 skipped / 0 failed**
- `npm run readiness` — **5 pass · 2 warn · 0 fail** (warns are the standing pair: stale screenshots after
  `src/pages` changed, and gallery/persona coverage, which is runtime-populated and can never clear)

**30 new tests, 20 confirmed red against the pre-fix code first.** The other 10 are invariants that must
hold either way — no `thinkingConfig` on a pre-2.5 model, no retry on an unrelated 400, no retry on a dead
key, no keyless retry on a quota error, no retry when there was no key to blame, a genuine network error is
not a timeout.

⚠️ **`netlify/functions/lib/audit/webVitals.js` had NO tests at all** before this session, which is exactly
how "a wrong key measures nothing, for ever" stayed invisible. It has seven now.

### 5. Environment state after this session

- **`main` == `staging` == `62136bd`.** The merge to `main` was a clean fast-forward (`d83b942..62136bd`,
  11 commits); nothing was on `main` that `staging` lacked.
- Those 11 commits also carry a **concurrent session's** work that was already on `staging`: workflow run
  history on Dashboard/Account, template mandatory inputs + company resolver, the pre-tier AI-config banner
  with a one-click tier split, gallery takedown UI, and a dependabot bump. That session edited
  **`aiProviders.js` and `AdminAI.jsx` — both files this session touched.** Git auto-merged with no
  conflicts; **both halves were then verified by reading, not by trusting the clean merge** — their
  `legacyModelConfig`/`splitTiers` and this session's `r.advice` override and reworded `timeout` copy are
  all intact, and the changes are orthogonal.
- **`PAGESPEED_API_KEY` was replaced with a Cloud key by the owner at the end of this session.** ⚠️ **Not
  verified from here** — confirm with `/admin/ai → Test all providers`, and remember Netlify injects
  Function env vars **at deploy time**, so a key changed in the UI needs a redeploy and its **Scopes must
  include Functions**.
- ⚠️ **The remote branch `claude/session-w7kxmu` still exists.** `git push origin --delete` returns
  **HTTP 403** on three attempts — the session credential can push branches but not delete refs, and no
  branch-deletion tool exists in the GitHub MCP set. The local branch is deleted. Remove the remote with
  `git push origin --delete claude/session-w7kxmu` or the branches page.

⚠️ **Two container facts that cost time and are not repo problems.** (1) **No `.git/hooks/pre-push` exists
in a fresh remote clone** — hooks are not cloned, so a successful push here is **not** evidence any gate
ran; every suite above was run by hand instead. (2) **Playwright cannot launch out of the box**: the image
ships browser build **1194** while `@playwright/test` 1.62.1 wants **1234**, so all 132 smoke specs fail in
~4ms on a missing `chrome-headless-shell`. The fix is a throwaway config that points chromium at the
pre-installed binary — delete it after, never commit it:

```js
// playwright.localbrowser.config.mjs  (untracked, temporary)
import base from "./playwright.config.js";
export default { ...base, projects: base.projects.map((p) =>
  p.name === "chromium"
    ? { ...p, use: { ...p.use, launchOptions: { executablePath: "/opt/pw-browsers/chromium" } } }
    : p) };
```

⚠️ **The egress proxy blocks `r.jina.ai`**, so the Jina URL-form fix is reasoned from Reader's own docs and
unit tests, **not from a live reproduction**. Watch the first real run.

🔴 **A mistake worth carrying: `git push … | tail -3` reports `tail`'s exit code, so a rejected push looked
like a successful one** — the retry loop broke on failure and the following `git fetch` printed a range that
read like a push result. `staging` had moved under me. **Never pipe a push.** This is the same trap
CLAUDE.md already records for Playwright, hit on a different command.

### 6. Open items for the next session

- [ ] **Delete the remote branch `claude/session-w7kxmu`** — blocked here by a 403, see above.
- [ ] **Production is not deployed.** Unlock production in the Netlify UI, then comment `approved` on the
      phase-gate issue. ⚠️ Never "fix" a lock error with `--prod-if-unlocked`: while locked that makes a
      DRAFT deploy, smoke then passes against OLD production, and the run claims a release that never
      shipped.
- [ ] **Confirm all four providers green on `/admin/ai`** after the PageSpeed key change and the next
      deploy — this session's evidence is unit tests and vendor documentation, not live keys.
- [ ] **Screenshots are stale** (`node docs/capture-screenshots.mjs` with a dev server up). Driven by the
      concurrent session's Dashboard/Templates/Account changes; this session's own UI edit was admin-only,
      and admin pages are never captured into `public/help`.
- [ ] Consider whether `X-Engine: browser` should also be the default for `renderJs` on other providers —
      Jina is now the only one whose render switch actually renders.
- [x] ⚠️ **`session-handoff-management/scripts/index-sessions.mjs` is retired and was destructive** — it
      indexes one file per session, so it overwrote `docs/sessions/README.md` (which documents the
      consolidated convention) with a two-row table reading *"Total Sessions Archived: 2"*. Reverted, and
      the skill now warns against it the way it already warned against `new-session.mjs`.

---

## 2026-09-03 (later) — Live-review fixes, email branding, and four of the owner's six items

**Branch:** work happens in the `gemini-refresh-model-config-ef9e28` worktree, pushed to
**`feat/intelligence-workflows`** by explicit refspec. **`main` untouched at `1910968` throughout.**
PR **[#143](https://github.com/vikashkaruna/scrapelite/pull/143)** → `staging`, open, CI green.
Preview: `https://deploy-preview-143--datiqapp.netlify.app` (401 without a Netlify session — by design).

⚠️ **Migration `0040` was applied to the STAGING Supabase project (`aubwooslkkrprdxuiyvj`) by the
owner.** Production (`sikkfxysjhirmtwkumpt`) is a separate, later step. `runtime-config.js` sends
everything except `main` to staging, so the preview and `staging.datiq.app` share that project.

### 🔴 The same failure pattern, now seen THREE times — watch for it in Phases 4–6

Mechanism shipped, tested, and **never wired to a caller**:

| What | Found | Consequence |
|---|---|---|
| `discoverability.createSchedule` | earlier session | a whole subsystem unreachable |
| `analyticsService.lifecycle.*` | this session | the funnel existed and nothing fed it |
| **`checkAllowance()`** | this session | **credits were RECORDED but never ENFORCED** — any account could run unlimited templates |

The owner reported the third as "credit checks happen later than the run". The truth was that they
did not happen at all. **When a phase claims a capability, grep for its callers before believing it.**

### 🔴 A privacy leak that would have passed review

Activation events were about to be emitted through `analyticsService.track()` — what every other
event uses. That writes to `analytics_events`, which `0005` made **world-readable** (`USING (true)`)
on the stated grounds that it holds *"non-PII, no user content"*. True of a page view; **false once
an event carries `domain`, `templateKey` or `count`**, which say WHICH COMPANIES a user researched.
⚠️ **The justification for a three-year-old RLS policy silently stopped applying when the data
changed shape.** Re-read `0005`'s reasoning before adding any further event kind.

### 🔴 Vendor identity was leaking on the SUCCESS path

A prior session built `aiFailure.js` to strip vendor names from ERROR responses, with a
forbidden-pattern sweep so *"the boundary cannot be re-crossed one well-meaning code at a time"*.
The **success** path shipped `provider`/`model` in provenance, rendering `openai · gpt-4o-mini` on
the customer's own report — the same disclosure, on the path that runs far more often.
⚠️ **An existing contract test asserted `_enrichment.provider === "gemini"` — it had ENCODED THE
LEAK AS A CONTRACT**, so the suite was defending it. Inverted. New `publicProvenance()` is an
ALLOWLIST, because a denylist ships every field someone adds later, which is how this survived.

### Fixes from the owner's live review (all local until pushed)

| # | Defect | Fix |
|---|---|---|
| 1 | `openai · gpt-4o-mini`, "Schema-validated", "Raw JSON", `· via firecrawl` on customer reports | redacted at the SOURCE + UI; 10 sweep tests |
| 2 | `account_brief`'s `angle` input collected, validated, **charged for**, and never read | `inputContext()` drives off `input_schema.fields`, so a new template's inputs reach its prompt the day it is seeded |
| 3 | "This run is incomplete" on a site that simply doesn't publish pricing | a **successful synthesis proves the page was readable** — so empty structured facts is a FINDING, not a failure |
| 4 | SEO/GEO/AEO template ran a thin copy of `/discoverability` | hands off with the domain prefilled, **before anything is spent**; prefill never auto-run |

### Email branding — eight senders, one shell

Reported from a live welcome email. The audit found **eight** independent mail builders: ONE had a
logo, ONE had the tagline, **NOT ONE** carried the company.

🔴 **The tagline existed in THREE variants across eight files.** `"Intelligence from every URL"` was
stale and shipped on **every invoice and every dunning email DatIQ has ever sent**. Owner chose
**"Intelligence from the Web"**; it is now defined once in `exportBranding.js`.

New `src/lib/emailBranding.js`: DatIQ mark + wordmark + tagline header, **Axiom Minds Private
Limited · axiomminds.ai** footer. ⚠️ **The logo is decorative and the wordmark is TEXT** — most
clients block images, and branding that vanishes when images are blocked is not branding.
⚠️ **Table-based, inline-styled, no `<style>`** — Gmail strips `<head>`, Outlook renders through
Word; "tidying" it into semantic CSS breaks Outlook silently.

⚠️ **My first sweep was VACUOUS and its own first assertion caught it** — it detected builders by
their hand-rolled markup, so once all were converted it matched nothing and passed. Rewritten to
detect SENDERS (a file posting `html:` to Resend), which then found two more and an eighth.

### The owner's six items — ALL SIX DONE

| # | Item | Status |
|---|---|---|
| 1 | `/admin/ai` doesn't update | ✅ Save path proven CORRECT by a new integration test. Real cause: each Netlify function holds its own 60s config cache, so "saved" ≠ "live everywhere". Now stamped with `updatedAt` and surfaced. The editable model dropdown already existed (input + datalist, both tiers) — now pinned by test. |
| 3 | Verify credits upfront | ✅ Blocks before the run row and any fetch; 402 with needed/remaining/shortBy/allowance. Allowance = `plan.limits.extractions` (Developer's 10000 = its own "10,000 row credits/month"). Client mirrors via the SAME pure function. |
| 4 | Delete published page from admin | ✅ `takedown` action reusing the existing `revoke_report` RPC (`p_actor: null` already modelled the admin case). ⚠️ **REVOKE, not DELETE** — the access log and audit trail survive, which is the point of a takedown. Written reason mandatory. |
| 6 | Recipes → workflow template library | ✅ Points instead of repeating |
| 2 | Run history + Dashboard filters + Account summary | ✅ 🔴 **template_runs has persisted since 0036 and `listRuns` had NO CALLER** — every run a user paid credits for was written and unreachable. FOURTH instance of that pattern. New `runHistory.js` (PURE), `?view=runs` tab, Account summary. ⚠️ A **partial** run is its own bucket, never folded either way. ⚠️ `creditsSpent` ignores ESTIMATES — a guess on a billing surface with no ledger row behind it. ⚠️ successRate over FINISHED runs only, else it dips whenever a run starts. |
| 5 | Mandatory domain + smart company entry | ✅ `competitors` now required on the *competitive* brief. ⚠️ An **empty array read as "contains no valid domains"** — malformed, to someone who typed nothing. Now "is required". Smart entry guesses candidates and CONFIRMS each by fetching; first token tried before the full name (companies shorten); `.in` included because the PRD ships an Indian-SMB builder. Hard-capped, no credits, weak matches reported as **"best guess"** — a wrongly-resolved domain yields a confident brief about the wrong company. |

### Open / next

1. **Items 2 and 5**, then Phases 4 → 5 → 6 → 7.
2. ✅ **The pre-tier config downgrade is now VISIBLE rather than fixed by guessing.** A previous
   session had already reasoned about this and chose to apply a stored `models` map to BOTH tiers so
   a live operator setting is never quietly retired — sound, and the cause of deep work running on a
   fast model. Both concerns are real, so neither is guessed: `merge()` now flags
   `legacyModelConfig` (stored `models` with no `modelsFast` predates tiering), `/admin/ai` shows a
   banner saying deep work may be on a fast model, and offers a **one-click split** that keeps the
   operator's model on FAST and restores recommended DEEP models. Nothing is applied automatically —
   it changes which model real extractions run on, and that stays the operator's call.
3. `0041`–`0043` unwritten. All migrations are handed over as consolidated SQL, per owner decision.
4. ⚠️ **I cannot enter passwords.** Live testing as `demo@datiq.app` needs the owner to type it.
5. ✅ **Admin takedown now has a UI** on `/admin/gallery`. ⚠️ Styled as danger and gated behind a
   typed reason because it is **a different act from "Remove from showcase"**: uncurate takes a
   report out of `/gallery` and it stays publicly readable at its own link; takedown REVOKES the
   link for everyone holding it. Someone tidying the showcase must not be one misclick from that.
5. ~15 blog posts agreed for the end, once features are green on staging.

---


## 2026-09-03 — Templates outage root-caused, AI-config staleness closed, Phase 3 (PQL) spine shipped

**Branch:** work happens in the `gemini-refresh-model-config-ef9e28` worktree and is pushed to
**`feat/intelligence-workflows`** by explicit refspec — that branch is checked out in
`branch-deploy-test-9894f8`, so it cannot be checked out here. `main` was touched once,
deliberately and with approval, then left alone.

### 🔴 The `/templates` crash was a store outage wearing a TypeError

`https://datiq.app/templates?key=<anything>` showed *"Cannot read properties of undefined
(reading 'input_schema')"* — for **every** template, not one. `handleGet` in
`netlify/functions/templates.js` returned the **catalogue** and exited before it ever looked at
`qs.key` whenever `listTemplates()` came back `ok:false`. So a `?key=` request got a 200 carrying
a `templates` array and **no `template` field**, and the runner dereferenced the field that 200
had promised.

**Why it looked like a per-template bug:** the catalogue is served from the same six built-in
seeds in that same degraded branch, so every card kept rendering. The list looked healthy while
every link into it was dead.

**The actual cause on production:** `workflow_templates` comes from migration `0036`, which had
only ever been applied to **staging** Supabase while the code had since been promoted to `main`.
The owner applied `0036`–`0039` to production manually this session. **The code fix does not make
templates work — it makes the failure honest.**

⚠️ **This was unfixed on `staging` too**, so it was not a stale-branch artifact.

### 🔴 A correction worth carrying: I rebuilt work that already existed

Asked to add per-role model configuration to `/admin/ai`, I built a whole parallel implementation —
chain profiles, live provider testing, key fingerprints — **before discovering the branch was 11
commits behind `main`/`staging`, where all of it had already shipped** (`providerRegistry.js`,
`FUNCTION_AREAS`, `MODEL_TIER`, `admin-provider-test.js`, a Providers console with a Reload
button). CLAUDE.md's own rule covers this exactly — *answer "does X exist?" with `git grep <ref>`
across EVERY ref, never against the checked-out tree* — and running it first would have saved the
whole detour. The duplicate work was reset (`89bef6b` in reflog) and `origin/staging` merged instead.

**So: Phases 3–7 aside, per-area model selection is DONE.** `/admin/ai` → **Models** tab sets a
`fast` and a `deep` model id per provider; **Where they're used** sets each area's provider order
and tier. Areas today: `enrichment`, `synthesis`, `classification`, `discoverability`, `citations`.

### The Gemini "key change has no effect" report — three causes, only one in code

| Cause | Fixable in code? |
|---|---|
| Netlify injects Function env vars **at deploy time** — a key changed in the UI needs a **redeploy** | ⚠️ no |
| Variable **Scopes** must include *Functions*; a Builds-only var is invisible to `netlify/functions/**` forever | ⚠️ no |
| Admin GET read through the 60s `_cache`, so **Reload could show a pre-save config** | ✅ fixed |

`invalidateAiConfigCache()` was already called on write, but it clears only the container that
served the POST — Netlify may route the next GET to a **different** warm container whose own cache
is up to a minute stale. `loadAiConfig()` now takes `{ fresh: true }` and the admin GET uses it; a
fresh read *repopulates* the cache rather than disabling it, so no other caller pays for it.
**Nothing caches keys** — `readKey()` reads `process.env` every call — so use the key fingerprint
already on that screen to tell "the new value never arrived" from "the key or model is wrong".

### Shipped this session

| Item | Detail |
|---|---|
| `templates.js` degraded `?key=` | Serves the seed (`degraded: true`) or a real 404, never the catalogue |
| `Templates.jsx` | A 200 without `template` is a contract breach, not a template — readable message, operator diagnostics stay server-side; degraded mode is surfaced and **Run is disabled** rather than promising a run the store cannot do |
| `templatesCache.js` | **NEW.** Catalogue prefetched to localStorage for first paint, always revalidated. **A degraded response is never cached and never overwrites a good cache** — otherwise an outage would persist past its own end and silently drop templates a workspace really has (the failure `extractionsRepo` already learned) |
| `pqlModel.js` + `0040_pql.sql` | Phase 3 spine — see below |

### Phase 3 (PQL) — spine done, UI pending

`src/lib/pql/pqlModel.js` is PURE and imported by both React and `netlify/`. Nine signals summing
to 100, threshold 50, per-persona activation definitions.

🔴 **The rule it inherits: an unmeasured signal is not a zero.** A signal is absent either because
the user never did it (scores 0) or because **nothing in this deployment records it yet**
(EXCLUDED, weight redistributed). Collapsing those makes every account look unqualified the moment
an instrumentation gap appears, then produces a phantom company-wide PQL surge on the day someone
ships the missing tracking. Every score carries `coverage`; nothing measurable yields a **NULL**
score, never 0, and a CHECK constraint refuses `is_pql` on a NULL score.

**Weighting principle: commitment over activity.** Sharing a report, creating a monitor, pushing to
an integration each cost the user something and precede a purchase. `hit_plan_limit` is weighted
**lowest of the nine** — it is the signal most easily produced by someone about to churn rather
than pay. ⚠️ **These weights are a hypothesis, not a measurement** — nobody has observed which
behaviours predict DatIQ revenue yet. They are deliberately in one table so tuning is a one-line diff.

🔴 **CORRECTION, same session.** The paragraph originally here said the PRD was unavailable and
that the nine signals had been *designed* from the product's instrumented surface. The owner then
supplied the PRD ("DatIQ — Persona Specific Templates & Shareable Reports"), and the guessed table
was **materially wrong** — it lacked "used a persona template" and firmographic ICP fit entirely,
and invented a `multi_domain`/`habitual_return` pair the PRD does not use. It has been replaced
with the PRD's actual table, transcribed verbatim, and a test now asserts the transcription so the
two cannot drift. **The PRD's key tables are now copied into
[INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md](../INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md)
§PRD source tables**, so the next session does not have to guess or ask.

⚠️ **THE POINTS SUM TO 130, NOT 100, AND THE THRESHOLD IS 50 RAW POINTS.** The first implementation
normalised to a percentage, which silently re-scales the PRD's threshold to 65/130 — materially
stricter than written, suppressing the founder outreach the PRD wants triggered. Do not "tidy" this
into a percentage.

⚠️ **Two of the nine cannot be measured today** — `imported_enriched_10_companies` needs Phase 4,
`icp_fit` is firmographic data we do not hold. That is 35 of 130 points, so the
exclude-and-redistribute rule is load-bearing immediately, not theoretical: scoring them 0 would cap
every user at 95/130. `MEASURABLE_TODAY` in `pqlModel.js` is the one place that list lives.

⚠️ **Persona gap:** the PRD defines SIX activation groups; the app ships SEVEN personas.
`recruiter` has no PRD equivalent and is mapped to the closest DEFINED behaviour (`vc-analyst`)
rather than given an invented definition. Flagged in `PERSONA_TO_ACTIVATION`.

**Two real bugs caught by tests before they shipped:** `signalsFromEvents` threw on a `null` row
(analytics arrive from both Supabase and a localStorage flush buffer); and the column was named
`excluded`, which is the pseudo-table `ON CONFLICT DO UPDATE` binds.

### The vulnerability discrepancy — a blind spot on the release path

GitHub reported high advisories on the default branch while root `npm audit` reported none. **Both
were right.** `scripts/check-vulnerabilities.mjs` ran `npm audit` with `cwd: repoRoot` only;
Dependabot scans every lockfile. The unscanned one was `tools/netlify-cli/` — **the single tree that
runs with production deploy credentials.**

| Action | Result |
|---|---|
| `qs` 6.15.2 → 6.16.0 (a **prod** dep via `stripe`) | root audit clean |
| `netlify-cli` **27.1.2 → 27.4.2** | 2 of 7 highs resolved; tree **388 packages smaller** |
| Gate audits BOTH trees, labelled, failing loudly if one is absent | the disagreement cannot recur |
| Remaining 5 (sharp → libvips) | bypassed, TODO + 2026-12-03 expiry |

🔴 **CLAUDE.md recorded that pin as immovable** — `@netlify/dev` required `@netlify/ai@^1.0.1`,
which had never been published and killed a production deploy. **It has since shipped.** Re-checking
instead of trusting the note is what unlocked the bump — this repo's own "re-read the advisory
before renewing a bypass" lesson, paying off a second time.

⚠️ **The bypass reasoning was WRONG in draft and is corrected in the file.** The first version
claimed the vulnerable binary is never installed because the workflow uses `--ignore-scripts`. That
is false: modern `sharp` ships prebuilt binaries as **optional dependencies**, not a postinstall
download, so libvips *is* on disk. The surviving claim is narrower and was tested — with `@img` and
`sharp` deleted from a complete install, `netlify deploy --help` still loads and `netlify deploy`
reaches its own argument validation.

⚠️ **`approvedBy` is `pending-owner-review`.** A bypass is a risk acceptance and that is the owner's
call. There is **no forward fix**: npm's only remedy is a MAJOR DOWNGRADE to netlify-cli 23.13.5 on
the tool that publishes production.

### Verified
Full gate **9/9**. db **40 migrations / 359 assertions / 0 failed** (+18) · unit **2689** ·
e2e smoke **131 passed** on the `main` push. The 7 behavioural templates assertions were confirmed
**RED** against the pre-fix handler; the catalogue assertion correctly stayed green.

### Phase 3 — ✅ COMPLETE (89 tests)

| Piece | Detail |
|---|---|
| `pqlModel.js` + `0040_pql.sql` | PRD's 9 signals / **130 points** / threshold **50 raw** |
| `activationEvents.js` | 15-kind vocabulary + `conditionsFromEvents` + **6 drift guards** |
| `/api/pql` | intake + scoring, 13 contract tests |
| `RecipeGallery` | 7 recipes on `/integrations`, readiness-tiered |
| `PqlFunnel` | activation funnel on `/admin/revenue` |

🔴 **A PRIVACY LEAK CAUGHT WHILE WIRING THE EVENTS, AND IT WOULD HAVE PASSED REVIEW.** The obvious
implementation was `analyticsService.track()` — what every other event in the product uses. That
writes to `analytics_events`, which `0005` made **world-readable** (`USING (true)`) on the stated
grounds that it holds *"non-PII, no user content"*. True of a page view; **false the moment an event
carries `domain`, `templateKey` or `count`**, because those say WHICH COMPANIES a user researched.
A recruiter's sourcing list, readable by anyone holding the publishable key. Activation events now
go to `activation_events` (service-key only, FK'd, cascading). ⚠️ **The justification for a
three-year-old RLS policy silently stopped applying when the data changed shape** — worth re-reading
`0005`'s reasoning before adding any further event kind.

🔴 **THE DRIFT GUARDS EARNED THEIR PLACE ON THEIR FIRST RUN**, catching two real defects:
`enrichment_completed` produced `sourced_across_3_companies` but never declared it (recruiter
activation looked unsatisfiable), and `signalsFromEvents` read `workflow_run_completed` while the
vocabulary declared `template_run_completed` — **two names for one event**, precisely the bug that
made every recorded `monitor_created` `undefined/undefined`. Six tests now make that a build failure
in both directions.

⚠️ **`analyticsService.lifecycle`'s helpers had almost no callers.** Only `pageView` was wired —
`extractionSucceeded`, `saved`, `exported`, `monitorCreated` existed and nothing called them. The
funnel existed and nothing fed it. Another "built but never wired" instance, same shape as
`discoverability.createSchedule`.

### Security — both lockfiles now audit CLEAN, zero bypasses

GitHub reported highs on the default branch while root `npm audit` reported none. **Both right:**
`check-vulnerabilities.mjs` audited only the repo root; Dependabot scans every lockfile. The
unscanned one was `tools/netlify-cli/` — **the single tree that runs with production deploy
credentials.** The gate now audits both.

🔴 **"`npm audit fix` offers only a downgrade" does NOT mean unfixable** — it means the TOP-LEVEL
package has no newer release, and says nothing about the vulnerable TRANSITIVE dependency. The
advisory patched at `sharp>=0.35.0`; 0.35.4 was published; the tree sat on 0.34.5 only because
`ipx@3.1.1` declares `^0.34.3`. An `overrides` entry cleared all five. **Always check the advisory's
patched range against the registry before concluding a fix does not exist** — this repo has now been
caught by that assumption three times.

Also: `netlify-cli` **27.1.2 → 27.4.2** (CLAUDE.md recorded that pin as immovable; `@netlify/ai@1.0.1`
has since shipped) and the tree is **388 packages smaller**. ⚠️ `--ignore-scripts` is **not** a
security control — modern sharp ships prebuilt binaries as optional dependencies.

### Open / next

1. **Phase 4 (bulk account intelligence) is next and is the heaviest** — 5–6 sessions, and every
   later phase waits on its durable runner.
2. **Phases 4 → 5 → 6 → 7**, phase by phase with a checkpoint each (owner's chosen cadence).
3. **Migrations `0041`–`0043` are not written yet.** Per owner decision, all new migrations are
   handed over as **one consolidated paste-ready SQL at the end**, not applied from a session.
   `0040` is written and verified against WASM Postgres but **has never run on real Supabase**.
4. **Branch deploys:** `feat/intelligence-workflows` is **not** in Netlify's `allowed_branches`, so
   pushing it deploys nothing. Agreed route is a **PR to `staging`** — deploy previews bypass the list.
5. ⚠️ **I cannot enter passwords.** Live testing as `demo@datiq.app` needs the owner to type the
   password in the browser pane; the session drives it from there.
6. **~15 blog posts** (feature announcements + per-template) agreed for the end, once features are
   green on staging.
7. ⚠️ **Stale local refs in other worktrees** after this session's remote pushes:
   `fix_staging_gate_errors` (`staging`) and `branch-deploy-test-9894f8`
   (`feat/intelligence-workflows`) both need `git pull --ff-only`. The
   `audit-storage-error-003fa6` worktree holds `claude/custom-extraction-enrichment-debug-711d74`,
   whose **remote branch was deleted this session** (verified contained in `main` first) — that
   worktree should be removed and the local branch deleted by the owner.

---


## 2026-09-02 23:10 IST — The AI outage nobody could see: schema-guided extraction, honest failures, and the Providers console

> **Branch:** `claude/custom-extraction-enrichment-debug-711d74`
> **Merged to:** `staging` **and `main`** — both at the same commit, on the owner's explicit instruction.
> **Reported as:** "custom extraction and every enrichment return nothing; multiple fixes attempted, none solved it."
>
> 🔴 **`main` DOES NOT AUTO-RELEASE.** Netlify production is locked by design; a
> release needs (a) a manual unlock in the Netlify UI and (b) an `approved`
> comment on the phase-gate approval issue. See §8.

### 1. The root cause was not in the code

Called the live production API directly:

```
POST https://datiq.app/api/ai  →  502
{"attempts":[
 {"provider":"anthropic","status":400,"error":"Your credit balance is too low…"},
 {"provider":"gemini",   "status":400,"error":"API key not valid…"},
 {"provider":"openai",   "status":429,"error":"You have no credits remaining…"}]}
```

**All three AI providers are dead in production.** Anthropic out of credit, the
**Gemini key invalid**, OpenAI out of credit. No code change was ever going to
fix it — which is exactly why every prior attempt failed.

🔴 **OPERATOR ACTION, STILL OUTSTANDING: reissue the Gemini key and top up
Anthropic + OpenAI.** Nothing in this branch substitutes for that.

⚠️ **Also check the Supabase `app_config` row `key='ai'`.** Operator config
*overrides* code, so an earlier "Gemini model naming fix" could have shipped
correctly and had zero effect in production. Unverifiable from a worktree.

### 2. Four defects made a total outage invisible for weeks

1. **The reason lied.** `enrichmentReason = relatedRes.reason || aiRes.reason ||
   "no_match"` let a fruitless related-page scan overwrite a real
   `ai_chain_failed`. Reproduced against production: `enrichKey=pricing` →
   `ai_chain_failed` (truthful), `contacts` / `social` / `custom` → `no_match`,
   which renders as *"The AI read this page but found nothing."* **A statement
   about the user's page that was really about our billing.** Infra reasons now
   outrank absence reasons — `pickReason()`, with a regression test.
2. **Silent fabrication.** `realSummary`/`realContent` caught every error and
   returned locally-generated fixture prose, badged `ai_generated`. Production
   was serving Mad Libs as analysis. Mocks now run only in mock mode.
3. **`/admin/health` reported AI as operational** because three env vars were
   non-empty strings. Key *presence* never breaks; validity and billing do.
4. **`no_match` meant four different things** — never ran / empty reply /
   unparseable / genuinely absent.

### 3. The quality ceiling was architectural

**The page body never reached any client-side prompt.** `realScrape` parsed the
HTML and threw it away, returning `{page_title, headings, links}` — so every AI
summary was written from a table of contents, and "Competitor Summary" was an
LLM guessing about a company from its navigation menu.

And **the templates were an empty shell**: every seed ships a `prompt_bundle`
with `summarize` and `talking_points`, and a repo-wide grep found **no consumer
for either**. `executeRun` read `scraped.ai_summary`, a field `extractStructure`
does not return, so the AI branch was unreachable and the declared output blocks
could never be populated.

### 4. What shipped

| Area | Change |
|---|---|
| `src/lib/providerRegistry.js` | **NEW.** One shared catalogue: every provider, its `fast`/`deep` model tier, and the FUNCTION AREA it powers. |
| `src/lib/extractionSchemas.js` | **NEW.** Per-capability JSON Schema + an evidence contract. |
| `netlify/functions/lib/pageContent.js` | **NEW.** Structure-preserving text — a pricing table survives as `\| Pro \| $29 \|`. |
| `aiProviders.js` | Tiers, areas, **native structured output** (Gemini `responseSchema`, OpenAI `json_schema`, Anthropic forced tool use), `pingProvider()`, actionable error codes. |
| `extract.js` | Schema-guided extraction, reason precedence, related pages gathered **before** the model call, `data.text` returned. |
| `admin-provider-test.js` | **NEW.** LIVE tests for AI, scrape and PageSpeed. |
| `/admin/ai` | Rebuilt as a three-tab **Providers console**. |
| `healthProbes.js` | `probeAiProviders` now **pings**, cached 10 min. |
| `StructuredFacts.jsx` | **NEW.** Groups, tables, evidence — replaces `<pre>{JSON.stringify(…)}</pre>`. |
| `templatesClient.js` | Synthesis actually runs; **AI Visibility & Competitive Brief** (the niche bet). |
| `design-system.css` | Defined `--success` / `--warning` / `--*-soft` / `--text-muted`, referenced ~30 times and **never defined** — three fallbacks had drifted to different hexes for the same colour. |

### 5. Bugs found by the new tests

- **`mailto:` addresses were being destroyed by the code meant to preserve
  them**: reinserted as `<sales@acme.com>`, then deleted by the tag-stripper on
  the next line. The highest-yield contacts signal, gone on every page.
- **A latent Vitest trap in two files**: `beforeEach(() => m.mockReset())`
  returns the mock, and a value returned from `beforeEach` is treated as a
  **teardown callback** — so Vitest invokes it after every test. Harmless with a
  value-returning mock; with a throwing one it fails a test whose assertions all
  passed, with an unexplained error.

### 6. Verified

unit+contract+integration **303 files / 4803 tests / 0 failed** · db **39
migrations / 340 assertions** · verify-referral 17 · build clean ·
check:prerender 23 pages / 69 refs · security clean · readiness **5 pass / 2
warn / 0 fail** (both pre-existing). Providers console and the new rendering
browser-verified in light and dark.

### 6b. CORRECTION, same session — the first fix over-corrected

The replacement for "no data returned" told the **customer** the truth:

> *"The AI provider account is out of credit. An administrator needs to top up
> billing."* · *"An administrator needs to set GEMINI_API_KEY, AI_API_KEY, or
> OPENAI_API_KEY."*

Accurate, actionable, and **none of a customer's business** — it disclosed our
billing state, our vendors and our env var names to people who could act on
none of it. Flagged by the owner; fixed properly:

- **`src/lib/aiFailureCopy.js`** (new) owns the two-audience split. Customers
  get ONE generic sentence for every operator fault — *"AI enrichment is
  temporarily unavailable. This is a problem on our side, not with your page —
  try again shortly."* Operators keep the full diagnosis on `/admin/ai` and
  `/admin/health`, both admin-token gated.
- **Redacted at the SOURCE, not just in the UI.** `/api/ai` and `/api/extract`
  no longer send `hint`, `detail.attempts`, provider names or vendor error
  text — a customer with the network tab open, an `/api/v1` key holder, a
  support screenshot and a log aggregator all read those bodies.
- **The `code` itself is collapsed.** Every operator fault leaves as
  `ai_unavailable`; `code: "no_credit"` in a network tab said exactly what the
  prose had just been rewritten to stop saying. `no_match` and
  `page_no_content` pass through — those are findings about the customer's own
  page, and each gets its own useful copy.
- **Fails safe:** an unrecognised code is treated as OUR fault, never as "your
  page is empty". Wrongly telling someone their page has no pricing on it is
  the costlier mistake, and it is exactly how the original outage stayed hidden.
- Applies to **PDF exports** too — the most forwarded surface we have.
- 59 new tests (`aiFailureCopy.test.js`) sweep every code in both vocabularies
  against a forbidden-pattern list (`/credit/`, `/API_KEY/`, vendor names, …),
  so the boundary cannot be re-crossed one well-meaning code at a time.

**304 files / 4877 tests / 0 failed.** Verified in a browser: an operator fault
renders the generic amber notice; a genuine `no_match` renders *"We read this
page and the pages it links to, and found nothing matching Pricing & Plans.
Pages read: acme.com, acme.com/pricing."*

### 7. Merge record

| Ref | Commit | How |
|---|---|---|
| `origin/staging` | `7eab992` → `ae48a7b` → `159b133` → merge | two fast-forwards, then the `main` merge |
| `origin/main` | `85183e4` → merge | merge commit; 8 commits landed |

`main` carried one commit `staging` lacked — `85183e4`, the content-free merge
commit from PR #137 — so this was **not** a fast-forward. Verified before
pushing that merging `origin/main` into the branch left the tree **byte-identical**
(`75fd17d` before and after), i.e. the merge changed no file. Both refs now
point at the same commit.

**No migrations in this branch** (`git diff --name-only origin/main...origin/staging
-- supabase/migrations/` is empty), so there is no database step before a
production release — unusual for a change this size, and worth stating plainly.

### 8. Open

- 🔴 Reissue/top up the three AI provider accounts. **Nothing works until then.**
- ⚠️ Check `app_config` `key='ai'` for a stale model override.
- ⚠️ `SCRAPE_PROVIDER_ORDER` in production starts with `direct` and omits
  Firecrawl entirely — the lowest-fidelity provider is primary, and the only one
  that does server-side structured extraction is absent. The code default is now
  quality-first; **the env var still overrides it.**
- Structured output is verified against each vendor's documented contract and by
  unit test, **not against a live key**. First run after the accounts are
  restored should be watched.

**Releasing to production — two human acts, by design:**

1. Unlock production in the Netlify UI ("Stop auto publishing" is what keeps a
   push to `main` from shipping).
2. Comment `approved` on the phase-gate approval issue.

⚠️ **Do NOT "fix" a lock error with `--prod-if-unlocked`.** While locked that
makes a DRAFT deploy, the smoke job then passes against the OLD production, and
the run reports a release that never shipped. This repo has done it once.

**Order of operations for the release, and it matters:** restore the three AI
provider accounts *first*, verify with `/admin/ai → Test all providers` on
staging, and only then unlock production. Shipping this to production with the
accounts still dead would replace one honest failure message with the same
honest failure message, in front of more people.

### 9. Start-here for the next session

1. `/admin/ai → Test all providers` — the fastest read on whether anything is
   actually working. Three red badges means the accounts are still dead and
   nothing downstream will behave.
2. If they are green, run one real extraction with a Quick-enrichment
   capability and check `_enrichment.structured === true` in the response. That
   is the first live exercise of the native structured-output adapters, which
   have never run against a real key.
3. `git log --oneline -12` and this entry's §4 for what changed and why.

---

## 2026-09-02 14:05 IST — Intelligence Workflows, Phases 0–2 (templates, credit ledger, shareable reports)

> **Branch:** `feat/intelligence-workflows` @ `c890170` · **Merged to:** `staging` · **`main`: untouched, deliberately**
> **PR:** [#136](https://github.com/vikashkaruna/scrapelite/pull/136) — kept open; Phases 3–7 continue on this branch.
> **Staging Gate:** all checks green.

### 1. Quick orientation

| Property | Value |
|---|---|
| Date | 2026-09-02 |
| Branch | `feat/intelligence-workflows` (cut from `origin/staging` @ `8b3818b`) |
| Status | Phases 0, 1, 2 complete & verified. Phases 3–7 pending. |
| Migrations | `0036`–`0039` **applied to staging Supabase (DatIQ-dev)**. **NOT applied to production.** |
| Gates | pre-push green on every push, nothing bypassed |
| Plan | [`docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md`](../INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md) §2.0 status board |
| Manual tests | [`docs/MANUAL-TEST-INTELLIGENCE-WORKFLOWS.md`](../MANUAL-TEST-INTELLIGENCE-WORKFLOWS.md) — 137 checks |

### 2. What was accomplished

**Analysis first.** Read the BRD/PRD, then mapped it against the codebase before planning. Headline finding: **~40% already existed but was shaped for a narrower job** — `extractionTemplates.js` was a prompt-prefill library, not a template engine; sharing was public-by-default with the slug as the only auth; `batchService` was a browser-driven runner; watchlists were whole-page content hashing. That reframed the work from "build five features" to "promote four subsystems into first-class objects, then build the one that genuinely does not exist (durable bulk enrichment)".

**Phase 0 — the spine** (`0036`–`0038`)
- `workflow_templates` / `template_runs` / `template_run_sources`. A published version is **frozen by a BEFORE UPDATE trigger**; runs carry a composite FK to `(template_key, version)` so the DB refuses a run pinned to a version that does not exist.
- `credit_ledger` — **append-only, enforced by trigger**; balance derived by `credit_balance()`, never stored. Same reasoning already recorded for audits.
- `extracted_fields` / `field_provenance` — `method` CHECK-constrained to `observed | inferred | ai_generated | user_provided`; `confidence` nullable, and **NULL is not 0**.
- Pure models shared by React *and* `netlify/`: `templateModel`, `creditModel`, `visibilityModel`. `provenanceService` v2. `KIND_WHITELIST` 5 → 16.

**Phase 1 — workflow templates**
- Six seeds (five published, `bulk_icp_enrichment` **draft** until Phase 4). `/templates` catalogue + schema-driven runner with a live itemised estimate. `templates.js` + `templateStore.js`.
- Runs orchestrated **client-side**, reusing `/api/extract` + `/api/ai`. A synchronous Netlify function is killed at 10s and a run is 2–4 scrapes plus 1–2 AI calls — this repo has already shipped a 504 from exactly that shape.

**Phase 2 — shareable reports** (`0039`)
- Replaces `public_reports`' `public read` RLS, which exposed **every column** (`session_id` included) to anyone holding a slug. All reads now go through `resolve_report_access()` under the service key.
- D3 state machine: private by default → slug minted on **first** publish only → unpublish reversible and **keeps** the slug → revoke terminal and burns it (the revoked row retains the slug, so `UNIQUE` makes reissue impossible).
- Existing rows migrated to `link`, not `private` — each exists because a user pressed Share.

### 3. Root cause analyses

**(a) Robots meta — a real leak, found in a browser, not by a test.**
*Symptom:* a private `link` report served with `index, follow`.
*Root cause:* `Report.jsx` **appended** a `<meta name="robots">` instead of overriding the site-wide one from `index.html`, leaving **two** tags with the permissive one first. Crawlers are not required to resolve that restrictively — least of all GPTBot/ClaudeBot/PerplexityBot, the audience this product targets.
*Fix:* use `seoMeta`'s upserting `setNoIndex()`/`setPublicDefaultMeta()`, restoring the default on unmount. Three regression tests **confirmed red** against the pre-fix code.

**(b) Staging Gate kept going red — the recurring issue, now fixed.**
*Symptom:* ~20% of Staging Gate runs failing.
*Root cause, measured:* of the last 25 runs, **5 failed and 4 of those 5 failed on the same step — Playwright e2e smoke**. All had passed the pre-push hook first, because `test-all.mjs --prepush` **deliberately skips e2e**. So the common path to a red gate was: change a UI file → nine gates green in ~30s → push → find out ten minutes later.
*Fix:* `scripts/pre-push.sh` now runs the e2e smoke **conditionally**, on the same source set the prerender gate watches plus `e2e/`. Conditionality is the design — a gate adding ~90s to *every* push gets `--no-verify`'d, and this repo has an incident about that habit. Escape hatch `PREPUSH_SKIP_E2E=1`. `scripts/prepush-gate.test.mjs` guards it (5 assertions confirmed red with the gate removed). **Verified live:** a `src/pages` push ran all 131 smoke tests in-hook, `all gates green in 112s`.

**(c) Two mistakes avoided that looked correct.**
- `npm run migrate:prod` would have replayed **all 39** migrations — `--include=` is *additive*, not restrictive.
- `supabase db push` was worse: it tracks state in `supabase_migrations.schema_migrations`, which this repo's runner never writes, so it would believe none of `0001`–`0035` were applied — and it targets the **linked** project, currently **DatIQ-prod**.

### 4. Verification evidence

| Suite | Result |
|---|---|
| Unit | 150 files / **2,566** passed |
| Contract | 95 files / **1,753** passed (+14 skipped) |
| Integration | 48 files / **405** passed |
| System | 5 files / **8** passed |
| Database | **39 migrations / 340 assertions** (+68 new) |
| E2E smoke | **131** passed, 1 skipped |
| Build · `check:prerender` · security | clean |

Also verified **in a real browser**: template run end-to-end with input normalisation (`https://WWW.Stripe.com/pricing` → `stripe.com`), report publish → unpublish → republish slug reuse, and the robots-tag fix.

Migrations verified against **real Postgres** (not just PGlite) in a rolled-back transaction: composite-FK pinning, immutability trigger, append-only trigger, D3 slug reuse, terminal revoke. **Zero residue** after rollback.

### 5. Staging state after this session

| | |
|---|---|
| Supabase | **DatIQ-dev** `aubwooslkkrprdxuiyvj` — 71 tables / 43 functions / 14 triggers |
| Templates | 5 published + 1 draft |
| Reports | 10 pre-existing shares migrated to `link` — all live links preserved |
| Production | **`sikkfxysjhirmtwkumpt` untouched**, still lacks `0036`–`0039` |

### 6. Open items for the next session

- [ ] **Owner runs the 137-check manual plan** before any promotion to `main`.
- [ ] **Apply `0036`–`0039` to production** as part of promoting to `main`.
- [ ] **Reconcile staging schema drift** — `account_deletion_audit` + `delete_user_account` exist on staging in **no migration**. The repo is not the complete source of truth for that project; fold them into a migration before prod diverges further.
- [ ] **Phase 3** (PQL + integration recipe gallery) is the next build — ~1–2 sessions, cheapest remaining.
- [ ] Phases 4–7 pending (~12–16 sessions). Phase 4 (bulk) is the heaviest and needs the durable runner.

### 6a. Branch topology at close — ✅ RESOLVED

> **Updated 2026-09-02, later the same session.** This section originally warned
> that `main` carried 4 commits `staging` lacked, including a Dependabot
> security bump, so promotion would be a real merge against a `staging` that was
> missing it. **That has now been fixed** — `main` was merged into `staging` at
> the owner's request. The original warning is kept below, corrected rather than
> deleted, because the reasoning still matters next time the two diverge.

| Ref | SHA | State |
|---|---|---|
| `feat/intelligence-workflows` | `c890170` | **kept open** for Phases 3–7; fixes land here |
| `staging` | `c890170` | identical to the branch, and **now contains `main`** |
| `main` | `398b0cd` | **untouched by this work** — carries no Phase 0–2 file |

**What the merge brought in:** commit `8bae7e0`, a Dependabot dev-dependency
bump — **`package-lock.json` only**, no `package.json` change. Seven transitive
build-toolchain packages moved:

| Package | Before → After |
|---|---|
| `browserslist` | 4.28.2 → 4.28.8 |
| `caniuse-lite` | 1.0.30001793 → 1.0.30001810 |
| `postcss-selector-parser` | 6.1.2 → 6.1.4 |
| `baseline-browser-mapping` | 2.10.33 → 2.11.20 |
| `electron-to-chromium` | 1.5.368 → 1.5.419 |
| `node-releases` | 2.0.47 → 2.0.54 |
| `update-browserslist-db` | 1.3.x → 1.3.2 |

⚠️ **The lockfile updating is not the same as the tree updating.** Immediately
after the merge, `package-lock.json` named the new versions while `node_modules`
still held the old ones — so running the suite at that moment would have
verified the *wrong dependency tree* and called the merge green on evidence that
did not apply. `npm install --cache <scratch>` (the scratch cache is required —
`~/.npm/_cacache` has root-owned entries on this machine) reconciled 8 packages
before anything was re-run.

**Re-verified after the merge, on the new tree:** unit **2585** · contract
**1753** (+14 skipped) · integration **405** · system **8** · db **39 migrations
/ 340 assertions** · build clean · `check:prerender` clean · security clean ·
**`npm audit`: 0 vulnerabilities** (was 2 high — this merge is what cleared the
"2 vulnerabilities on the default branch" warning that every push had been
printing).

`browserslist` drives build targets, so the risk worth checking was whether the
emitted bundle changed and left the committed prerendered pages stale. It did
not: **0 references repointed, 0 committed pages changed.**

**Promotion to `main` is now a clean fast-forward** — `main` is an ancestor of
`staging`, and `staging` is 13 commits ahead.

### 7. Decisions recorded### 7. Decisions recorded (D1–D6, resolved with the owner)

| # | Resolution |
|---|---|
| D1 | Chunked self-invocation for the durable runner (not Netlify background functions) |
| D2 | Bulk import v1 = CSV + paste only; connectors → Phase 4b |
| D3 | Reports private by default; unpublish reversible + **slug REUSE**; revoke terminal |
| D4 | Watchlists v1 = 3 signal types (pricing, product, positioning) |
| D5 | PRD "Team" → existing `business`; PRD "Business" → existing `agency`; **no tier renamed** |
| D6 | ICP rules = product defaults **and** customer-editable, with reset |

---

## (archived) SESSION-HANDOFF-2026-09-01-DYNAMIC-AIRTABLE-AND-WORKFLOW-ORCHESTRATOR-FIXES

<details>
<summary>Full record — folded in during the 2026-09-02 consolidation</summary>

# Session Handoff — 2026-09-01 — DYNAMIC-AIRTABLE-AND-WORKFLOW-ORCHESTRATOR-FIXES

> **Branch:** `mighty_corona_flies_22h03` @ `2ce0ea2`  
> **Target:** `staging` / `main`  
> **Status:** Complete & 100% verified (291 test suites / 4,551 vitest tests passed)  

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-01 / 2026-09-02 |
| **Branch** | `mighty_corona_flies_22h03` |
| **HEAD SHA** | `2ce0ea2` |
| **Status** | Complete & verified |
| **Pre-Push Gates** | 100% green (`npm test` — 291 suites / 4,551 tests) |
| **Active Focus** | Dynamic Airtable discovery & creation, workflow-orchestrator path resolution, workflow schema alignment |

---

## 2. What Was Accomplished

### 1. Dynamic Airtable Table Discovery, Auto-Creation & Schema Mapping
- **`fetchAirtableTables({ apiKey, baseId })`** (`src/lib/airtable.js`): Uses Airtable's Metadata API (`GET /v0/meta/bases/{baseId}/tables`) to list all tables in a base programmatically with column definitions.
- **`createAirtableTable({ apiKey, baseId, tableName, fields })`**: Provisions a new table in Airtable (`POST /v0/meta/bases/{baseId}/tables`) pre-configured with standard fields (`URL`, `Title`, `Host`, `Summary`, `Created at`, `Headings`, `Links`).
- **`resolveAirtableTable({ apiKey, baseId, tableIdOrName, createIfMissing })`**: Resolves tables bi-directionally by ID (`tbl...`) or by friendly name (case-insensitive), with optional on-demand table creation.
- **`DEFAULT_AIRTABLE_TABLE_FIELDS`**: Declares standard typed fields (`url`, `singleLineText`, `multilineText`, `dateTime`).
- **Backend Endpoints** (`netlify/functions/integrations-airtable.js`):
  - `GET /api/integrations/airtable/tables?baseId=...`
  - `POST /api/integrations/airtable/create-table`
  - `POST /api/integrations/airtable/push` with dynamic table resolution (`tableName`, `createIfMissing`).
- **UI Enhancements** (`src/components/EditIntegrationModal.jsx`):
  - Replaced manual `tableId` text entry with an interactive **Table Dropdown** selector that auto-loads tables for the configured Base.
  - Added an inline **`+ Create new table in Airtable`** action that creates and selects a new table with 1-click.
  - Added live field count detection indicator.

### 2. Workflow Orchestrator Path Resolution Fix
- **Symptom**: Calling `POST https://datiq.app/api/workflow-orchestrator/run-now` returned `{"error":"unknown action 'api/workflow-orchestrator/run-now'"}`.
- **Root Cause**: `workflow-orchestrator.js` extracted `action` by stripping leading slashes from `event.path` (`"api/workflow-orchestrator/run-now"`), which did not match `"run-now"`.
- **Resolution**: Updated `cleanPath` resolution in `netlify/functions/workflow-orchestrator.js` to strip function path prefixes (`/api/workflow-orchestrator/`, `/.netlify/functions/workflow-orchestrator/`, etc.) and default to `"run-now"`. Netlify's standard catch-all API redirect (`from = "/api/*" -> to = "/.netlify/functions/:splat"`) handles routing out-of-the-box.
- **Added Automated Tests**: Covered all path variations in `netlify/__tests__/workflow-orchestrator-handler.test.js`.

### 4. Global Error Handling n8n Workflow & Resend Email Alerts
- **New Workflow**: Created **`datiq_global_error_handler`** (`n8n/workflows/datiq_global_error_handler.json`).
- **Trigger**: Uses `n8n-nodes-base.errorTrigger` to automatically catch any node failure or execution crash across all workflows.
- **Configurable Recipient**: Reads destination email from environment variable (`$env.ERROR_ALERT_EMAIL || $env.OPS_ALERT_EMAIL || "hello@datiq.app"`).
- **Resend Integration**: Sends HTML formatted alert email with workflow name, failed node, execution ID, timestamp, error details, and complete formatted stack trace using `$env.RESEND_API_KEY`.
- **All Workflows Linked**: Updated `scripts/generate-n8n-workflows.mjs` and all 17 workflow JSON files to set `"settings": { "errorWorkflow": "<error-workflow-id>" }`.

---

## 3. Verification Evidence

- `src/lib/airtable.test.js`: **56/56 passed**
- `netlify/__tests__/integrations-airtable.test.js`: **17/17 passed**
- `netlify/__tests__/workflow-orchestrator-handler.test.js`: **20/20 passed**
- `netlify/__tests__/workflowCallback.test.js`: **17/17 passed**
- `netlify/__tests__/workflowEnqueue.test.js`: **18/18 passed**
- `netlify/__tests__/workflowOrchestrator.test.js`: **46/46 passed**
- `netlify/__tests__/n8n-workflow-json.test.js`: **183/183 passed**
- `src/pages/Account.integration.test.jsx`: **18/18 passed**
- `src/components/ExportIntegrations.test.jsx`: **22/22 passed**
- **Full Vitest Suite (`npm test`)**: **291 test files passed (100% green), 4,563 tests passed, 0 failed**

---

## 4. Open Items for Next Session

- [ ] Run `scripts/import-workflows-cloudrun.mjs` with `N8N_API_KEY` to sync and activate all 18 workflows in Cloud Run.
- [ ] Push staging branch to remote / deploy to Netlify staging environment when ready.

</details>

---

## (archived) SESSION-HANDOFF-2026-08-30-WORKFLOW-OPTIMIZATION-AND-CALLBACK-API

<details>
<summary>Full record — folded in during the 2026-09-02 consolidation</summary>

# DatIQ — Session Handoff: Workflow Optimization & Server Callback API Implementation

> **Date:** 2026-08-30  
> **Branch:** `workflow-implementation-and-optimization`  
> **Status:** Phase 1 Server Callback API Implemented & Tested; Direct Fallbacks Active; Session Archive Consolidated  
> **Master History:** `docs/sessions/SESSIONS-HISTORY.md` (Contains all 70 prior session records)

---

## 1. Executive Summary of Work Accomplished

1. **Implemented Server Callback API (`/api/workflow-callback`)**:
   - Built `netlify/functions/lib/workflowCallback.js` and `netlify/functions/workflow-callback.js`.
   - Pattern enables complete decoupling: n8n **never** needs master Supabase database credentials (`datiq-supabase-service`).
   - n8n executes notification flows (Resend, Slack, MCP) and posts back status and output to `_ctx.callback_url` with HMAC-SHA256 signature (`X-DatIQ-Signature`).
   - Netlify Function authenticates the callback and safely updates `workflow_events` and logs into `workflow_runs` using DatIQ's own server-side credentials.
   - Comprehensive unit test suite in `netlify/__tests__/workflowCallback.test.js` (all tests passing).

2. **Decoupled Workflow Generator (`scripts/generate-n8n-workflows.mjs`)**:
   - Replaced all direct database PATCH nodes with the new `Callback DatIQ` node.
   - Regenerated all 17 workflow JSONs in `n8n/workflows/` (all 173 validation tests passing).
   - Removed `datiq-supabase-service` requirement from n8n.

3. **Replaced Hostinger URLs with GCP Cloud Run Deployment Path**:
   - Deployed URL updated across all files and tests: `https://n8n-dev-692109205619.asia-south1.run.app`.

4. **Hardened Scheduled Runner Direct Fallback**:
   - Verified and hardened `scheduled-runner.js` with direct Resend/Slack fallback and immediate `lastHash` state commitment to eliminate duplicate alerts.

5. **Consolidated Session History**:
   - Created `docs/sessions/SESSIONS-HISTORY.md` consolidating all 70 historical session files into a single master reference.
   - Cleaned up scattered files in `docs/sessions/`.

---

## 2. Active n8n Two-Phased Strategy

- **Phase 1 (Active / Initial Launch)**: Single n8n instance using the Server Callback API and `_ctx` pattern.
- **Phase 2 (Scale & Team)**: Dedicated `staging-n8n` container for workflow development, keeping `prod-n8n` strictly locked to imported Git-tagged JSON workflows.

---

## 3. Test Verification & Integrity
- All unit, contract, and handler tests pass.
- Repository status clean and isolated to branch `workflow-implementation-and-optimization`.

</details>

---

## (archived) SESSION-HANDOFF-2026-08-30-TWO-WAY-INTEGRATIONS-AND-SCALE-TO-ZERO

<details>
<summary>Full record — folded in during the 2026-09-02 consolidation</summary>

# Session Handoff — 2026-08-30 — Two-Way Integrations, Scale-to-Zero & Master Manual Verification Guide

> **Branch:** `staging` (merged via PR #129 from `workflow-implementation-and-optimization`) @ `90870d4`  
> **Target:** `main` (safe, ready for promotion)  
> **Verification:** All 291 test suites (4,548 tests) green · 35 DB migrations / 271 assertions green · Clean Vite build · 23 prerendered pages verified  
> **Live Staging URL:** https://staging.datiq.app / https://staging--datiqapp.netlify.app  
> **Live Preview URL:** https://workflow-optimization.datiq.app  
> **Deployed n8n Target:** https://n8n-dev-692109205619.asia-south1.run.app  

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-08-30 |
| **Branch** | `staging` / `workflow-implementation-and-optimization` |
| **HEAD SHA** | `90870d4` |
| **PR** | [#129 (Merged into staging)](https://github.com/vikashkaruna/scrapelite/pull/129) |
| **Status** | Merged into staging, deployed live, all test suites green |
| **Pre-Push Gates** | 100% green (unit, integration, contract, DB verify, security, build, prerender) |
| **Active Focus** | Event-Driven Workflow Architecture, Cloud Run Scale-to-Zero, Two-Way Integrations (HubSpot, Notion, Airtable, Zapier, n8n), and Master Verification Runbook |

---

## 2. What Was Accomplished

### 2.1 Admin Coupon Grant Persistence & Relogin Hydration
- **Problem:** Coupons granted from `/admin/users` in test/offline mode were lost when the user logged out and logged back in.
- **Solution:** 
  - Implemented `datiq.adminGrants` store in `src/lib/adminService.js` with `saveAdminGrant()`, `getAdminGrantForUser()`, and `redeemLocalAdminGrant()`.
  - Updated `BillingProvider.jsx` to re-hydrate admin grants and refresh subscription status on `user?.id` auth changes.
  - Added unit test suite in `src/lib/adminService.test.js` (17 tests passing).

### 2.2 Double-Protocol URL Resolution in n8n
- **Problem:** n8n logs showed `getaddrinfo EAI_AGAIN https` because `$env.SITE_URL` contained `https://` and node expressions prepended `https://` again (`https://https://...`).
- **Solution:** Added URL normalization logic in `scripts/generate-n8n-workflows.mjs` and updated all 17 workflow JSON files to detect protocol prefixes and strip trailing slashes.

### 2.3 Option 1: Event-Driven Architecture & GCP Cloud Run Scale-to-Zero
- **Problem:** Continuous 5-minute background pings prevented the GCP Cloud Run container from scaling down, incurring unnecessary compute costs.
- **Solution:**
  - Disabled idle background 5-minute pings in `00-datiq-smoke-test.json` and `datiq_daily_digest.json` (`"active": false`), turning them into manual on-demand diagnostic tools.
  - Added **Pipeline Execution & Cloud Run Scheduler** control card in `/admin/automation`:
    1. ⚡ **Event-Driven (Real-Time Push — Recommended):** Dispatches webhooks only on user events. Cloud Run scales to 0 instances when idle ($0 idle cost).
    2. ⏱️ **Scheduled Polling:** Configurable interval (1h, 6h, 12h, 24h).
    3. ⏸️ **Paused (Manual 'Run Now' only):** Suspends automated background processing for maintenance or non-prod isolation.
  - Gated background processing in `netlify/functions/workflow-orchestrator.js` and `admin-automation.js` backed by `app_config` (`automation_pipeline`).
  - Created `docs/N8N-WORKFLOW-OPTIMIZATION-ARCHITECTURE.md`.

### 2.4 "Push to Zapier" & Two-Way Zapier Integration
- **Problem:** "Push to Zapier" was omitted from Preview and Dashboard menus, and Zapier Catch Hooks were not directly callable from the UI.
- **Solution:**
  - Added Zapier to `PUSH_PROVIDERS` in `src/lib/integrationsClient.js`.
  - Implemented `handlePush` in `netlify/functions/integrations-zapier.js` supporting both direct Zapier Catch Hook dispatch and `zapier_events` emission for polling Zaps.
  - Updated `src/pages/Account.jsx` to display Catch Hook hints and Token status.
  - Added unit tests in `netlify/__tests__/integrations-zapier.test.js` and `src/lib/integrationsClient.test.js`.

### 2.5 Master Manual Verification & Two-Way Integration Guide
- **Updated:** `docs/MANUAL-VERIFICATION-AND-INTEGRATION-GUIDE.md` with exhaustive, step-by-step setup and testing instructions for:
  - **HubSpot CRM:** Private App scopes, Inbound Schema Introspection (`/schema`), Outbound Company & Contact Push (`/push`).
  - **Notion Databases:** Integration Secret, Table setup, Connection sharing, Inbound Schema Discovery, Outbound Page Insertion.
  - **Airtable:** Personal Access Tokens, Base & Table IDs, Inbound Base Schema Introspection, Outbound Batch Record Creation.
  - **Zapier:** Token Minting, Inbound Action Execution (`extract_url`, `create_schedule`), Outbound Trigger Polling & Direct Catch Hook Pushes.
  - **n8n Automation Engine:** HMAC-signed Webhook Dispatches, Server Callback API (`/api/workflow-callback`), and Automated End-to-End Simulation Runner (`npm run test:workflow`).

---

## 3. Verification Evidence

```bash
# Unit & Integration Tests
npx vitest run
# Output: Test Files 291 passed (291), Tests 4548 passed | 14 skipped (4562)

# Database Migrations & Verification
npm run test:db
# Output: 35 migrations applied · 271 assertions passed · 0 failed

# Prerender & Client Production Build
npm run prerender && npm run build
# Output: 23 rendered · 23 written · 0 failed · built in ~1.0s

# Security Checks
npm run test:security
# Output: [security-check] source and dependency checks passed
```

---

## 4. Documentation Index

1. [`docs/MANUAL-VERIFICATION-AND-INTEGRATION-GUIDE.md`](../MANUAL-VERIFICATION-AND-INTEGRATION-GUIDE.md) — Master guide for two-way integration setup and testing.
2. [`docs/N8N-WORKFLOW-OPTIMIZATION-ARCHITECTURE.md`](../N8N-WORKFLOW-OPTIMIZATION-ARCHITECTURE.md) — Event-driven scale-to-zero Cloud Run architecture reference.
3. [`docs/N8N-OPERATIONS.md`](../N8N-OPERATIONS.md) — Day-to-day operations and troubleshooting.
4. [`docs/N8N-WORKFLOWS.md`](../N8N-WORKFLOWS.md) — Detailed catalog of all 17 workflows.
5. [`docs/integrations/zapier-app.json`](../integrations/zapier-app.json) — Zapier Private App schema.

---

## 5. Operator Checklist for Promotion to Staging / Main

- [ ] Merge branch `workflow-implementation-and-optimization` into `staging`.
- [ ] In Netlify Edge Access settings: Add `/api/*` and `/.netlify/functions/*` to Edge Access bypass rules so automated API webhooks bypass SSO gates on preview branches.
- [ ] In n8n GCP Cloud Run instance: Ensure `--min-instances=0` is set to allow full scale-to-zero when idle.
- [ ] In `/admin/automation`: Verify that the Pipeline Mode is configured to **Event-Driven (Real-Time Push)**.

</details>

---

## Entry template (copy this when adding a session)

```markdown
## YYYY-MM-DD HH:MM TZ — <headline>

> **Branch:** `<branch>` @ `<sha>` · **Merged to:** `<target>` · **`main`:** <state>

### 1. Quick orientation
### 2. What was accomplished
### 3. Root cause analyses
### 4. Verification evidence
### 5. Environment state after this session
### 6. Open items for the next session
```
