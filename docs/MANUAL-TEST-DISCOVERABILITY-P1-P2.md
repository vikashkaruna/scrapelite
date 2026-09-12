# Manual test — Discoverability P1 + P2 (W1–W14)

> **Written 2026-09-12**, against `Discoverability-P1-P3-implementation`.
> Covers everything P1 (W1–W8) and P2 (W9–W14) added, including the five
> migrations applied since the last release: `0060`, `0061`, `0062`, `0063`,
> `0064`.
>
> **Run it three times, in this order: branch → staging → production.**
> Each environment answers a different question, and passing on one does not
> answer for the next. §1 says why.
>
> **Scope.** Only what CI cannot assert: things needing a real session, a real
> database, real third-party traffic, a real clock, or a populated account.
> Everything else is already covered by 391 test files / 6 530 tests, db-verify
> (64 migrations / 791 assertions), referral 17 and workflows 56. **Do not
> re-do here what those already prove** — a manual pass that repeats CI wastes
> the one thing manual testing is for.
>
> **Companions.** [`POST-DEPLOYMENT-MANUAL-TEST.md`](POST-DEPLOYMENT-MANUAL-TEST.md)
> (workflow pipeline) · [`DB-MIGRATION-RUNBOOK.md`](DB-MIGRATION-RUNBOOK.md)
> (§4b–§4e, the apply procedures) ·
> [`DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md`](DISCOVERABILITY-P1-P2-IMPLEMENTATION-PLAN.md)
> (what each workstream shipped and why).

---

## 0. How to record a result

Every row is **PASS / FAIL / BLOCKED / N-A**, with evidence: a timestamp, a row
id, a response body, or a screenshot. **A blank is not a pass.**

A row marked 🔴 is a **stop-ship**: it does not go to the next environment until
it passes. A row marked ⚠️ is a bug to file, not a blocker.

🔴 **Never infer a deploy from a 200.** A SPA catch-all answers a missing asset
with `index.html` at status 200, and the browser then silently refuses the HTML
as a module script — so "everything returns 200" is compatible with React never
booting. Check the asset hash and the `content-type`:

```bash
curl -s https://<host>/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'
curl -sI https://<host>/assets/index-<hash>.js | grep -i content-type
# must read application/javascript — text/html means the asset is not there
```

---

## 1. The three environments answer different questions

| | Branch deploy | Staging | Production |
|---|---|---|---|
| **Question it answers** | Does the code work at all against a real Postgres, real PostgREST and a real session? | Does it work against the data and config a real tenant has? | Does it work for customers, under real traffic and real money? |
| **Database** | dev/stage Supabase (`aubwooslkkrprdxuiyvj`) | same dev/stage project | 🔴 **production Supabase — a different project** |
| **Migrations `0060`–`0064`** | ✅ applied (owner-confirmed 2026-09-12) | ✅ applied | 🔴 **NOT applied. Apply before deploying.** |
| **Host** | PR preview URL (previews bypass `allowed_branches`) | `https://staging--datiqapp.netlify.app` — 401-gated by Netlify edge access, needs a logged-in Netlify session | `https://datiq.app` |

🔴 **The single most important row in this table is the migration row.**
`0060`–`0064` are on dev/stage and **not** on production. Deploying this branch
to production without applying them first gives every P2 endpoint a table that
does not exist — a 500 on a feature that tested clean twice.
[`DB-MIGRATION-RUNBOOK.md` §4d and §4e](DB-MIGRATION-RUNBOOK.md) are the
procedures. **§4d (`0061`) is a security fix and should not wait on a feature
release to carry it.**

⚠️ **Netlify injects Function env vars at DEPLOY time.** A variable changed in
the UI reaches no function until that context redeploys.

---

## 2. Pre-flight — five minutes, and it saves an afternoon

