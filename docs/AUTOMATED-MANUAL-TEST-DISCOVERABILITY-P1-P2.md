# Automated + manual test — Discoverability P1 + P2 (W1–W14)

> **Rewritten 2026-09-12** against `Discoverability-P1-P3-implementation`.
> Supersedes `MANUAL-TEST-DISCOVERABILITY-P1-P2.md`, which was 76 rows of
> hand-driven curl. **P3 extends this document rather than replacing it.**
>
> Most of that sheet is now one command:
>
> ```bash
> npm run verify:discoverability -- --base-url=<host> --target=<a url you may audit>
> ```
>
> What remains for a human is **13 rows the runner cannot see** (§11) and a short
> **confirm-by-eye** list the runner prints for you at the end of every run.
>
> **Companions.** [`DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md`](DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md)
> — what each workstream shipped, and its **deviation register** ·
> [`DB-MIGRATION-RUNBOOK.md`](DB-MIGRATION-RUNBOOK.md) §4b–§4e — the apply
> procedures · [`POST-DEPLOYMENT-MANUAL-TEST.md`](POST-DEPLOYMENT-MANUAL-TEST.md)
> — the workflow pipeline, a separate subsystem.

---

## 0. The shortest useful version

```bash
# 1 · branch preview — does the code work at all against a real Postgres?
DATIQ_TEST_TOKEN=… DATIQ_TENANT_B_TOKEN=… DATIQ_FREE_TOKEN=… \
npm run verify:discoverability -- \
  --base-url=https://deploy-preview-123--datiqapp.netlify.app \
  --target=https://example.com/pricing \
  --db-url="$DEV_SUPABASE_DB_URL" \
  --md=reports/branch.md

# 2 · staging — does it work against the data and config a real tenant has?
#     (same command, --base-url=https://staging--datiqapp.netlify.app)

# 3 · production — READ-ONLY by default. Nothing is written, nothing is spent.
npm run verify:discoverability -- --base-url=https://datiq.app --env=production
```

**Exit codes.** `0` every stop-ship check exercised and passed · `1` something is
wrong · `2` **inconclusive** — not enough was exercised to conclude anything.
🔴 **`2` is not a pass.** It is the repo's existing convention (`verify:rls` uses
it for the same reason) and it must never read as success in CI.

---

## 1. Why the runner refuses to write to production by default

A full write-path regression **creates real rows in a real tenant's account**,
and an audit run **spends real quota from that month's allowance**. Several P2
tables have no delete endpoint at all — and `audit_subject_scores` **appends by
design**, because the trend is the product — so residue on production cannot be
tidied away afterwards.

So writing and spending are opt-in, and on production they must be asked for by
hand:

| Flag | What it permits | Default on branch/staging | Default on production |
|---|---|---|---|
| `--allow-writes` | POST/PATCH/DELETE against the P2 surface | **on** | **off** |
| `--allow-audits` | running an audit, which costs one from the month | **on** | **off** |
| `--read-only` | turns both off anywhere | — | — |

Every row the run creates is tagged with its run id and listed at the end.

⚠️ **A check that needs a capability nobody granted reports SKIP, never PASS.**
The whole value of this instrument is that its green means something.

---

## 2. Credentials come from the environment and nowhere else

Never a flag: a flag lands in shell history and in `ps`. Same rule
`e2e/journeys/workflows-authenticated.spec.js` states, for the same reason.

| Variable | Unlocks |
|---|---|
| `DATIQ_TEST_TOKEN` | everything authenticated. Or `DATIQ_TEST_EMAIL` + `DATIQ_TEST_PASSWORD` and the runner mints one |
| `DATIQ_TENANT_B_TOKEN` | 🔴 the cross-tenant **404-never-403** probes — the checks that matter most |
| `DATIQ_FREE_TOKEN` | the W14 entitlement refusals, in both directions |
| `DATIQ_DB_URL` (or `--db-url`) | the schema, nullability and declared-vs-written checks |

🔴 **A token from one Supabase project does not authenticate against another.**
Staging and production are **different projects** (`aubwooslkkrprdxuiyvj` vs
`sikkfxysjhirmtwkumpt`). A 401 on P-06 is almost always this.

---

## 3. The three environments answer different questions

Run them in order. Passing on one does not answer for the next.

| | Branch deploy | Staging | Production |
|---|---|---|---|
| **The question** | Does the code work at all against a real Postgres, real PostgREST and a real session? | Does it work against the data and config a real tenant has? | Does it work for customers, under real traffic and real money? |
| **Database** | dev/stage Supabase | same dev/stage project | 🔴 **production Supabase — a different project** |
| **`0060`–`0064`** | ✅ applied (owner-confirmed 2026-09-12) | ✅ applied | 🔴 **NOT applied. Apply before deploying.** |
| **Host** | PR preview URL (previews bypass `allowed_branches`) | `staging--datiqapp.netlify.app` — 401-gated by Netlify edge access | `datiq.app` |
| **Runner mode** | full | full | read-only unless asked |

🔴 **The migration row is the single most important one in this table.**
`0060`–`0064` are on dev/stage and **not** on production. Deploying this branch
to production without applying them first gives every P2 endpoint a table that
does not exist — **a 500 on a feature that tested clean twice.**
[`DB-MIGRATION-RUNBOOK.md` §4d and §4e](DB-MIGRATION-RUNBOOK.md) are the
procedures, and **§4d (`0061`) is a security fix that should not wait on a
feature release to carry it.**

