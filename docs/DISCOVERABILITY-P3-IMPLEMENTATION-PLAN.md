# Discoverability Intelligence — P3 implementation plan

**Branch:** `discoverability-P3`, cut from `Discoverability-P1-P3-implementation` @ `628e47f`.
`main` (`2042348`), `staging` and every other branch are untouched and stay that way.
**Source of truth:** *DatIQ Discoverability Intelligence System — Consolidated BRD and PRD,
P1/P2/P3* (37pp) + the Perplexity architecture deck (18pp).
**Status:** P1 (W1–W8) and P2 (W9–W14) are complete as code. **Neither is complete as a
product**, and §2 is the honest account of the difference.
**Next migration number: `0065`.**

> **Companions.** [`DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md`](DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md)
> — what shipped and its **§7 deviation register**, which this plan consumes as its
> backlog · [`AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P2.md`](AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P2.md)
> — the 61-check runner every checkpoint below extends ·
> [`DB-MIGRATION-RUNBOOK.md`](DB-MIGRATION-RUNBOOK.md) §4d–§4e.

---

## 0. Read this first — the one thing that blocks half this plan

🔴 **THE P3 CLAUSE LIST IS NOT IN THIS REPOSITORY.**

P1 and P2 were each planned from a clause-by-clause gap analysis against the consolidated
BRD/PRD — §1 and §2 of the P1/P2 plan, which name PRD sections down to `§9.7` and quote the
formulas verbatim. **No equivalent exists for P3, because the document itself is an
attachment that no session committed.** Every reference to P3 in this repository is the same
two sentences: decision **D10**, *"out of scope on this branch until P1 + P2 are complete and
merged"*, and a note that the test sheet will extend into it.

So this plan is deliberately split:

| | Basis | Can start |
|---|---|---|
| **CP-0 … CP-6** | Fully specified **in this repository** — the P1/P2 plan's §7 deviation register (DEV-01…07, DEF-01…08), §9.10's unbuilt approval model, and D6's deferred roles | **Immediately.** Nothing here is guessed. |
| **CP-7** | P3 proper | **Blocked** until the BRD/PRD's P3 sections are available and CP-0 turns them into a gap analysis |

⚠️ **I will not infer P3's scope from the deck and the non-goals list.** This module has been
burned four separate times by a guessed vocabulary — W4's "M1–M13", W10's fourteen entity
types, W11's component initials, W13's TC and Schema initials — and each time the repair was
*"derive the name, never the weight, and never the id, because an id travels in stored rows
and every historical diff."* A guessed **scope** is the same mistake one level up: it would
produce migrations and public codes that cannot be renumbered later.

**What is needed:** the BRD/PRD's P3 sections, or a written scope statement. See §5, D12.

---

## 1. Where the module actually stands — verified this session, not carried forward

| Layer | State | Evidence |
|---|---|---|
| **Pure models** | 32 modules in `src/lib/discoverability/`, every one with a production importer | completion sweep, 2026-09-12 |
| **Migrations** | `0030`–`0064`; all 64 meet a real Postgres in `npm run test:db` (791 assertions) | `scripts/db-verify.mjs` |
| **API** | 16 route roots on `/api/discoverability/*`, canonical `/api/v1/discoverability/*` with permanent aliases | `netlify/functions/discoverability.js` |
| **Entitlements** | 9 `audit.*` capabilities; **writes gated, reads not** | `entitlementModel.js` |
| **P1 UI** | 9 components + the `/discoverability` page (779 lines) — score tiles, pillars, issue matrix, queue, evidence, trend, history, AI-visibility panel | `src/components/discoverability/` |
| **P2 UI** | 🔴 **none** | §2.2 |
| **Tests** | 392 files / 6 553 passed / 0 failed · db-verify 64/791/0 · referral 17 · workflows 56 | this session |
| **Deployed** | dev/stage carry every migration through `0064`. 🔴 **Production carries none of `0050`–`0064`** | owner-confirmed |

⚠️ **`DISCOVERABILITY-MODULE.md` §8 is STALE and contradicts this.** Its release-mapping table
still marks W5 ⚠️, **W6 ❌ "largest remaining P1 item"**, W7 ⚠️ and W8 ⚠️, and says *"P2 …
is not started."* All of that was true when it was written and none of it is true now —
W6 shipped as `0052`/`0053`, W8 as `0054`, and P2 ran to `0064`. **Correcting it is CP-0
work**, because the next person to plan from that table will plan the wrong half of the module.