| # | Check | Expected | Result |
|---|---|---|---|
| P-01 | 🔴 Confirm which commit is actually deployed | The asset hash matches the deploy log — not merely a 200 | |
| P-02 | 🔴 Confirm the migrations are on THIS environment's database | `select count(*) from information_schema.tables where table_schema='public' and table_name in ('audit_schema_entities','audit_trust_evidence','audit_subject_scores');` → **3** | |
| P-03 | Confirm the score columns are the right nullability | `select column_name, is_nullable from information_schema.columns where table_name='audit_subject_scores' and column_name in ('score','coverage','model_version');` → score **YES**, coverage **NO**, model_version **NO** | |
| P-04 | Confirm RLS is on the three new tables | `select relname, relrowsecurity from pg_class where relname in ('audit_schema_entities','audit_trust_evidence','audit_subject_scores');` → all **t** | |
| P-05 | 🔴 Confirm the RPC lockdown actually landed (`0061`) | `npm run verify:rls` (add `-- --prod` for production) → **15/15 HTTP 401** | |
| P-06 | Sign in as a real account and note its plan | You need **Select or above** for §6; Free is correct for the refusal tests | |

🔴 **P-03 is worth doing by hand even though db-verify asserts it.** If `score`
came back `NOT NULL`, an unmeasurable subject would be stored as a real zero —
and that is unrecoverable after the fact, because nothing distinguishes it from
a subject that genuinely scored zero.

---

## 3. P1 regression — the parts a real database changes

P1 shipped long ago; this section only re-checks what the new migrations could
plausibly have disturbed.

| # | Check | Expected | Result |
|---|---|---|---|
| A-01 | Run an audit on a real URL you own | Completes; four pillar scores; `coverage` shown beside the score | |
| A-02 | 🔴 An unmeasured signal reads as unmeasured, never as 0 | The UI shows it muted/“not measured”, **not** a red zero, and coverage drops | |
| A-03 | Re-audit the same URL, then open the comparison | A diff with deltas; the issue list names what resolved | |
| A-04 | Audit a DIFFERENT page on the same site, then try to compare the two | 🔴 **Refused as incomparable, with a stated cause** — not a confident number. This is D7's `sameSubject()` gate | |
| A-05 | Open an audit from History (not a fresh run) | Signal names, coverage and weights all render — identical to the fresh view | |
| A-06 | Export the audit as PDF | Scores, signals and evidence present; a sub-70-coverage audit is stamped **THIN** | |
| A-07 | Export as CSV with `rows=signals` | An unmeasured signal exports **BLANK**, never `0` | |
| A-08 | Audit a URL whose robots.txt disallows us | A clear refusal naming robots.txt — **not** “Something went wrong” and no stack trace | |
| A-09 | ⚠️ Confirm the refusal in A-08 cost nothing | Usage count unchanged; no audit row created | |

---

## 4. W9–W10 — truth record and entity graph

| # | Check | Expected | Result |
|---|---|---|---|
| B-01 | Create a business truth record; fill `legal_name` + `canonical_domain` | Saves | |
| B-02 | 🔴 Try to approve your own draft version | **Refused** — self-approval is blocked in three places | |
| B-03 | Have a second account approve it, then audit a page on that domain | A `BT-01`/`BT-02` conflict appears where the page contradicts or omits a recorded fact | |
| B-04 | 🔴 Confirm the conflict row was actually WRITTEN | `select count(*) from audit_business_truth_conflicts where user_id = '<you>';` → **> 0**. This table's whole point is that it is not the fourth declared-and-never-written one | |
| B-05 | Create two entities and an edge between them | Saves | |
| B-06 | 🔴 Try to create the SAME edge twice | **409**, and the body carries `corroborated` — re-observing corroborates, it does not duplicate | |
| B-07 | 🔴 Confirm the corroboration was written | `select count(*) from audit_entity_evidence where user_id = '<you>';` → **> 0** | |
| B-08 | Try a self-edge (A → A) | Refused | |
| B-09 | Approve an edge between two unreviewed nodes | Both endpoints become approved in the same action | |
| B-10 | 🔴 Reference another tenant's entity id in an edge | **404, never 403** — a 403 confirms the row exists and makes the endpoint an enumeration oracle | |