⚠️ **Netlify injects Function env vars at DEPLOY time.** A variable changed in
the UI reaches no function until that context redeploys.

---

## 4. Reading the result

Five verdicts, and the third is the useful one.

| | Means | Your move |
|---|---|---|
| **PASS** | the expectation held | read its **confirm-by-eye** line |
| **FAIL** | the expectation did not hold | the **fixes to be done** block names where to look |
| **DEVIATION** | not broken, but different from what the plan documents | usually an **apply**, not a code fix |
| **SKIP** | a prerequisite was absent — it says which | supply it and re-run, or accept the gap knowingly |
| **BLOCKED** | an earlier check it depends on did not pass | fix that one first |

The run ends with four blocks: **fixes to be done** (every failure with its
remedy), **deviations**, **confirm by eye** (the stop-ship passes, with the one
thing a human should look at), and **not automatable** (§11).

🔴 **Never infer a deploy from a 200.** A SPA catch-all answers a missing asset
with `index.html` at status 200, and the browser then silently refuses the HTML
as a module script — so "everything returns 200" is compatible with React never
booting. P-01 checks the `content-type`; by hand:

```bash
curl -s https://<host>/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'
curl -sI https://<host>/assets/index-<hash>.js | grep -i content-type
# must read application/javascript — text/html means the asset is not there
```

---

## 5. A refusal is evidence only if the database wrote it

Worth knowing, because it was found by falling into it.

`verify:rls` and this runner's §9 both conclude an RLS lockdown is live from an
anonymous PostgREST probe being refused. Run either from behind an egress proxy
that allow-lists hosts — a CI sandbox, a corporate network, a VPN — and **every
request is answered `403` by the proxy before it reaches Supabase.** The old loop
counted each of those as a refusal and printed *"All 15 tables refuse anonymous
reads. 0044 is applied"* **from a machine that had never contacted the project.**

`scripts/lib/postgrestAnswer.mjs` is now the one predicate both use: PostgREST
answers in JSON, always, including its errors; a proxy answers with its own
content type and its own prose. Anything that did not come from PostgREST is
**INCONCLUSIVE**, which is a third verdict and not a synonym for either of the
other two.

⚠️ **A security gate that reports "locked down" when it could not reach the host
is worse than no gate: it is a green light nobody will look behind.**

---

## 6. Sign-off

| Environment | Run id | Date | Tester | Exit | Confirm-by-eye done | Verdict |
|---|---|---|---|---|---|---|
| Branch | | | | | | |
| Staging | | | | | | |
| Production | | | | | | |

**Production is not signed off until `0060`–`0064` are applied there and P-02
passes against the production database.**

---

## 7–10. The checks, one by one

Every row below is a check in `scripts/verify-discoverability-e2e.mjs`, and the
ids match. `scripts/verify-discoverability-e2e.test.mjs` asserts that every check
carries the three lines a human needs — **before it can run**, **confirm by
eye**, **if it fails** — so a check whose result nobody can act on fails the
build.

### 2. Pre-flight — five minutes, and it saves an afternoon

#### P-01 — The deployment serves a real JS bundle, not the SPA fallback

🔴 **Stop-ship.** Needs: nothing extra.

- **Before it can run:** None. Run this first on every environment.
- **Confirm by eye:** Open the site and confirm React actually boots — a button navigates, the theme toggle toggles. A styled page with dead controls is exactly what this failure looks like.
- **If it fails:** The prerendered pages reference an asset the deploy does not carry. `scripts/sync-prerender-assets.mjs` runs after `vite build` and must repoint every /assets/ reference in dist/. Check the build log for it.

#### P-01b — The discoverability function is deployed and routing sub-paths

🔴 **Stop-ship.** Needs: nothing extra.

- **Before it can run:** P-01.
- **Confirm by eye:** None needed — a JSON body with `goals` and `audit_types` can only come from this function.
- **If it fails:** Check netlify.toml's `/api/discoverability/*` → `/.netlify/functions/discoverability/:splat` rule. A query-param splat (`?splat=:splat`) is the shape that produced 'Unknown endpoint' on every audit once already.

#### P-01c — The P2 code is on this deployment (W11/W12/W13 registries answer)

🔴 **Stop-ship.** Needs: token.

- **Before it can run:** A valid DATIQ_TEST_TOKEN — the registries sit behind auth.
- **Confirm by eye:** The subject-score registry must name BDS, PDS and SFS. If it names only two, the deploy predates W11's completion.
- **If it fails:** This environment is running a build from before P2. Redeploy the branch; a green CI run on the branch does not mean the branch is what is deployed.

#### P-02 — Migrations 0057–0064 are on THIS environment's database

🔴 **Stop-ship.** Needs: nothing extra.

- **Before it can run:** Either --db-url, or --allow-writes so the write probe can stand in.
- **Confirm by eye:** 🔴 Worth doing by hand whatever this says. `select count(*) from information_schema.tables where table_schema='public' and table_name in ('audit_subjects','audit_directory_listings','audit_schema_entities','audit_trust_evidence','audit_subject_scores');` must return 5.
- **If it fails:** Apply the migrations. docs/DB-MIGRATION-RUNBOOK.md §4b–§4e are the procedures. A deploy without the apply gives every P2 endpoint a table that does not exist — a 500 on a feature that tested clean twice.

#### P-03 — audit_subject_scores.score is NULLABLE and coverage is NOT NULL

🔴 **Stop-ship.** Needs: `--db-url`.

