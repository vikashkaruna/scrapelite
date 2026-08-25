# Discoverability module — architecture and operating notes

> **Internal.** Never summarise into `public/help/` or any customer-facing surface.
> The external guide is `docs/DatIQ-User-Guide.md` §11; the public API contract is
> `docs/DatIQ-Developer-API.md`.

The SEO / AEO / GEO audit engine. Takes a URL, returns four pillar scores, three
framework views, a prioritised recommendation queue and copy-ready
implementation constructs.

---

## 1. The three rules

Everything below follows from these. Break one and the module stops being
trustworthy, which for a measurement product is the same as stopping working.

### 1.1 `unknown` is never `0`

A signal can be missing for two innocent reasons: it could not be **measured**
(PageSpeed rate-limited, no citation-sampling engine configured), or it does not
**apply** (a pricing page has no procedure, so no HowTo markup).

Either way it is **excluded** from its pillar and its weight is **redistributed**
across the signals that were measured. `weightedMean()` in
`src/lib/discoverability/scoringModel.js` is the one function that implements
this, and every score in the product flows through it.

Scoring a missing signal as 0 would subtract ~7.5 points from every audit during
a PageSpeed outage, then show a phantom "+7.5 improvement" when it recovered —
which makes the trend line, the entire point of the validation loop, a fiction.

Every score therefore carries `coverage`: the share of intended evidence
actually gathered. Coverage is **signal-level and framework-weighted**, so a
missing technical signal costs the tech-heavy SEO view more coverage than the
answer-heavy AEO view.

### 1.2 A profile is a lens, not different maths

All four framework views are ALWAYS computed with identical weightings. The
`audit_profile` only selects which one leads the report.

Re-weighting per profile would mean the same page scoring differently depending
on which profile it was run under, and a user who switched profiles between runs
would see a change in their trend that no change to their page caused.

### 1.3 Constructs use placeholders, never inventions

Anything the audit could not observe is emitted as an explicit `TODO:`. A
generated Organization block with a hallucinated founder name is worse than no
block at all, because these are pasted into live sites and tend to be published
without being read.

`hasPlaceholders()` drives the "needs your details" badge in the UI.

---

## 2. Layout

```
src/lib/discoverability/          PURE. Imported by BOTH React and netlify/,
                                  exactly like entitlementModel.js — the score a
                                  user sees and the score the server stored are
                                  computed by the same lines.
  signalRegistry.js               20 signals, 4 pillars, weights summing to 1
  scoringModel.js                 pillar/framework maths, penalty layer, bands
  signalScorers.js                the individual curves
  issueCatalog.js                 44 issue codes → severity, owner, fix, penalty
  recommendationModel.js          priority formula, per-page lift, ranking
  constructTemplates.js           13 generators for ready-made assets
  auditProfiles.js                4 profiles (lenses) + 8 page-type rule packs
  auditDiff.js                    two audits → deltas, with comparability
  auditReport.js                  markdown / CSV / JSON renderings
  auditUrl.js                     canonical target identity
  discoverabilityClient.js        browser → /api/discoverability/*

netlify/functions/lib/audit/      Server only.
  htmlParse.js                    hand-rolled parsing (no DOM in a function)
  fetchLayer.js                   raw + rendered fetch, robots, canonical
  answerAnalysis.js               ┐
  structureAnalysis.js            ├ the four pillar analysers
  entityAnalysis.js               │
  technicalAnalysis.js            ┘
  webVitals.js                    PageSpeed Insights adapter
  citationSampling.js             Perplexity | AI-chain, pluggable
  aiEvaluator.js                  optional LLM refinement, always degradable
  auditPipeline.js                the 7 stages
  auditStore.js                   Supabase persistence
  webhookDispatch.js              HMAC-signed delivery

netlify/functions/
  discoverability.js              the API router
  discoverability-monitor.js      @daily scheduled monitoring

supabase/migrations/0030_discoverability_audits.sql
src/pages/Discoverability.jsx
src/components/discoverability/*.jsx
```

---

## 3. Gate order in `discoverability.js`

```
auth → idempotency → quota CHECK → SSRF → compliance → rate limit
     → audit row (the CHARGE) → run → persist → webhook
```

**The distinction that matters is CHECKING the quota versus SPENDING it.** The
check is free and side-effect-free, so it runs early — somebody over their limit
is told immediately rather than after we have fetched their robots.txt.

The **charge is the audit row itself**. Audits are counted from the `audits`
table (`status != 'failed'`, current month); there is no counter column,
deliberately, because a counter that drifts from the rows it counts eventually
bills somebody for work that is not there.