---

## 2. The three gaps that are larger than they look

### 2.1 DEV-01 — the subject spine has no first link

`POST /subject-score/scores` is **unreachable for any API caller.**

`audit_subjects` rows are minted by exactly one caller — `ensureSubject`, from the audit
pipeline, always with `kind: "page"` — and `0057`'s `kind_matches_ref` CHECK requires
`entity_id is not null` for `brand` / `product` / `service`. **Nothing in the API creates a
subject over an entity.** So `scoreIdFor("page")` returns `null` and the route correctly 400s.

The model, the store, the route, the migration and the tests are each complete **in
isolation**. The chain from *"I have a brand"* to *"here is its BDS"* has no first link — and
BDS / PDS / SFS is the thing P2 exists to produce. **Every P3 surface that reports a brand,
product or service score is blocked behind this.** → **CP-1**, decision **D12**.

### 2.2 The P2 surface gap, and it is worse than "no screens"

**No component in `src/` reaches any P2 route.** Grep confirms it in both directions:

* `discoverabilityClient.js` carries **23 P2 method definitions — all for W9 and W10 only**
  (`business-truth`, `entity-graph`), and **zero components import any of them.**
* W11, W12 and W13 have **no client method at all**: `local-directory` 0, `schema-trust` 0,
  `subject-score` 0.

🔴 **That is this module's own signature defect, one layer up from where it has been caught
four times.** `audit_signals.raw_value`, `.evidence_json`, `audit_recommendations.issue_id`
and `audit_entity_evidence` were each declared, reviewed, merged and written by nothing. Here
a *client wrapper* was written, reviewed, merged and **called by nothing** — and its own test
suite passes, exactly as `subjectScoring.js`'s did for three workstreams.

**The guard this needs is the one `subject-score-parity.test.js` already models:** assert a
**non-test importer exists** for every client method, and that every route root has a client
method. → **CP-3**, before any screen is built.

### 2.3 Production is fifteen migrations behind

`0050`–`0064` are on dev/stage and **not on production**. Every P2 endpoint reads a table
that does not exist there, so **a deploy without the apply turns a feature that tested clean
twice into a 500.**

⚠️ **`0061` is the RPC lockdown** — ten `SECURITY DEFINER` functions taking a caller-supplied
`p_user_id`, each an impersonation primitive reachable with the committed publishable key.
**It is a security fix and must not wait on a feature release to carry it.** → **CP-0**.

---

## 3. The checkpoints

Every checkpoint ends the same way, and a checkpoint is not done until all five hold:

1. `npx vitest run` green, **with every new behavioural guard confirmed RED first**
2. `npm run test:db` green (migrations meet a real Postgres)
3. `npm run verify:discoverability` exercised on a branch preview — **exit 0, not 2**
4. The **automated test sheet gains its rows** (ids matching the runner, parity test passing)
5. The plan's own **§7 deviation register gains a row** for anything deferred — add rows, never delete them

---

### CP-0 · Ground truth and production parity
**No new features. This is the checkpoint that makes every later one safe.**

| # | Deliverable |
|---|---|
| 0.1 | 🔴 **Obtain the P3 clause list** and produce `docs/DISCOVERABILITY-P3-GAP-ANALYSIS.md` in the shape of the P1/P2 plan's §1 — PRD section, module, state, evidence. **This is what unblocks CP-7.** |
| 0.2 | 🔴 **Apply `0050`–`0064` to production**, `0061` first and on its own if a feature release is not imminent. Runbook §4d + §4e. |
| 0.3 | Verify with `npm run verify:rls -- --prod` → 15/15 refused, and `npm run verify:discoverability --base-url=https://datiq.app --env=production` → the migration rows stop reading DEVIATION. |
| 0.4 | Correct `DISCOVERABILITY-MODULE.md` §8 (§1 above). Add a P2 section that reflects `0055`–`0064`. |
| 0.5 | **First live third-party exercise** (DEF-06): one real directory fetch through the compliance engine, one real grounded-Gemini prompt run. Both paths are pinned only by unit test today. |