- **Before it can run:** --db-url.
- **Confirm by eye:** 🔴 The single most expensive thing on this sheet to get wrong. If `score` came back NOT NULL, an unmeasurable subject is stored as a real zero and nothing afterwards can tell it from a subject that genuinely scored zero. Re-read the column by hand.
- **If it fails:** 0064 declares `score numeric(5,1)` with no NOT NULL and `coverage numeric(5,1) not null`. If this environment disagrees, a hand-edit was applied. Reconcile to the migration before storing anything.

#### P-04 — RLS is enabled on the new P2 tables

🔴 **Stop-ship.** Needs: `--db-url`.

- **Before it can run:** --db-url. S-01 checks the same thing from the attacker's side and needs no database.
- **Confirm by eye:** S-01 is the one that matters — an anonymous PostgREST read must be refused. RLS enabled with a permissive policy would pass here and fail there.
- **If it fails:** Each migration ends with `alter table ... enable row level security` plus a service_role-only policy and a revoke from anon/authenticated. Re-apply the migration.

#### P-05 — The 0044 RLS lockdown holds on this project (15/15 refused)

🔴 **Stop-ship.** Needs: anon key.

- **Before it can run:** The repository checkout, and a Supabase URL + anon key for this environment.
- **Confirm by eye:** Read the script's own output. 401 or 404 on every table is the pass; a 200 with real row ids is a live data leak.
- **If it fails:** Apply 0044. Until then every Phase 4-6 table is world-readable with the committed publishable key.

#### P-06 — The test account authenticates against this deployment

🔴 **Stop-ship.** Needs: token.

- **Before it can run:** DATIQ_TEST_TOKEN, or DATIQ_TEST_EMAIL + DATIQ_TEST_PASSWORD.
- **Confirm by eye:** Sign in to the same account in a browser and confirm /discoverability loads its history. A token that authenticates to the API but a session that does not load is a client-side problem this runner cannot see.
- **If it fails:** A token from one Supabase project does not authenticate against another. Staging and production are DIFFERENT projects — confirm the token came from this environment's project.

### 3. P1 (W1–W8) — audit, scoring, comparison, export, compliance

#### A-01 — An audit of a real URL completes with four pillar scores

🔴 **Stop-ship.** Needs: token, `--allow-audits`, `--target`.

- **Before it can run:** --target=<a URL you own or may audit>, --allow-audits, and quota remaining.
- **Confirm by eye:** Open the audit in the UI. The four pillar numbers on screen must equal the ones in the report the runner prints — a fresh audit and a stored one are supposed to be identical by construction.
- **If it fails:** A 502 AUDIT_FAILED is the pipeline; a 503 STORAGE_UNAVAILABLE is the database. A 504 is the budget — AUDIT_BUDGET_MS defaults to 8s against a 10s function timeout; this repo has shipped that 504 once already.

#### A-02 — An unmeasured signal is NULL, never 0, and costs coverage

🔴 **Stop-ship.** Needs: token.

- **Before it can run:** A-01.
- **Confirm by eye:** 🔴 Look at the screen. An unmeasured signal must render muted or as “not measured” — `--dsc-muted` is not `--dsc-danger`. A grey dash and a red zero are the same number to this runner and completely different to a customer.
- **If it fails:** `weightedMean()` in scoringModel.js is the single implementation and every score flows through it. A 0 where a null belongs means a caller coerced before scoring — `numOrNull` returning 0 for null is the exact bug this rule exists for (`Number(null)` is 0 and finite).

#### A-03 — A re-audit of the same URL compares, with deltas

⚠️ _File a bug; not a blocker._ Needs: token, `--allow-audits`, `--target`.

- **Before it can run:** A-01 and a second audit — this SPENDS A SECOND AUDIT.
- **Confirm by eye:** The diff's issue list should name what resolved between the two runs. On an unchanged page every delta should be 0 or near it; a large swing on an unchanged page is a measurement problem, not an improvement.
- **If it fails:** `auditDiff.js` is where this lives. A version mismatch refuses the deltas by design and still reports the issue list — that is `incomparableDiff`, not a bug.

#### A-04 — Two audits of DIFFERENT pages are refused as incomparable, with a cause

🔴 **Stop-ship.** Needs: token.

- **Before it can run:** A-01 and A-03 (two audits of the same page), plus any older audit of a different page on the account.
- **Confirm by eye:** 🔴 The refusal must be visible, not a footnote. A caveat under a confident '+6.2' is read as a footnote and the number is what gets screenshotted.
- **If it fails:** This is D7's `sameSubject()` gate in compareRoute. If it returns comparable:true across two different subjects, the fallback is matching two NULL subject_ids — which must NEVER count as a match.

#### A-05 — An audit read back from history renders identically to a fresh one

⚠️ _File a bug; not a blocker._ Needs: token.

- **Before it can run:** A-01.
- **Confirm by eye:** Open the SAME audit from History in the UI. Signal NAMES, coverage and weights must all be there. This is the bug that never reproduces while you are looking at it: a fresh audit rendered perfectly and a stored one did not.
- **If it fails:** `rehydrate()` must route stored values back through `scorePillar()` — the same pure function the pipeline uses — so the two paths are identical by construction rather than by two field lists happening to agree.

#### A-06 — The markdown/JSON report exports carry scores, signals and evidence

⚠️ _File a bug; not a blocker._ Needs: token.

- **Before it can run:** A-01.
- **Confirm by eye:** Export the PDF from the UI — the runner cannot render one. A sub-70-coverage audit must be stamped THIN, because a PDF is forwarded to clients and read months later.
- **If it fails:** `buildMarkdownReport` / `toJsonPayload` in auditReport.js. A report that reshapes keys for API consumers (`framework_scores.overall`) must not be fed to a renderer expecting `finalScore` — that prints 'not measured' for every score.

