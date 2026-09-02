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