A request refused for SSRF, robots.txt or the operator host allowlist creates no
row and costs nothing. This mirrors `extract.js`, where `consumeGuestCredit`
once ran before the compliance check and a guest pasting three disallowed
LinkedIn URLs was charged three times for work never done.

**Compliance applies to audits.** It is tempting to exempt them — the point of
`TA-01` is to REPORT that crawlers are blocked — but we fetch and read the page
either way, and `/blog` advertises that we honour robots.txt. The recorded
per-host attestation (`lib/scrapeConsent.js`) is the escape hatch.

---

## 3b. Dependencies — the fix that cannot pay off yet

The BRD lists **dependency** as a required field on every recommendation, and
`BLOCKER_GATES` in `recommendationModel.js` is why it matters rather than being
bookkeeping.

On a page whose content only exists after JavaScript runs, adding an answer-first
block helps no non-rendering crawler at all — the new passage is as invisible as
everything else until the page is server-rendered. The lift is real, but it is
**not realisable** while the blocker stands.

So a gated recommendation is marked `blockedBy` and sorts below the work that
unblocks it, regardless of its own score. The UI says so on the row, and the
panel reports `estimatedUnblockedLift` beside the total — presenting only the
total on a blocked page promises work that cannot pay off yet.

Only blockers that genuinely gate downstream work are listed. A broken canonical
is critical and gates nothing, so it is absent. And the gate is per-PILLAR, not
blanket: `EA-01` (add Organization JSON-LD) stays unblocked on a shell page,
because JSON-LD lives in the `<head>` — which a non-rendering crawler does read.
Gating it would discourage work that pays off immediately.

**This is also why the queue's top item is not always the blocker.** A cheap,
certain, genuinely-effective fix can legitimately come first: a team can add
schema this afternoon while re-platforming takes a sprint. What the dependency
guarantees is narrower and more important — nothing that *depends* on the
blocker outranks it.

---

## 4. Failure modes, and which way each fails

| Condition | Behaviour | Why |
|---|---|---|
| Quota lookup degraded | **OPEN** — audit runs | Same asymmetry as `requireEntitlement`. A Supabase blip must not take auditing down. |
| Entitlement explicitly over quota | **CLOSED** — 402 | An explicitly-read state is an answer. |
| PageSpeed unavailable | signal `null`, weight redistributed | Rule 1.1. |
| No citation engine configured | signal `null` | An unsampled brand is unknown, never uncited. |
| AI evaluator unavailable | deterministic pre-screen stands | The audit must never depend on a model being up. |
| Scrape chain throws | audit completes on the raw fetch | Losing 19 signals to one provider is worse than a thin audit. |
| Page unreachable | `status: completed`, `unreachable: true` | The technical facts gathered are exactly what the user needs. |
| Persist fails after the run | result returned, `persisted: false` | The work was done and charged for; discarding it is worse. Saying nothing is worse still. |
| Webhook endpoint down | recorded on the row | Never fails an audit that already ran. |
| robots.txt unreadable | `TA-16`, crawler access `unknown` | Not a block. "Not checked is never down." |

---

## 5. Operating

### Environment

All optional; every one degrades to a smaller audit rather than a failure.

| Variable | Effect if unset |
|---|---|
| `PAGESPEED_API_KEY` | PSI still works keyless at low volume; on exhaustion CWV reads `not measured` |
| `DISABLE_PAGESPEED=1` | CWV never attempted |
| `PERPLEXITY_API_KEY` | Citation sampling falls back to the AI chain, flagged `live: false` in the UI |
| `PERPLEXITY_MODEL` | defaults to `sonar` |
| `DISABLE_AI_CITATION_SAMPLING=1` | Citation footprint reads `not measured` |
| `DISABLE_AUDIT_AI=1` | `passage_independence` uses the deterministic pre-screen only |
| `FIRECRAWL_API_KEY` / `SPIDER_API_KEY` | Without either, render completeness reads `not measured` — the two fetches would be identical and comparing them a tautology |

### Cron

`discoverability-monitor` is `@daily`, declared in **`netlify.toml`** and
registered in **`AUTOMATION_JOBS`**. Both are required and
`netlify/__tests__/audit/cron-registry-parity.test.js` asserts they agree — the
check that would have caught the R19 incident where every cron sat unscheduled
for months with no error anywhere.

Netlify runs scheduled functions for the **production deploy only**. A branch
deploy returning 200 on the endpoint proves nothing.

### Retention