#### A-07 — CSV rows=signals exports an unmeasured signal BLANK, never 0

🔴 **Stop-ship.** Needs: token.

- **Before it can run:** A-01.
- **Confirm by eye:** Open the CSV in a spreadsheet. A 0 in a numeric column gets averaged; a blank does not. That is the whole reason for the rule.
- **If it fails:** `signalsToCsv` in auditReport.js must emit an empty cell for `score === null`. Any `?? 0` or `Number(x)` on the way out re-creates the bug.

#### A-08 — A robots.txt-disallowed URL is refused clearly, not as a crash

🔴 **Stop-ship.** Needs: token, `--allow-audits`.

- **Before it can run:** --allow-audits (the refusal costs nothing, but it is still an audit request).
- **Confirm by eye:** 🔴 Read the message a customer would see. It must name robots.txt. 'Something went wrong / An unexpected error occurred' over a minified stack is what this looked like for months, and it is a policy decision being reported as a fault.
- **If it fails:** Branch on `code` (`robots_disallowed`), never on the prose in `reason` — the client classifier matches on message text only, so the string hits none of its regexes and falls to the generic default.

#### A-09 — The refusal in A-08 created no audit row and cost nothing

⚠️ _File a bug; not a blocker._ Needs: token, `--allow-audits`.

- **Before it can run:** A-08.
- **Confirm by eye:** Check the account's usage for the month before and after. A refused request must be free — `consumeGuestCredit` once ran BEFORE the compliance check and a guest pasting three disallowed URLs was charged three times for work never done.
- **If it fails:** Gate order in executeAudit is load-bearing: everything above the audit-row insert can decline without doing work, so nothing above it may bill.

### 4. W9 + W10 — truth record, approval interlocks, entity graph

#### B-01 — A truth record is created and a draft version saved

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** --allow-writes and a Select-or-above account.
- **Confirm by eye:** The record should be visible in the account's own list. Confirm the canonical domain is stored as a BARE HOST — lower-case, no scheme, no www. It is the bridge key to public.canonical_entities and both sides must spell it identically or the same company resolves twice.
- **If it fails:** A 402 means W14's entitlement gate refused — expected on Free. A 500 means the table is absent; see P-02.

#### B-02 — Self-approval of your own truth version is REFUSED

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** B-01.
- **Confirm by eye:** 🔴 Confirm the message says a second person must look, not 'something went wrong'. Blocked in three places — canPromote(), the audit_btv_no_self_approval CHECK, and promote_business_truth_version() — so a 200 here means all three were bypassed.
- **If it fails:** If this passes, the interlock is gone. Re-check 0055's CHECK constraint and the SQL function — the route alone is not the guard.

#### B-04 — audit_business_truth_conflicts is actually WRITTEN, not merely declared

🔴 **Stop-ship.** Needs: `--db-url`.

- **Before it can run:** --db-url, or an account that has already audited a domain with an approved record.
- **Confirm by eye:** 🔴 This schema's own recorded failure mode is a column declared, reviewed, merged and written by nothing — four times. A read path returns null identically for 'no conflict' and 'nobody ever wrote here', which is why this is checked at the storage layer.
- **If it fails:** checkAgainstTruthRecord() must be called from executeAudit and its result stored. A conflict table that stays empty across real audits of a recorded domain is the fifth instance of the pattern.

#### B-05 — Two entities and a valid edge between them are created

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** --allow-writes.
- **Confirm by eye:** Both endpoint types are JOINED from the entities, never stored on the edge — a second copy would drift the first time a node was re-typed. Confirm the edge response does not carry its own subject_type/object_type.
- **If it fails:** A 422 INVALID_RELATIONSHIP means the predicate's domain/range rejected the pair, which is the model working. A 500 means the table is absent.

#### B-06 — A duplicate edge is 409 and the body says it was corroborated

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** B-05.
- **Confirm by eye:** 🔴 Without the unique index a weekly crawler adds a row per run, every count doubles, and 'who do we compete with' answers differently depending on how many audits have happened. Confirm the edge count did not grow.
- **If it fails:** `corroborated: false` in the 409 body means recordEntityEvidence did not write — the exact defect W-security found, where the route CLAIMED corroboration and its test asserted the claim rather than the write.

#### B-07 — audit_entity_evidence carries the corroboration row

🔴 **Stop-ship.** Needs: `--db-url`.

- **Before it can run:** B-06, and --db-url to read it directly.
- **Confirm by eye:** 0056's header states the reason: 'we read this once in 2024' and 'we have read this on six pages across nine months' are different warranties on the same edge. An empty table means only the first sentence is ever true.
- **If it fails:** recordEntityEvidence() must be called from the duplicate-edge branch. It shipped written and called by nothing.

#### B-08 — A self-edge (A → A) is refused

⚠️ _File a bug; not a blocker._ Needs: token, `--allow-writes`.

- **Before it can run:** B-05.
- **Confirm by eye:** 'Acme is part of Acme' is vacuously true and pollutes every traversal. The refusal should say so.
- **If it fails:** Refused in the route (SELF_EDGE) and by a CHECK in 0056. A 201 means both are gone.

#### B-09 — Approving an edge approves both endpoints in one statement

⚠️ _File a bug; not a blocker._ Needs: token, `--allow-writes`, 2nd account.

