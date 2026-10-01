# Session Handoff — 2026-09-30 — Credit calibration: template double-billing fixed + estimate/charge recalibrated

> Branch `docker-desktop-build` only. Nothing merged to staging/main by this session.
> Scope: credit-usage audit across templates, extraction+enrichments, discoverability, workflows/bulk/monitors — with the new EXTRACT_BUDGET_MS/AI_BUDGET_MS and the Customize inputs now actually reaching the runs.

---

## TL;DR

The user asked how credits are calculated for template runs (especially with the new
`custom_fields` / `extra_subpages` / `ai_depth` inputs and the raised budgets), whether the
budget changes skewed billing, and whether recalibration is needed across environments.

**Found and fixed: template runs were DOUBLE-BILLED.** Every template run's page fetches and
AI calls were charged twice — once by the `/api/extract` + `/api/ai` choke-point meters
(caller `extract` / `api-ai`, `run_id` NULL) and once again by the run's own finish events
(`run_id: trun_*`). Verified empirically in the local ledger: one run carried
`5 + 5 + 1` credits from the choke points AND `4 + 1` credits from its events against an
8-credit quote (~3–4× the quote in practice). The budgets never changed any *rate* — they
changed how much work *completes*, which made the double-charge more visible (more synthesis
calls now land instead of dying at the old 8s deadline).

**Recalibrated estimate + charge to the same tier-honest model** (all environments,
code-level, no env vars involved).

---

## How credits are actually calculated (the answer)

One price list: `src/lib/credits/creditWeights.js` (page_fetch 1, ai_fast 2, ai_deep 5,
pagespeed 1, citation_prompt_extra 2, …). Two ways it gets written to `credit_ledger`:

1. **Choke-point meters** (`runChain`, `runScrapeChain`, `fetchWebVitals`, `sampleCitations`
   via `netlify/functions/lib/creditMeter.js`) — meter EVERY `/api/extract` and `/api/ai`
   request against the verified user. This is how Home/Preview extractions, enrichments,
   batch rows, monitoring and discoverability audits are charged (single charge, from
   actuals; failed/cached/skipped calls write nothing).
2. **Template finish events** — a template run accumulates events client-side
   (`templatesClient.js`: pages read, AI calls landed) and `templates.js {action:"finish"}`
   collapses them via `toLedgerEntries` → `chargeLedger`, attributing them to the run and
   reconciling them against the pre-run estimate (`reconcile()`, overrun tolerance 25%).

The design docs give templates.js sole ownership of the ledger for template runs — but the
choke points were never told, hence the double-charge.

### What the budgets actually did

`EXTRACT_BUDGET_MS=45000` / `AI_BUDGET_MS=30000` change no prices. They let more of a run
*finish* (more related pages read → more page events; more synthesis calls land instead of
`ai_budget_exhausted`). Charging follows actuals, so heavier inputs legitimately cost more —
the defect was that the same work was billed twice AND quoted at the wrong tier.

## The fixes (this session)

1. **Single-charge for template traffic** — `templatesClient.js` stamps
   `meterScope: "template_run"` on every `/api/extract` + `/api/ai` call it makes;
   `extract.js` / `ai.js` build a **suppressed** meter context for those requests
   (`creditMeter.meterContext({suppressed})` → `record()` buffers nothing, `flush()` writes
   nothing). Every other surface still meters at the choke points.
2. **Tier-honest charging** — the synthesis/extraction areas ship on the DEEP tier
   (frontier models), but client events priced every call at `ai_fast` (2). Now:
   - extraction AI call: charged when it actually landed, priced from
     `enrichment_meta.tier` (newly exposed through `publicProvenance`; default deep → 5);
   - synthesis calls: priced from the `/api/ai` response's `_tier` (default deep → 5), so
     an operator moving an area's tier moves the price with it;
   - `ai_depth: quick` runs no synthesis → no synthesis charge (already true).
