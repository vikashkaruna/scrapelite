// src/lib/credits/creditWeights.js — the price list, in one place.
//
// PURE. Imported by React (to show an estimate) and by netlify/ (to charge the
// actual), exactly like entitlementModel.js, so the number quoted and the
// number billed are produced by the same table. A second copy on the server is
// how two prices for one action start disagreeing.
//
// ── THE ANCHOR ──────────────────────────────────────────────────────────────
// 1 credit = one page fetch. Everything else is expressed as a multiple of
// that, because a fetch is the one unit every surface in the product shares.
//
// ⚠️ THESE ARE COUNTS OF PROVIDER CALLS, NOT TOKENS.
// docs/CREDITS-UNIFICATION-PROPOSAL.md step C is the calibration pass that
// puts these numbers in front of a real provider invoice. Until that has
// happened they are measured *call counts* — accurate about how many times we
// reach a provider, silent about what each call costs. Move a weight here and
// every plan re-prices at once, so move it deliberately and with evidence.
//
// ── WHY DISCOVERABILITY IS ONE NUMBER AND NOT A PILLAR SUM ──────────────────
// An audit's cost is the pipeline's, not the score's. Pillars are a scoring
// construct; the money goes on fetches, one PageSpeed lookup, a citation
// sample and two AI calls. Pricing it per pillar would make the bill move
// whenever the SCORING model changed, which is the wrong axis entirely.

/** Every metered unit. Mirrors credit_ledger.unit plus the audit sub-units. */
export const UNITS = Object.freeze({
  PAGE: "page",
  AI_CALL: "ai_call",
  ENRICHMENT: "enrichment",
  AUDIT: "audit",
  MONITOR_CHECK: "monitor_check",
  RUN: "run",
  MESSAGE: "message",
});

/** AI tiers. `deep` is a pricing decision (D17), not a placeholder. */
export const AI_TIERS = Object.freeze(["fast", "deep"]);

/**
 * The §1 table. Keys are stable identifiers; they travel in ledger `meta` and
 * in every historical row, so ADD one rather than renaming one.
 */
export const CREDIT_WEIGHTS = Object.freeze({
  page_fetch: 1,
  // D11 — PageSpeed is charged. It is free at low volume and falls back to
  // keyless, but "cheap for us" is not "free to the customer": it is a real
  // lookup on every audit and it is part of what a paid plan buys.
  pagespeed: 1,
  ai_fast: 2,
  ai_deep: 5,
  // 1 fetch + 1 fast AI. Rises to 4–5 when the related-page scan fires, which
  // is charged from ACTUALS — the scan either happened or it did not.
  enrichment: 3,
  monitor_page: 1,
  monitor_prompt: 2,
  bulk_row: 3,
  // D12 — identical whether a human pressed the button or a cron did. The cost
  // is the same and the unattended one is the larger risk.
  citation_prompt_extra: 2,
  // 0082 — one outbound email from the Prospect Engagement Engine.
  // ⚠️ PROVISIONAL (2026-09-23): priced like one page fetch pending the owner's
  // pricing decision. Resend's marginal cost is well under a page fetch; the
  // weight is set by what the send is worth to the customer, not what it costs
  // us. WhatsApp and SMS carry real per-message carrier cost and must get their
  // own, higher weights before those channels open — never reuse this one.
  outreach_email: 1,
});

/**
 * A Discoverability run, recounted against the pipeline (§1):
 *   collectPage       3 fetches   3
 *   canonical check   1 fetch     1
 *   fetchWebVitals    1 PSI       1   (D11)
 *   sampleCitations   5 AI        10
 *   evaluatePassage   1 AI         2
 *   summariseAudit    1 AI         2
 *                                 19
 */
export const DISCOVERABILITY_BASE = 19;

/** The default citation prompt set that DISCOVERABILITY_BASE already covers. */
export const DEFAULT_CITATION_PROMPTS = 5;

/**
 * 🔴 Free reserves exactly one Discoverability run, and the reserve must be
 * re-derived whenever the weight moves. A reserve that lags the weight means
 * the one action that demonstrates the product fails for the user who spent
 * their pool on extractions first — which is the opposite of what a taster is.
 */
export const FREE_GRANT = 500;
export const FREE_DISCOVERABILITY_RESERVE = DISCOVERABILITY_BASE;

/** Rolled-over credits expire at the end of the month AFTER the one granted. */
export const ROLLOVER_MONTHS = 1;

/** Agency fair-use pool and the rate above it (D13). */
export const AGENCY_FAIR_USE = 100_000;
export const AGENCY_OVERAGE_USD_PER_1K = 2.0;

/**
 * Cost of one Discoverability run at a given prompt count.
 * Anything beyond the default set is a surcharge, which is what stops the most
 * expensive run from being the cheapest per unit of work.
 */
export function discoverabilityCredits(promptCount = DEFAULT_CITATION_PROMPTS) {
  const n = Number.isFinite(promptCount) ? Math.max(0, Math.floor(promptCount)) : DEFAULT_CITATION_PROMPTS;
  const extra = Math.max(0, n - DEFAULT_CITATION_PROMPTS);
  return DISCOVERABILITY_BASE + extra * CREDIT_WEIGHTS.citation_prompt_extra;
}

/** Cost of one AI call at a tier. An unknown tier is charged as `fast`. */
export function aiCredits(tier = "fast") {
  return tier === "deep" ? CREDIT_WEIGHTS.ai_deep : CREDIT_WEIGHTS.ai_fast;
}

/**
 * The single lookup every choke point uses. `kind` is one of CREDIT_WEIGHTS'
 * keys; `quantity` multiplies it.
 *
 * ⚠️ An UNKNOWN kind returns 0 and is reported, never guessed at. Inventing a
 * price for something nobody priced bills a customer for a number no one
 * decided — the parity test is what catches the omission, not a fallback.
 */
export function creditsFor(kind, quantity = 1) {
  const unit = CREDIT_WEIGHTS[kind];
  if (!Number.isFinite(unit)) return { credits: 0, known: false, kind };
  const q = Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 1;
  return { credits: unit * q, known: true, kind };
}

/** Which ledger `reason` a metered kind is recorded under. */
export const KIND_TO_REASON = Object.freeze({
  page_fetch: "page_fetch",
  pagespeed: "page_fetch",
  ai_fast: "ai_call",
  ai_deep: "ai_call",
  enrichment: "enrichment",
  monitor_page: "monitor_check",
  monitor_prompt: "monitor_check",
  bulk_row: "enrichment",
  citation_prompt_extra: "ai_call",
  discoverability: "audit",
  outreach_email: "outreach",
});

/** Which ledger `unit` a metered kind is recorded under. */
export const KIND_TO_UNIT = Object.freeze({
  page_fetch: UNITS.PAGE,
  pagespeed: UNITS.PAGE,
  ai_fast: UNITS.AI_CALL,
  ai_deep: UNITS.AI_CALL,
  enrichment: UNITS.ENRICHMENT,
  monitor_page: UNITS.MONITOR_CHECK,
  monitor_prompt: UNITS.MONITOR_CHECK,
  bulk_row: UNITS.ENRICHMENT,
  citation_prompt_extra: UNITS.AI_CALL,
  discoverability: UNITS.AUDIT,
  outreach_email: UNITS.MESSAGE,
});