- **Before it can run:** B-05 and a SECOND account, because self-approval is refused here too.
- **Confirm by eye:** The endpoints are APPROVED, not CREATED — a node somebody rejected must block the edge rather than being silently revived. Confirm a rejected endpoint yields 409 ENDPOINT_REJECTED.
- **If it fails:** approveEntityRelationship() does all three in one SQL statement. Three PostgREST calls would leave windows where an approved edge joins two unreviewed nodes.

#### B-10 — Another tenant's entity id in an edge is 404, never 403

🔴 **Stop-ship.** Needs: token, `--allow-writes`, 2nd account.

- **Before it can run:** DATIQ_TENANT_B_TOKEN, and B-05 having created an entity under the primary account.
- **Confirm by eye:** 🔴 A 403 confirms the row exists and turns the endpoint into an enumeration oracle over other tenants' uuids. This is the single most important row in this section.
- **If it fails:** The route must look the endpoint entities up SCOPED TO THE CALLER and return notFound() when either is absent. `getEntity(userId, id)` — never a global read followed by an ownership comparison.

### 5. W12 — local and directory intelligence

#### C-01 — A directory listing SAVES (the 0059 arbiter fix)

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** --allow-writes.
- **Confirm by eye:** 🔴 The failure this guards is total: PostgREST's `on_conflict=` names COLUMNS, and PostgreSQL will not select an expression index as that arbiter — so 0058's coalesce() index made every listing save fail. Confirm the row comes back with an id.
- **If it fails:** 0059 replaced the expression index with `unique nulls not distinct (...)`. If saves are refused here, this database is on 0058 and needs 0059.

#### C-02 — “Pvt Ltd” vs “Private Limited”, “Rd” vs “Road”, +91 vs 0 — all MATCH

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** C-01, so there is a listing to check against.
- **Confirm by eye:** 🔴 A checker that reports these three as mismatches produces a list nobody reads, and then the one real mismatch in it goes unfixed. Read the match rows and confirm the three fields are `match`, not `mismatch`.
- **If it fails:** Every equivalence in napModel.js is a declared, tested rule — never a fuzzy ratio. A mismatch here means a rule was dropped, not that a threshold needs tuning.

#### C-04 — A registry (MCA) address difference is LD-05, not a NAP mismatch

⚠️ _File a bug; not a blocker._ Needs: token, `--allow-writes`.

- **Before it can run:** --allow-writes; the runner records an MCA listing whose address differs.
- **Confirm by eye:** A registered office is routinely not a shopfront. Reporting an MCA difference as a NAP mismatch sends a customer to amend a STATUTORY FILING to match a shopfront — expensive, slow, and the wrong fix.
- **If it fails:** LD-05 is its own low-severity code for exactly this. If the finding comes back as a general NAP mismatch code, the registry carve-out was lost.

#### C-05 — An unchecked source is EXCLUDED and named, never scored 0

🔴 **Stop-ship.** Needs: token.

- **Before it can run:** C-02 (a completed check).
- **Confirm by eye:** 🔴 Under D5 most customers authorise nothing. Zero-for-unchecked opens every local report near zero — a number about OUR connectors, not their business — then shows a phantom jump the day they connect one.
- **If it fails:** napScore() must exclude unchecked sources and redistribute, the same rule weightedMean() holds for signals. An `unchecked` array that is empty while most sources have no listing means the exclusion was lost.

#### C-07 — The coverage sentence never claims a flat “N directories audited”

🔴 **Stop-ship.** Needs: token.

- **Before it can run:** C-02.
- **Confirm by eye:** 🔴 That claim is false for every customer who has authorised nothing. Read the actual sentence — it is customer-facing copy, and this is the one place it is built.
- **If it fails:** coverageClaim() is the ONE place the sentence is built, and a test sweeps every input for the forbidden form. A flat claim here means a second builder appeared somewhere.

#### C-08 — acquisition: "authorized_api" is REFUSED from a request body

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** --allow-writes.
- **Confirm by eye:** Fidelity is a claim about HOW an observation was obtained. A claim a client can set is not a claim — it is `?consented=true` wearing a third hat.
- **If it fails:** CLIENT_ACQUISITION is the allow-list: declared_url and public_listing only. An authorised-API observation can only be written by the connector that held the token.

#### C-09 — A listing attached to another tenant's truth_record_id is 404

🔴 **Stop-ship.** Needs: token, `--allow-writes`, 2nd account.

- **Before it can run:** DATIQ_TENANT_B_TOKEN and B-01's record under the primary account.
- **Confirm by eye:** 🔴 404, never 403. W12 shipped without this check at all, so a caller could file a whole local check against another tenant's row: the attacker's user_id with the victim's foreign key, and every later join reading a row its owner never wrote.
- **If it fails:** requireLocalRefs() checks truth_record_id and subject_id against OWNED rows, and workspace_id through buildWorkspaceCtx.

### 6. W13 — schema intelligence and trust & proof (0062)

#### D-01 — The schema/trust registry answers with the frozen vocabulary

⚠️ _File a bug; not a blocker._ Needs: token.

- **Before it can run:** A valid token. Read-only, safe on production.
- **Confirm by eye:** 🔴 `WebSite` must appear in excluded_types. The sitelinks-searchbox pattern is a WebSite block with url + potentialAction and no name — common AND correct — so including it would fire the ENTITY_SCHEMA_INVALID blocker across a large share of the healthy web.
- **If it fails:** The registry is frozen in schemaIntelligence.js/trustProof.js. A short list means this deploy predates W13.