---

## 5. W12 — local and directory intelligence

| # | Check | Expected | Result |
|---|---|---|---|
| C-01 | 🔴 Save a directory listing | **It saves.** This is the `0059` fix: the arbiter must name columns, not an expression, or every save is refused | |
| C-02 | Run a local check with a name differing only by “Pvt Ltd” vs “Private Limited” | Reported as a **match**, not a mismatch | |
| C-03 | Same for “Rd” vs “Road”, and `+91 80 4718 2200` vs `08047182200` | Both **match** | |
| C-04 | A registry (MCA) address differing from the shopfront | Reported as **`LD-05`**, low severity — **not** a NAP mismatch | |
| C-05 | 🔴 A source you have not authorised | **Excluded and named**, never scored 0 | |
| C-06 | A source that never publishes a field (e.g. G2 beyond name) | Field excluded as `not_published`, distinct from `absent` | |
| C-07 | 🔴 Read the coverage sentence | It must NOT say a flat “N directories audited” — false for every customer who authorised nothing | |
| C-08 | 🔴 POST a listing with `acquisition: "authorized_api"` in the body | **Refused** — fidelity is not a flag a client can set | |
| C-09 | 🔴 Attach a listing to another tenant's `truth_record_id` | **404** | |

---

## 6. W13 — schema intelligence and trust & proof (`0062`)

| # | Check | Expected | Result |
|---|---|---|---|
| D-01 | `GET /api/discoverability/schema-trust/schema-registry` | Eight approved types; `WebSite` in `excluded_types`; six TC components | |
| D-02 | POST a page's JSON-LD to `/schema-trust/schema` | A schema score with per-component values | |
| D-03 | 🔴 Confirm it was WRITTEN | `select count(*) from audit_schema_entities where user_id='<you>';` → **> 0** | |
| D-04 | 🔴 Re-POST the same type for the same subject | **Updates the row, does not stack a second one.** Count unchanged | |
| D-05 | 🔴 Declare a `FAQPage` with **no** visible questions | `fidelity` scores **0 — below having none**. More markup giving a lower number is correct here: it is a machine-readable false statement | |
| D-06 | Record ten self-published testimonials | Trust score **capped at 25** | |
| D-07 | 🔴 Record ONE independent, verifiable third-party record | Scores **60** — it beats any quantity of self-published material. This is the whole point of the model | |
| D-08 | 🔴 POST `independence: "third_party"` with **no** `source_url` | **Refused** — by the database CHECK, not just the route | |
| D-09 | 🔴 Try to set `independence` from the request body on a path that resolves it | The server's own resolution wins; a client cannot claim provenance | |
| D-10 | Reference another tenant's `subject_id` | **404** | |
| D-11 | Read a brand score after recording trust data | `trust_credibility` is now **measured**, not `blockedBy: ["W13"]` | |

---

## 7. W14 — entitlement gating and revalidation (`0063`)

🔴 **This is the section that did not exist before.** W9 through W13 shipped
with **no entitlement check of any kind** — every truth record, graph edge,
directory listing and trust observation was writable on any plan including
Free. Test both directions.

| # | Check | Expected | Result |
|---|---|---|---|
| E-01 | 🔴 On a **Free** account, POST a truth record / entity / listing / trust observation | **402**, naming the plan needed | |
| E-02 | 🔴 On a **Free** account, GET those same records | **200.** Writes are gated; reads are not — refusing to show a customer the record they already own is taking away something they were given | |
| E-03 | On **Select or above**, the same writes | Succeed | |
| E-04 | ⚠️ Confirm the write did not consume an audit | Audit count unchanged — these make no provider call, so charging one would bill for work nobody did | |
| E-05 | Mark a recommendation `implemented`, then request revalidation | Accepted; `revalidation_requested_at` set | |
| E-06 | 🔴 Click revalidate a SECOND time | **Idempotent — one claim, not two.** Clicking twice must not cost twice | |
| E-07 | 🔴 Confirm no audit ran | No new audit row. It records a REQUEST; the run happens on the monitor's tick | |
| E-08 | Request revalidation on a recommendation that is NOT implemented | Refused, saying to mark it implemented first | |
| E-09 | On a Free account (3 audits) with quota remaining, request revalidation | **Allowed** — it is gated on quota, not a feature flag | |
| E-10 | Exhaust the audit quota, then request revalidation | **402** | |