**Gate:** production answers `verify:discoverability` with zero stop-ship rows, and the runner
prints the migration checks as PASS rather than SKIP.
**Risk if skipped:** every later checkpoint ships onto a database that cannot serve it.

---

### CP-1 · The subject spine — close DEV-01 · migration `0065`
**Blocked on decision D12.**

| # | Deliverable |
|---|---|
| 1.1 | A way to mint a `brand` / `product` / `service` subject over an approved `audit_entities` row (and, where D12 says so, over a truth record for `domain`). |
| 1.2 | `ensureSubject` gains the entity path; `upsert_audit_subject` stays the single atomic get-or-create (`0060`'s rule). |
| 1.3 | `POST /subject-score/scores` reachable end to end for all three scorable kinds. |
| 1.4 | ⚠️ **Forward-only. No backfill.** A subject minted retroactively over an entity nobody reviewed would put a score on a node the graph has not agreed exists. |
| 1.5 | Runner rows **F-02, F-04, F-05, D-11** move from DEVIATION/BLOCKED to PASS. |

**Gate:** `verify:discoverability --allow-writes` → the whole F-series green on a branch preview.
**Why first:** every brand/product/service surface in CP-4 and (almost certainly) CP-7 reads
this. Building those screens against an unreachable endpoint means building them twice.

---

### CP-2 · Governance — roles, approval stages, connector gating · migration `0066`
**Blocked on the signed role matrix (DEF-03 / D6).**

| # | Deliverable |
|---|---|
| 2.1 | **D6's seven discoverability roles** — viewer, analyst, editor, manager, admin, agency admin, client viewer — mapped onto existing workspace membership **where they can be derived**, with a discoverability-scoped mapping only where they cannot. 🔴 **Not guessed.** A role id ends up in stored grants. |
| 2.2 | **§9.10's approval stages** applied to the P2 write paths. ⚠️ **Extend `workflowLifecycle.js`; do not build a second state machine** — and re-read W14's finding first: `canTransition` is **deliberately not a gate**, and the enforcement that looks obvious is dead code that reads as a guard. The integrity that matters lives in `requirementsFor`. |
| 2.3 | **Connector approval-gating** (DEF-04) — a push to HubSpot / Notion / Airtable / Slack from a discoverability finding goes through the approval model, not straight out. |
| 2.4 | Entitlement capabilities extended where a role implies one; the `audit.benchmark` precedent D9 names, never a new plan axis. |

**Gate:** cross-role refusals asserted in both directions — a viewer cannot approve, and an
approver is not refused. **404 never 403** on anything cross-tenant.
**Why before the UI:** six screens built against a provisional permission model get touched
twice. Governance first means each screen is written once, against the final one.

---

### CP-3 · Complete and guard the client layer
**Small, and it is the checkpoint that stops §2.2 happening again.**

| # | Deliverable |
|---|---|
| 3.1 | `discoverabilityClient.js` gains methods for **`local-directory`, `schema-trust`, `subject-score`** — currently zero. |
| 3.2 | 🔴 **A parity test that asserts, from the real route table: every route root has a client method, and every client method has a NON-TEST importer.** Modelled on `subject-score-parity.test.js`. Confirmed RED by deleting one importer. |
| 3.3 | The test is allowed to carry a declared, reasoned exception list — a method built one checkpoint ahead of its screen is legitimate; a method nobody ever calls is not. **Every entry names the checkpoint that will consume it.** |

**Gate:** the parity test goes red when a method loses its caller.
**Why it earns a checkpoint:** without it, CP-4 can ship five screens and one orphan and
nothing says so — which is precisely how `subjectScoring.js` sat unused for three workstreams.

---

### CP-4 · The P2 surfaces (DEF-01) — the largest gap between "complete" and "usable"

Six sub-checkpoints, each shippable on its own. **Do not merge them into one screen** — the
P1 page is already 779 lines.

| # | Surface | Reads | Notes |
|---|---|---|---|
| 4a | **Business truth record** — record, versions, diff, promote | W9 | 🔴 Self-approval is refused in three layers; the UI must **explain** the refusal, not just surface a 403. Two required fields, not fifteen. |
| 4b | **Entity graph** — entities, relationships, conflicts, approve/reject | W10 | Endpoint types are **joined from the entities, never stored on the edge**. A duplicate edge is a 409 that **corroborates** — render that, not an error. |
| 4c | **Local & directory** — listings, check, findings, correction packs, service radius | W12 | 🔴 **`coverageClaim()` is the one place the coverage sentence is built.** The screen must render it verbatim and never compose its own — a flat "N directories audited" is false for every customer who authorised nothing. An unchecked source is **excluded and named**, never a zero. |
| 4d | **Schema & trust** — per-type validation matrix, trust observations, TC | W13 | ⚠️ `fidelity` is the one score where **more markup means a lower number**; the UI must say why, or it reads as a bug. A contradiction ranks above an absence. |
| 4e | **Subject scores** — BDS / PDS / SFS, components, coverage, trend | W11 | **Depends on CP-1.** 🔴 An excluded component renders as *"cannot measure yet — blocked by W-x"*, never as a zero, and never in `--dsc-danger`. Coverage renders **beside** the score, always. |
| 4f | **Navigation + the composer's subject selector** | — | One entry point per surface. `/discoverability` stays a **private prefix** — adding a sub-route means updating **four** places (`PRIVATE_PREFIXES`, the `X-Robots-Tag` exact-path rule, `robots.txt`, `index.html`'s guard), and `page-ownership.test.mjs` asserts all four. |