#### D-02 — A page's JSON-LD scores, with per-component values

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** --allow-writes.
- **Confirm by eye:** Every WEIGHT is verbatim from the PRD and asserted by test (Schema = 0.30O + 0.30L + 0.20S + 0.10F + 0.10G). If the PRD differs, change the LABEL — never the weight, and never the id, which travels in stored rows and every historical diff.
- **If it fails:** A 500 means audit_schema_entities is absent; see P-02.

#### D-04 — Re-posting the same type UPDATES the row, never stacks a second

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** D-02, and --db-url or the GET count to compare.
- **Confirm by eye:** 🔴 audit_schema_entities answers “what does this page declare NOW”. Without the upsert a weekly crawler adds a row per run and every count doubles. Contrast with audit_subject_scores, which APPENDS on purpose — see F-04.
- **If it fails:** The arbiter must name columns. An expression index is not selectable by PostgREST's `on_conflict=` — that is 0058's defect, repaired by 0059.

#### D-05 — A declared FAQPage with no visible questions scores fidelity 0

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** --allow-writes.
- **Confirm by eye:** 🔴 This is the ONE score where MORE markup means a LOWER number, and it is deliberate: a declared FAQPage with nothing behind it is a machine-readable false statement, and it is what gets rich results revoked. `schemaGaps` must put this contradiction AHEAD of any absence.
- **If it fails:** If fidelity rewards the declaration, the model is rewarding the exact defect constructTemplates refuses to generate.

#### D-06 — Self-published material is CAPPED — volume does not buy a score

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** --allow-writes.
- **Confirm by eye:** 🔴 Ten unattributed testimonials on a page the business controls must never outscore one verifiable third-party record. A counting model is trivially gamed by the party being measured — and worse, it REWARDS the behaviour, so the number rises while the thing it measures falls.
- **If it fails:** The cap is a DERIVED fact, not a second guard: self_published's 0.25 weight bounds the score at 25. A `Math.min(best, 40)` that could never fire is the kind of redundant guard a test gets wrongly pinned to.

#### D-07 — ONE independent, verifiable record beats any quantity of self-published

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** D-06.
- **Confirm by eye:** 🔴 This is the whole point of the model. Confirm the number went UP substantially on the strength of a single sourced record.
- **If it fails:** trustProof.js scores every signal by INDEPENDENCE × VERIFIABILITY, saturating. If one sourced record does not beat ten unsourced ones, the model has become a counter.

#### D-09 — `independence` supplied in the request body is REFUSED

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** --allow-writes.
- **Confirm by eye:** Provenance is a claim about who holds the evidence. A claim the MEASURED PARTY can set is not a claim — the same defect as `?consented=true` and `acquisition: authorized_api`.
- **If it fails:** The route refuses the key outright; makeObservation() derives it from whether a checkable source URL is present. One place decides.

#### D-10 — Another tenant's subject_id on a schema/trust write is 404

🔴 **Stop-ship.** Needs: token, `--allow-writes`, 2nd account.

- **Before it can run:** DATIQ_TENANT_B_TOKEN and a subject id from the primary account (F-02 resolves one).
- **Confirm by eye:** 🔴 404, never 403.
- **If it fails:** requireSchemaTrustRefs() is the W13 equivalent of requireLocalRefs().

### 7. W14 — entitlement gating (0063) and revalidation

#### E-01 — On a FREE account every P2 write is refused with 402

🔴 **Stop-ship.** Needs: Free account.

- **Before it can run:** DATIQ_FREE_TOKEN — a token for an account on the Free plan.
- **Confirm by eye:** 🔴 W9 through W13 shipped UNGATED: every truth record, graph edge, directory listing and trust observation was writable on any plan including Free, and a 100% green gate proved nothing about it because nothing checked. Read one refusal and confirm it names the plan needed.
- **If it fails:** Each P2 route calls gateP2Capability() before any non-GET. A 201 here means the gate is missing from that route.

#### E-02 — On a FREE account the same records READ fine (200)

🔴 **Stop-ship.** Needs: Free account.

- **Before it can run:** DATIQ_FREE_TOKEN.
- **Confirm by eye:** 🔴 Writes are gated; reads are not. Refusing to show a customer the record they already own is TAKING AWAY something they were given, which is a different act from declining to create more.
- **If it fails:** gateP2Capability() must be called only for `method !== "GET"`. A 402 on a GET means the gate moved above the method check.

#### E-04 — A P2 write consumes no audit

⚠️ _File a bug; not a blocker._ Needs: token, `--allow-writes`.

- **Before it can run:** B-01/C-01/D-02 having written something this run.
- **Confirm by eye:** These make no provider call, so charging an audit would bill for work nobody did. Compare the account's audit count for the month before and after the run.
- **If it fails:** The P2 capabilities return ok(Infinity) — feature gating, not metering. If the count moves, one of them is routed through gateAuditQuota by mistake.

#### E-05 — Revalidation is accepted on an implemented recommendation

⚠️ _File a bug; not a blocker._ Needs: token, `--allow-writes`.

- **Before it can run:** A-01, and at least one recommendation on that audit.
- **Confirm by eye:** It records a REQUEST and charges nothing at request time. The run happens on the monitor's tick, where it is visible and countable.
- **If it fails:** A 409 NOT_IMPLEMENTED means the recommendation is not in implemented/done/validation_scheduled — mark it first.