3. **Estimate mirrors the runner** (`templateModel.estimateCredits` rewritten):
   `base + pages(units × pages_per_unit + extra_subpages × units) + AI extraction
   (units × 5) + AI synthesis (units × bundle prompts × 5; quick → 0)`.
   Custom fields ride INSIDE the extraction call (call counts, not tokens) → no surcharge.
   `credit_cost.units_extra: 1` on `ai_visibility_brief` makes the estimate count the
   user's own domain in addition to the competitor list (it read it all along but quoted
   only the competitors). Retired keys `per_ai_call` / `ai_calls_per_unit` removed from all
   seed tables; delegate templates get `extraction_ai_per_unit: 0` (the delegated module
   bills its own work).
   - Net effect on a standard single-domain brief (~3 pages): quote rises 8 → 19-24
     (it was underquoting), while the REAL ledger hit drops ~32 → ~23 (double-charge gone).
     Quote now matches bill.

## Surface-by-surface audit verdict

| Surface | Charge path | Verdict |
|---|---|---|
| Template runs (browser) | finish events (choke points now suppressed) | ✅ fixed this session |
| Home/Preview extraction + enrichment | choke points only | ✅ single-charged |
| Batch / bulk enrichment | choke points only (actuals) | ✅ single-charged (`bulk_row` weight is legacy, unused) |
| Discoverability (interactive + scheduled) | choke points only (actuals); `discoverabilityCredits()` 19 is the affordability check, not a charge | ✅ single-charged |
| Watchlists on-demand | explicit `chargeLedger` once (no meter passed) | ✅ single-charged |
| Watchlist/prompt monitors (cron) | choke points with `kindMap` → `monitor_check` | ✅ single-charged |
| Home/Batch pre-flight quote | pages-only floor (`creditEstimator`) | ⚠️ known underquote (no AI line) — underrun direction, harmless to users; left as-is, documented |

## Verification

- Unit 9421 ✓ · Contract 5570 ✓ (includes updated `templateModel`, `seedTemplates`,
  `templates`, `creditMeter` — new suppressed-context test — and `visibilityBrief` suites).
- Local stack rebuilt (`up.sh local` smoke 17/17) and the full e2e template matrix
  (`scripts/e2e-templates.mjs`) run against it: **535 passed, 0 failed** across every
  executable published template × 3 domains (axiomminds.ai / datiq.app / example.com) ×
  input variants (defaults, custom fields, custom prompt, ai_depth quick/standard,
  deep + 2 subpages + custom fields). A few transient `AI is temporarily unavailable`
  synthesis blips were logged and correctly treated as free/partial per design.
- Live ledger check during matrix traffic: **zero** `caller: extract|api-ai` rows written —
  suppression works in the running stack.

## Incidents this session

- The entire `datiq-local` compose project was removed mid-e2e by something outside this
  session (not `down.sh` — containers were REMOVED, volumes survived). If this recurs,
  suspect a parallel session/automation running compose down; the DB volume
  `datiq-local_dbdata` survived and `SKIP_BUILD=1 up.sh local` restored everything.

## Carry-over

- **Shipped to staging**: `deployment/scripts/gcp/up.sh staging` completed with smoke
  13/13; live estimate verified — `POST /api/templates {action:"estimate"}` for
  `account_brief` returns 19 cr itemised as Workflow setup 1 / Pages 3 / AI extraction 5 /
  AI synthesis 10 (exactly the new model; the seed declares 2 synthesis prompts). Prod
  inherits on its next deploy.
- ⚠️ Ran the WRONG `up.sh` once (`deployment/scripts/up.sh staging` = the LOCAL compose
  stack script; it halted harmlessly at `require_vars`). The GCP staging deploy is
  `deployment/scripts/gcp/up.sh staging`. Note: `.env.staging` was rewritten externally
  (23:50) and no longer carries the local-stack keys (`COMPOSE_PROJECT_NAME`,
  `LOCAL_GATEWAY_PORT`, `PUBLIC_BASE_URL`) — a compose-style staging-named local stack
  will refuse to start until the owner re-adds them; left untouched (operator file).
- Home/Batch pre-flight quote could add an AI line — optional polish, not a defect.
- `creditWeights` header still points at "docs/CREDITS-UNIFICATION-PROPOSAL.md step C"
  (calibration against a real provider invoice) as the follow-up for token-weighted pricing.
- **Known trade-off**: `meterScope` is client-controlled. A forged flag on non-template
  traffic would avoid the choke-point charge (no revenue loss amplification — it just
  doesn't bill the caller's own usage). Guests' template traffic is now fully unledgered
  (previously countable null-user rows). Hardening path if billing ever goes live: require
  the flag to carry a runId and verify run ownership server-side (guests pass because
  null-user rows bill nobody anyway).