**Gate per sub-checkpoint:** its runner rows pass with `--allow-writes`, and the
**confirm-by-eye** list in the test sheet gains the visual assertions a runner cannot make —
muted vs danger, the coverage sentence, the THIN stamp.

---

### CP-5 · Workspace rollups (DEF-05) · migration `0067` if needed

Every `audit_*` table already carries a nullable `workspace_id` and `0054` actually writes it,
so this is additive rather than a retrofit. Deliverable: a workspace-level view of audits,
subjects, truth records and findings, with the **same exclusion discipline** — a workspace
whose members have audited nothing has *no data*, not a zero.

---

### CP-6 · API conformance and the published inventory (DEF-02)

The canonical `/api/v1/discoverability/*` prefix and its permanent aliases exist (D2). What
does not exist is the **published fourteen-endpoint inventory** the PRD asks for: request and
response shapes, error codes, the entitlement each write requires, and the 404-never-403 rule
stated where integrators read it. Extends `docs/DatIQ-Developer-API.md`.

---

### CP-7 · P3 proper — **blocked on CP-0.1**

Structure, to be filled from the gap analysis rather than from inference:

* **P3.x gap analysis** → one row per PRD clause, with state and evidence (the §1/§2 shape)
* **P3.x decisions** → continue the D-series from **D12**; anything touching a stored id,
  a weight or a public code is a decision, not an implementation detail
* **P3.x workstreams** → continue the W-series from **W15**, each ending in the five gates in §3
* **P3.x migrations** → from `0068` (or wherever CP-1/2/5 leave off)

⚠️ **The three rules that will apply whatever P3 turns out to contain**, because they have
each already cost this module a repair:

1. **A code, an id or a weight is a public contract.** Derive a label; never renumber an id.
2. **`unknown` is never `0`.** Every new score goes through the one `weightedMean` and carries
   its `coverage`.
3. **Declared is not written, and written is not read.** A new table needs a writer, a new
   module needs a non-test importer, and a new client method needs a screen — each asserted
   by a parity test, not by a document.

---

### CP-8 · Release

| # | Deliverable |
|---|---|
| 8.1 | Extend `scripts/verify-discoverability-e2e.mjs` with the P3 suites; **rename the sheet to `AUTOMATED-MANUAL-TEST-DISCOVERABILITY-P1-P3.md`** — its own header says P3 extends it rather than replacing it. Repoint every inbound link. |
| 8.2 | Run the sheet branch → staging → production, in that order, because each answers a different question. |
| 8.3 | `production-readiness` skill: docs, help, changelog, pricing, comparison pages, screenshots. ⚠️ **Every pricing cell derives from the limit `entitlementModel.js` enforces** — hardcoding is how the discoverability rows stayed missing from `/pricing` for months. |
| 8.4 | Merge path: this branch → `Discoverability-P1-P3-implementation` → `staging` → `main`, each with its own gate. **No branch outside this chain is touched.** |