#### E-06 — A second revalidation click is IDEMPOTENT — one claim, not two

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** E-05.
- **Confirm by eye:** 🔴 Clicking twice must not cost twice. Idempotency is by the `is.null` filter, not a read-then-write: two concurrent clicks produce one claim. A check-then-set races exactly as payment-webhook.js:49-59's dedup does, and losing that race costs a second PAID audit.
- **If it fails:** claimRevalidation() must PATCH with `revalidation_requested_at=is.null` in the filter. Any read-then-write is the bug.

#### E-07 — Requesting revalidation ran NO audit

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** E-05.
- **Confirm by eye:** 🔴 A re-audit is several fetches, a PageSpeed lookup, a citation sample and an AI call. An 'is this fixed yet?' control that silently spends one is the shape of thing a customer discovers on an invoice.
- **If it fails:** revalidateRoute must not call executeAudit. It records the request; the monitor's tick does the run.

#### E-08 — Revalidating a NOT-implemented recommendation is refused

⚠️ _File a bug; not a blocker._ Needs: token, `--allow-writes`.

- **Before it can run:** A-01 with at least two recommendations.
- **Confirm by eye:** Asking to revalidate an open item would spend an audit to confirm what the last one said. The refusal should say to mark it implemented first.
- **If it fails:** revalidateRoute gates on status ∈ {implemented, done, validation_scheduled} before the quota check.

### 8. W11 — subject scoring (0064)

#### F-01 — The registry names three scores and an `s`-series model version

🔴 **Stop-ship.** Needs: token.

- **Before it can run:** A valid token. Read-only, safe on production.
- **Confirm by eye:** 🔴 SUBJECT_MODEL_VERSION is an `s`-series, NEVER the page model's `v3`. BDS/PDS/SFS is a different formula moving for different reasons, and one number for both would make BOTH comparability claims false.
- **If it fails:** If it reads `v3`, the two model versions have been collapsed. Bump the `s` series when a WEIGHT moves — never when a component's SOURCE arrives.

#### F-02 — A scorable subject can be scored, with coverage and components

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** A brand / product / service subject on the account. 🔴 See the DEVIATION note this check emits — the API may have no way to make one.
- **Confirm by eye:** The response must carry the score, its coverage, and the component breakdown. A score without its coverage is not a smaller score, it is a DIFFERENT one.
- **If it fails:** If the only subjects on the account are `page` subjects, that is not a bug in this check — it is the gap it was written to find. See the plan's deviation register.

#### F-04 — Scoring the same subject twice APPENDS — the history is the product

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** F-02.
- **Confirm by eye:** 🔴 Every sibling table upserts and this one does not, deliberately. audit_schema_entities answers 'what does this page declare NOW'; audit_subject_scores answers 'what did this brand score on the 12th'. An arbiter here would silently collapse a subject's whole history into one row on every re-score.
- **If it fails:** 0064 has NO unique arbiter on (subject_id, code) and must never gain one. Two scorings on the same day are two MEASUREMENTS.

#### F-05 — A score with no components stores NULL, never 0

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** F-02.
- **Confirm by eye:** 🔴 A stored 0 would be indistinguishable, FOR EVER, from a subject that genuinely scored zero. Read the row: `score` must be literally NULL.
- **If it fails:** auditStore.saveSubjectScore sends `typeof result.score === "number" ? result.score : null`. Any `?? 0` or Number() coercion re-creates it — `Number(null)` is 0 and finite.

#### F-07 — A model_version supplied in the body is IGNORED

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** F-02.
- **Confirm by eye:** The model stamps its own version; a caller never supplies one — the 0048 rule, one layer up. A default or a caller-supplied value lets a writer file a future score under an old model, which is precisely the mislabelling the version exists to prevent.
- **If it fails:** scoreSubject() returns modelVersion: SUBJECT_MODEL_VERSION and the store writes that, never body.model_version.

#### F-09 — A `page` subject is REFUSED a brand score, naming the three scorable kinds

🔴 **Stop-ship.** Needs: token, `--allow-writes`.

- **Before it can run:** A-01, which mints a `page` subject.
- **Confirm by eye:** A row claiming a page has a BDS is a category error, refused in BOTH layers — the route and the CHECK — so they cannot disagree about who decides.
- **If it fails:** scoreIdFor() returns null for page/domain/location and the route must 400. If it 201s, the CHECK is the only thing left and the two layers now disagree.

#### F-11 — The score history reads back newest first

⚠️ _File a bug; not a blocker._ Needs: token.

- **Before it can run:** F-04.
- **Confirm by eye:** The trend is the product. Confirm the newest measurement is first and each row carries its own coverage.
- **If it fails:** listSubjectScores orders by scored_at.desc.

#### F-12 — Another tenant's subject_id is 404

🔴 **Stop-ship.** Needs: token, `--allow-writes`, 2nd account.

- **Before it can run:** DATIQ_TENANT_B_TOKEN and a subject on the primary account.
- **Confirm by eye:** 🔴 404, never 403.
- **If it fails:** requireSubjectScoreRefs() looks the subject up scoped to the caller.

### 9. Security — the checks worth doing with the public key alone

#### S-01 — Anonymous PostgREST cannot read any P2 table

🔴 **Stop-ship.** Needs: anon key.

- **Before it can run:** A Supabase URL and its PAIRED anon key for this environment. Read-only by construction — `select=id&limit=1` and nothing else.
- **Confirm by eye:** 🔴 A 200 with real row ids here is a live data leak, exploitable with a key that ships in the committed bundle. That is not theoretical: it was verified exploitable against staging once.
- **If it fails:** Each migration must `alter table ... enable row level security`, add a service_role-only policy, and `revoke all ... from anon, authenticated`. `grant all ... to anon` plus a policy reading `auth.uid() is null` is the 0041–0043 defect — auth.uid() IS null for anon, so the clause that reads like a dev convenience grants every row to exactly the caller it excludes.

