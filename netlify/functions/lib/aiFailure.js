// aiFailure.js — strip operator diagnostics out of any response a CUSTOMER
// can read.
//
// ⚠️ THIS FILE ORIGINALLY COVERED ONLY THE FAILURE PATH, AND THAT WAS HALF THE
// BOUNDARY. A successful extraction shipped `provider: "openai"` and
// `model: "gpt-4o-mini"` in its provenance, which the UI rendered as a chip
// reading `openai · gpt-4o-mini` on the customer's own report — disclosing the
// same vendor identity the failure path had just been rewritten to hide, on
// the path that runs far more often. `publicProvenance` below closes it.
// Anything added to a customer-visible body from here on gets the same
// question: who reads this, and what do they do with it?
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

// ── The SUCCESS path ─────────────────────────────────────────────────────────

/**
 * Reduce an extraction's provenance to what a customer may see.
 *
 * WHAT SURVIVES is what says something about THEIR page:
 *   capability / label — which extraction this is
 *   facts             — how much was found
 *   pagesRead         — which of their URLs we read; they can verify every one
 *   ok                — whether it worked
 *
 * WHAT DOES NOT is what says something about OUR STACK:
 *   provider / model  — vendor identity and the exact model id. A customer can
 *                       act on neither, it changes without notice as the admin
 *                       chain is re-ordered, and publishing it invites "why am
 *                       I paying for gpt-4o-mini?" about a routing decision
 *                       that is ours to make.
 *   structured        — whether the provider enforced a JSON schema natively.
 *                       Pure implementation detail; it rendered as a
 *                       "Schema-validated" badge that meant nothing to a
 *                       reader and would silently flip meaning the day a
 *                       provider gains or loses that capability.
 *
 * Redacted where the body is BUILT, not in the UI, for the reason this whole
 * module exists: the UI is not the only reader of a response.
 *
 * @param {object|null} meta the internal enrichment meta
 * @returns {object|null} the customer-safe subset
 */
export function publicProvenance(meta) {
  if (!meta || typeof meta !== "object") return null;
  const out = {};
  // Allowlist, never a denylist. A denylist silently ships every field someone
  // adds later — which is precisely how provider/model survived the first pass.
  // `tier` is our own fast/deep pricing vocabulary (a template run bills the
  // extraction call from it), not vendor prose.
  for (const key of ["ok", "capability", "label", "groups", "facts", "reason", "pagesRead", "tier"]) {
    if (meta[key] !== undefined) out[key] = meta[key];
  }
  return out;
}

/**
 * The full provenance, for admin-gated endpoints and server logs only.
 * Never pass the result of this to a non-admin response body.
 */
export function operatorProvenance(meta) {
  return meta || null;
}