`prune_audit_history(days)` deletes completed audits older than `days`
(30-day floor), skipping any that are a baseline, a benchmark member, or a
schedule's last run — pruning those would turn a working comparison into a
dangling reference.

**`audit_events` is never pruned.** A retention job that erases the record of a
deletion is what an audit trail exists to prevent. Nothing calls
`prune_audit_history` yet; wire it when volume justifies it.

---

## 6. Things that will bite

- **A fragment must never displace a document.** The scrape chain's later
  providers do not return HTML. Jina returns markdown, which `scrapeProviders.js`
  converts to a shell of headings and links — no `<head>`, so no meta, no
  canonical, no JSON-LD. Parsing that as the page made the engine report "no
  viewport meta tag" on a page whose first meta tag is a viewport. A whole
  pillar of phantom findings, delivered with total confidence, which is the
  worst failure an audit tool has. `looksLikeFullDocument()` gates the choice
  and `headSignalsReliable` turns the remaining blind spot into *unmeasured*
  rather than a measured absence. **This was found by running the engine against
  a live page, not by a test.** Mocks agreed with each other.

- **A JavaScript shell is named as one.** `looksLikeJsShell()` recognises a real
  document that defers its content, so the engine raises `TA-07` ("your content
  is JavaScript-only") instead of the content analysers each reporting their own
  half of it as "no H1", "no answer passage", "no headings". An author whose H1
  is plainly visible in their browser reads the latter and concludes the tool is
  broken.

- **Signal and issue codes are a public contract.** They travel in the JSON
  payload, in webhook bodies, in stored rows and in every historical diff.
  "AC-02 was resolved" is only true if AC-02 still means what it meant when the
  baseline was taken. Add codes; never repurpose or renumber one.

- **The weight tables are pinned by tests.** Rebalancing is allowed; forgetting
  to rebalance so a pillar no longer sums to 1.0 fails the build, because
  otherwise it would silently rescale every user's historical score.

- **Help page numbers shift.** `public/help/NN-slug.html` is derived from the
  `## N.` headings in the user guide. Inserting a section renumbers everything
  after it. The six pages that shifted when Discoverability became §11 have
  permanent redirects in `scripts/site-routes.mjs` (mirrored into
  `netlify.toml`, asserted by `page-ownership.test.mjs`). Resolve help pages by
  **slug**, never by number — the readiness audit learned this the hard way.

- **`/discoverability` is a private prefix.** It must stay in sync across four
  places: `PRIVATE_PREFIXES` in `scripts/site-routes.mjs`, the `X-Robots-Tag`
  header in `netlify.toml`, `public/robots.txt`, and the inline guard in
  `index.html`. `page-ownership.test.mjs` asserts all four.

- **`_apiKeyUserId` is in-process only.** It is how `api-v1.js` passes an
  API-key-resolved user into the shared handler. It cannot arrive over the
  network, and a test proves it cannot be forged through a header, a query
  param or the body. Do not read it from anywhere else.

- **`PERMITTED_HOSTS` is EXCLUSIVE.** Setting it blocks every host not listed,
  for audits as well as extraction.

---

## 7. Deliberately not built

- **Automatic publishing of fixes.** Out of scope in the BRD and it should stay
  that way. DatIQ generates the construct; a human decides to publish it.
- **A ranking or traffic prediction.** An explicit non-goal. Every surface —
  report footer, UI, blog post, help section — says the scores describe how
  discoverable a page is today and predict nothing.
- **Workspaces.** The PRD schema has a `workspaces` table; DatIQ does not.
  Every table carries a nullable `workspace_id` reserved for when team
  workspaces ship, so the column can be back-filled without a second migration.
- **A separate auth system.** The PRD specifies `/api/v1/auth/login`. DatIQ has
  Supabase auth. Building a second identity system beside the real one is how an
  app ends up with two answers to "who is this?" and the wrong one gating access.

---

## 8. Phase mapping

| PRD phase | Shipped |
|---|---|
| **1** — single URL audit, four-pillar scoring, framework outputs, JSON results, recommendations, dashboard | ✅ |
| **2** — historical comparison and trends, prompt-set citation sampling, multi-URL benchmarks, markdown/CSV/JSON export, webhooks | ✅ |
| **3** — template-level audits (page-type rule packs), scheduled monitoring, persona-tuned recommendations (owner-filtered queue), competitive and citation intelligence | ✅ |

Workspace-level rollups are the one Phase 3 item deferred, and deliberately:
they need the workspaces table that does not yet exist. The nullable
`workspace_id` columns are the hook.