#### S-02 — The ten SECURITY DEFINER RPCs are unreachable anonymously (0061)

🔴 **Stop-ship.** Needs: anon key.

- **Before it can run:** A Supabase URL and anon key.
- **Confirm by eye:** 🔴 `revoke ... from public` is the load-bearing clause. 0012 wrote `revoke execute ... from anon` and nothing else — a NO-OP, because the default PUBLIC grant remained and anon inherits it. So claim_billing_session was anon-reachable from 0012 until 0061, behind a line that reads as though it were not.
- **If it fails:** Apply 0061. Each function needs `revoke all ... from public, anon, authenticated` AND an explicit `grant execute ... to service_role` — never relying on Supabase's ALTER DEFAULT PRIVILEGES, which is true on a stock project and false on a restored dump.

#### S-05 — Every cross-tenant probe returned 404, never 403

🔴 **Stop-ship.** Needs: nothing extra.

- **Before it can run:** The cross-tenant checks (B-10, C-09, D-10, F-12) having run.
- **Confirm by eye:** 🔴 A 403 confirms the row exists and makes the endpoint an enumeration oracle over other tenants' uuids. This aggregates the four probes so a single 403 anywhere is visible.
- **If it fails:** Look the parent row up SCOPED TO THE CALLER and return notFound() when it is absent — never a global read followed by an ownership comparison.

### 10. Database-level confirmations (need --db-url)

#### D-03 — audit_schema_entities actually holds rows

🔴 **Stop-ship.** Needs: `--db-url`.

- **Before it can run:** --db-url, and D-02 having run against this database.
- **Confirm by eye:** A read path returns null identically for 'no observation' and 'nobody ever wrote here'. Only the storage layer tells them apart — which is why four columns in this schema were declared, reviewed, merged and written by nothing.
- **If it fails:** The schema POST loops `store.saveSchemaEntity` per block and reports `persisted`. A `persisted: 0` alongside a 201 is the signal.

#### F-06 — A stored unmeasurable score is LITERALLY NULL in the column

🔴 **Stop-ship.** Needs: `--db-url`.

- **Before it can run:** --db-url, and F-05 having run against this database.
- **Confirm by eye:** 🔴 The unrecoverable one. Read it yourself: `select score, coverage from audit_subject_scores order by scored_at desc limit 5;`. A 0 where a NULL belongs cannot be distinguished later from a subject that genuinely scored zero.
- **If it fails:** saveSubjectScore must send null, and the column must stay NULLABLE (P-03).

---

## 11. What the runner cannot do

Listed rather than quietly omitted — a coverage claim that leaves out what
it does not cover is the same defect as `coverageClaim()`s forbidden flat
sentence, one level up.

| # | What | Why it is not automated |
|---|---|---|
| A-02v | An unmeasured signal RENDERS muted, not as a red zero | The runner sees `score: null` and cannot see a colour. --dsc-muted and --dsc-danger are the same null to it. |
| A-06p | The PDF export carries scores, evidence, and a THIN stamp below 70 coverage | No headless renderer here. A PDF is forwarded to clients and read months later, so look at one. |
| B-03 | An approved truth record raises BT-01/BT-02 on a contradicting page | Needs a second account to approve, sharing the workspace, then an audit of a page on that domain. Set up once by hand. |
| C-03 | Rd/Road and +91/0 phone equivalence | Folded into C-02, which asserts all three normalisation families at once. |
| C-06 | A source that never publishes a field reads `not_published`, not `absent` | Needs a real listing from a source with a partial field set (G2 shows a name and nothing else). `not_published` is our knowledge of the format; `absent` is the source leaving a field blank — only the second is actionable. |
| D-08 | An unsourced third-party claim is refused by the database CHECK | 🔴 UNREACHABLE THROUGH THE ROUTE, and that is correct: the route refuses `independence` from the body outright (D-09), so the CHECK can only be exercised in SQL. db-verify covers it. |
| D-11 | trust_credibility reads as measured rather than blockedBy:[W13] | Needs a scorable subject — see DEV-01. Blocked for the same reason F-02 is. |
| E-03 | The same writes succeed on Select or above | Proved by B-01, C-01 and D-02 running green on a Select+ token; there is no separate assertion to make. |
| E-09 | Revalidation is allowed on Free while quota remains | Needs a Free account with audits left — gated on QUOTA, not a feature flag. |
| E-10 | Revalidation is 402 once the audit quota is exhausted | Needs an account with the month's quota spent. Deliberately not automated: draining a real quota is an expensive way to test a boundary. |
| F-08 | A `kind` supplied in the body is ignored | Folded into F-07, which sends both model_version and kind in one probe. |
| F-10 | A one-component score reports thin:true with missing_facts | Reported in F-02's detail line; read it there. |
| S-03 | credit_spend, request_account_deletion, credit_balance refused anonymously | Folded into S-02, which sweeps all ten functions. |
| S-04 | claim_billing_session still works for a signed-in user | Calling it consumes a real billing session, so it is verified by one real test purchase after 0061 reaches an environment. It is the one correct exception among the ten: it derives auth.uid() itself rather than taking a caller-supplied p_user_id. If purchases stop activating after 0061, the `grant execute ... to service_role` on it is missing — the revoke landed and the grant did not. |
