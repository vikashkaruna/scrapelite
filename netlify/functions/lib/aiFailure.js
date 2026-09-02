// aiFailure.js — strip operator diagnostics out of any response a CUSTOMER
// can read.
//
// ── DEFENCE IN DEPTH, NOT BELT-AND-BRACES ────────────────────────────────────
// The UI already shows customers a generic message (see src/lib/aiFailureCopy
// .js). This exists because the UI is not the only reader of an API response.
// A customer with the network tab open, an API-key holder on /api/v1, a
// support screenshot, a Sentry breadcrumb, a log aggregator — all of them see
// the raw body. Sending the vendor's own words —
//
//   "Your credit balance is too low to access the Anthropic API"
//   "API key not valid. Please pass a valid API key."
//
// — to any of those is the same disclosure as printing it on the page, just
// slower to notice. So the redaction happens where the body is built.
//
// What survives for a customer: the machine-readable `code`, because the
// client branches on it to choose which generic message to show. What does
// not: the provider's identity, the provider's error text, the attempt list,
// and any hint naming a key, a bill or an environment variable.
//
// The unredacted form is still available — to admin-token-gated endpoints
// only: /api/admin-provider-test, /api/admin-ai-config and /api/admin-health.

import { publicFailureCode } from "../../../src/lib/aiFailureCopy.js";

/**
 * Reduce an aiProviders chain result to what a customer may see.
 *
 * The code is COLLAPSED, not just passed through: every operator fault becomes
 * `ai_unavailable`. `code: "no_credit"` in a network tab says exactly what the
 * prose was rewritten to stop saying, and the client renders one message for
 * all of them regardless.
 *
 * @param {{errorCode?:string, error?:string, attempts?:Array}} chainResult
 * @returns {{code:string}} — deliberately the whole payload. If you find
 *   yourself adding a field here, ask who reads it and what they do with it.
 */
export function publicFailure(chainResult) {
  return { code: publicFailureCode(chainResult?.errorCode) };
}

/**
 * The full diagnosis, for admin-gated endpoints and server logs only.
 * Never pass the result of this to a non-admin response body.
 */
export function operatorFailure(chainResult) {
  return {
    code: chainResult?.errorCode || "error",
    error: chainResult?.error,
    attempts: chainResult?.attempts,
  };
}

/**
 * One-line server log for a chain failure. Logs are operator surfaces, so the
 * vendor's text belongs here — it is the fastest route to the fix, and it is
 * exactly what was missing while the outage went unnoticed.
 */
export function logChainFailure(label, chainResult) {
  const attempts = (chainResult?.attempts || [])
    .map((a) => `${a.provider}:${a.code || a.skipped || "?"}${a.error ? ` (${String(a.error).slice(0, 120)})` : ""}`)
    .join(" | ");
  console.warn(`[DatIQ] ${label} failed — code=${chainResult?.errorCode || "error"} ${attempts}`);
}