---

## 8. W11 — subject scoring (`0064`)

| # | Check | Expected | Result |
|---|---|---|---|
| F-01 | `GET /api/discoverability/subject-score/registry` | Three scores (BDS/PDS/SFS); `model_version` matches `^s\d+$` — **an `s`-series, never the page model's `v3`** | |
| F-02 | Create a `brand` subject, POST component values | **201**, with a score, coverage and the component breakdown | |
| F-03 | 🔴 Confirm it was WRITTEN | `select count(*) from audit_subject_scores where subject_id='<id>';` → **1** | |
| F-04 | 🔴 Score the SAME subject again | **Count becomes 2 — it APPENDS.** The trend is the product; an upsert here would collapse the whole history into one row | |
| F-05 | 🔴 POST with **no** component values | Stored `score` is **NULL**, coverage 0 — never a zero | |
| F-06 | Verify in the database | `select score, coverage from audit_subject_scores where ...` → `score` literally NULL | |
| F-07 | POST with a `model_version` of your own in the body | **Ignored** — the model stamps its own | |
| F-08 | POST with a `kind` of your own in the body | **Ignored** — the kind comes from the stored subject | |
| F-09 | 🔴 Score a subject whose kind is `page`, `domain` or `location` | **400**, naming the three scorable kinds. A page has no BDS; that is a category error | |
| F-10 | Score with only one component supplied | Response carries `thin: true` and a `missing_facts` breakdown | |
| F-11 | `GET /subject-score/scores?subject_id=<id>` | History, newest first | |
| F-12 | Reference another tenant's subject | **404** | |

---

## 9. Security — the checks worth doing by hand

| # | Check | Expected | Result |
|---|---|---|---|
| S-01 | 🔴 With **only the public anon key**, no Authorization header, try to read each new table via PostgREST | **401 on all three.** `npm run verify:rls` automates the Phase 4-6 set; do these three by hand | |
| S-02 | 🔴 With only the anon key, call `POST /rest/v1/rpc/set_account_frozen` with someone else's `p_user_id` | **Refused.** This is `0061` — ten such functions were impersonation primitives reachable with the committed key | |
| S-03 | 🔴 Repeat S-02 for `credit_spend`, `request_account_deletion`, `credit_balance` | All refused | |
| S-04 | Confirm `claim_billing_session` still works for a signed-in user | Works — it is the one correct exception, deriving `auth.uid()` itself | |
| S-05 | 🔴 Every cross-tenant probe in §4–§8 returned **404, never 403** | Confirmed | |

---

## 10. Sign-off

| Environment | Date | Tester | P1 §3 | W9-10 §4 | W12 §5 | W13 §6 | W14 §7 | W11 §8 | Security §9 | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Branch | | | | | | | | | | |
| Staging | | | | | | | | | | |
| Production | | | | | | | | | | |

**Production is not signed off until `0060`–`0064` are applied there and §2 P-02
passes against the production database.**

---

## 11. Known limits of this document

- **No P2 feature has a UI yet.** §4–§8 are API-level checks (curl, or the
  browser network tab). The storage and the contracts exist; screens do not.
  That is the deliberate state recorded in the plan, not an omission here.
- **Nothing in P2 has been exercised against a live third-party engine.** The
  citation and PageSpeed paths are P1's and unchanged.
- **`0062`–`0064` had met only WASM Postgres before this pass.** Dev/stage is
  the first real database they have touched, which is exactly what §2 checks.