---

## 4. Why this order

**CP-0 first** because production cannot serve any of it today, and because planning CP-7
from a stale release-mapping table would plan the wrong half of the module.

**CP-1 before CP-4** because the subject spine is the input to every score surface. Building
4e against a route that 400s means building it twice.

**CP-2 before CP-4** because a permission model retrofitted across six screens is six
retrofits. Governance is cheap to build first and expensive to add.

**CP-3 before CP-4** because the client layer is where §2.2's defect lives, and the guard is
twenty lines. Shipping screens first means the guard arrives after the thing it would have caught.

**CP-5 and CP-6 after CP-4** because both are additive to a surface that exists. A rollup of
screens nobody can open is a rollup of nothing.

**CP-7 last** because it is the only part that is not yet specified.

---

## 5. Decisions needed before coding — continuing the D-series

| # | Decision | Why it cannot be defaulted |
|---|---|---|
| **D12** | 🔴 **How a scorable subject is created** (DEV-01). Auto-mint one per approved entity, or make it an explicit act with its own endpoint? | Auto-minting puts a row in `audit_subjects` for every proposed-and-later-rejected node, and a score history hangs off it. Explicit minting needs an endpoint nobody has specified. Both are defensible; the choice shows up in stored rows and cannot be quietly reversed. |
| **D13** | 🔴 **P3 scope** — the clause list, or a written scope statement | §0. Guessing produces migrations and public codes that cannot be renumbered. |
| **D14** | **The signed role matrix** for D6's seven roles — derivable from workspace membership, or its own vocabulary? | A role id travels in stored grants; the same class as a guessed component id, in a place that gates access. |
| **D15** | **Approval stages vs the shipped lifecycle** — does §9.10's seven-stage model map onto `workflowLifecycle.js`'s eight states, or does P3 need a second axis? | W14 already found that the obvious enforcement here is dead code. A second state machine beside the working one is how a queue ends up with two answers to "what state is this in". |
| **D16** | **Live-engine and live-directory budget** (DEF-06) — which engines, whose keys, what monthly cap? | The August 504 came from unbudgeted serial work. A live path with no cap is the same shape. |

---

## 6. Standing rules this plan inherits

Carried from the P1/P2 plan's §5 and the deviation register. Restated because every one of
them was learned from a repair:

1. `unknown` is never `0` — exclude and redistribute through the single `weightedMean`; every score carries `coverage`.
2. A profile is a **lens**, not different maths.
3. Observed fact ≠ inference. Separate fields, separately labelled, everywhere they surface.
4. No ranking, traffic, citation or revenue guarantees in any copy, report, export or API field.
5. Approval before external effect. Nothing publishes itself.
6. Pure model code stays pure — `src/lib/discoverability/*`, zero I/O, imported by both React and `netlify/`.
7. Codes are a public contract. Add; never repurpose or renumber.
8. The compliance gate applies to **every** fetch, directory pages included.
9. A parent id in a request body is a claim, not a fact. **404, never 403.**
10. `SECURITY DEFINER` → `revoke all … from public, anon, authenticated` **and** an explicit `grant execute … to service_role`.
11. Ask what a table **answers** before giving it a unique arbiter — upsert answers "now", append answers "then".
12. Design system unchanged. `design-system.css` + `screens.css` tokens; no Tailwind conversion.

---

## 7. What "done" means

P3 is complete when, against **production**:

* `npm run verify:discoverability --base-url=https://datiq.app --env=production` exits **0** —
  every stop-ship check exercised and passed, not skipped
* every P3 clause in CP-0.1's gap analysis is ✅ or carries a **deviation-register row with a
  named reason**
* every `audit_*` table has a writer, every `src/lib/discoverability/*` module has a
  production importer, and every client method has a screen — each asserted by a parity test
* the confirm-by-eye list has been walked by a human on production and signed off in §6 of the
  test sheet

---

## 8. Deviation register

Empty at the time of writing. **Add rows, never delete them** — when a deferment later ships,
mark it ✅ RESOLVED with the migration or commit that did it. The record of *why something
waited* is the part that stops the same debate happening twice.

| # | What | Why | Status |
|---|---|---|---|
| — | — | — | — |
