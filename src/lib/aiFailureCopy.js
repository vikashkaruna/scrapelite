// aiFailureCopy.js — what a FAILED AI call is allowed to say, to whom.
//
// PURE. Shared by the browser and the Netlify functions.
//
// ── WHY THIS SPLIT EXISTS ────────────────────────────────────────────────────
// The first fix for the enrichment outage swung too far the other way. Having
// established that "the AI read this page and found nothing" was a lie, the
// replacement told the *customer* the truth:
//
//   "The AI provider account is out of credit. An administrator needs to top
//    up billing."
//   "An administrator needs to set GEMINI_API_KEY, AI_API_KEY, or OPENAI_API_KEY."
//
// Both are accurate and both are wrong to show a paying customer. They leak
// our billing state and our infrastructure vendors, they name environment
// variables, and — the part that matters most — the reader cannot act on any
// of it. A message the audience cannot act on is not information, it is noise
// with a support ticket attached.
//
// So there are two audiences and two vocabularies:
//
//   • CUSTOMER  — one honest, generic sentence: it's us, not your page, try
//                 again. No vendor names, no billing state, no env vars.
//   • OPERATOR  — the full diagnosis with the exact action, shown ONLY on
//                 /admin/ai and /admin/health, both admin-token gated.
//
// The server enforces the same split (see `publicFailure` in
// netlify/functions/lib/aiFailure.js): a non-admin API response carries the
// machine-readable `code` and nothing else, so a curious customer reading the
// network tab learns no more than the UI tells them.

/** The failure vocabulary. Shared with ENRICH_REASON in extract.js. */
export const AI_FAILURE = {
  // ── The ONE code a customer-facing response may carry for our own faults ──
  // Every operator fault collapses to this before it leaves the server. The
  // client renders a single message for all of them anyway, so sending the
  // specific one hands a customer information the UI deliberately withholds —
  // `code: "no_credit"` in a network tab says exactly what the prose was
  // rewritten to stop saying. It also removes the temptation for some future
  // client to branch on a distinction it has no business knowing.
  UNAVAILABLE:    "ai_unavailable",

  // ── Internal vocabulary: logs, admin screens, and server-side branching ──
  NOT_CONFIGURED: "ai_not_configured",
  CHAIN_FAILED:   "ai_chain_failed",
  NO_CREDIT:      "ai_no_credit",
  BAD_KEY:        "ai_bad_key",
  RATE_LIMITED:   "ai_rate_limited",
  EMPTY_REPLY:    "ai_empty_reply",
  UNPARSEABLE:    "ai_unparseable",
  NO_CONTENT:     "page_no_content",
  ABSENT:         "no_match",
};

/**
 * Is this failure OURS? Everything that names an operator action is — and
 * everything that is ours gets the same generic customer message, because the
 * distinctions between them (billing vs key vs outage) are meaningful only to
 * someone who can fix them.
 */
const OPERATOR_FAULT = new Set([
  AI_FAILURE.UNAVAILABLE,
  AI_FAILURE.NOT_CONFIGURED, AI_FAILURE.CHAIN_FAILED, AI_FAILURE.NO_CREDIT,
  AI_FAILURE.BAD_KEY, AI_FAILURE.RATE_LIMITED, AI_FAILURE.EMPTY_REPLY,
  AI_FAILURE.UNPARSEABLE,
  // Deliberately NOT here: `page_no_content` is about the page (and the user
  // can act on it by enabling JS rendering), and `no_match` is a real finding.
]);

/**
 * TWO vocabularies reach this module and they are not the same words.
 *
 *   • The provider chain (aiProviders.classifyProviderError) returns
 *     `no_credit` / `bad_key` / `rate_limited` / `no_key` / `bad_model` /
 *     `provider_down` / `timeout` / `network` / `error`. It travels as `code`
 *     on a /api/ai failure.
 *   • The enrichment layer (ENRICH_REASON in extract.js) returns the
 *     `ai_`-prefixed forms plus `page_no_content` and `no_match`.
 *
 * They exist separately for good reasons — one describes a PROVIDER, the other
 * describes an ENRICHMENT — but a copy function that understood only one of
 * them silently fell through to the generic default for the other, which is
 * how a "no_credit" content-generation failure briefly read as "No data was
 * returned for this." Normalising here keeps the two layers independent while
 * giving the customer-facing copy a single vocabulary to switch on.
 */
const CHAIN_TO_FAILURE = {
  no_credit:     AI_FAILURE.NO_CREDIT,
  bad_key:       AI_FAILURE.BAD_KEY,
  rate_limited:  AI_FAILURE.RATE_LIMITED,
  no_key:        AI_FAILURE.NOT_CONFIGURED,
  empty:         AI_FAILURE.EMPTY_REPLY,
  // Everything else is "the chain could not answer". The distinctions between
  // a bad model id, a 500 and a timeout matter to an operator, and the
  // operator reads them on /admin/ai — not here.
  bad_model:     AI_FAILURE.CHAIN_FAILED,
  provider_down: AI_FAILURE.CHAIN_FAILED,
  // A model that reasoned past its output budget. Deliberately NOT mapped to
  // EMPTY_REPLY: that one is flagged transient, and this does not clear on a
  // retry with the same budget — it needs an operator to change a setting.
  truncated:     AI_FAILURE.CHAIN_FAILED,
  timeout:       AI_FAILURE.CHAIN_FAILED,
  network:       AI_FAILURE.CHAIN_FAILED,
  error:         AI_FAILURE.CHAIN_FAILED,
};

const KNOWN_FAILURES = new Set(Object.values(AI_FAILURE));

/**
 * FAILS SAFE. An unrecognised code becomes `ai_chain_failed`, i.e. OUR fault —
 * not `no_match`, i.e. the customer's page is empty.
 *
 * The asymmetry is deliberate and matches the cost of being wrong. A new
 * infrastructure failure mode is by far the likelier source of an unknown
 * code, and telling someone their page has no pricing on it when it plainly
 * does is the mistake that generates a support ticket, damages trust, and —
 * as this codebase already learned — hides an outage for weeks. Wrongly
 * offering a retry costs one click.
 */
export function normaliseFailureCode(code) {
  if (!code) return AI_FAILURE.CHAIN_FAILED;
  if (CHAIN_TO_FAILURE[code]) return CHAIN_TO_FAILURE[code];
  if (KNOWN_FAILURES.has(code)) return code;
  return AI_FAILURE.CHAIN_FAILED;
}

export function isOperatorFault(code) {
  return OPERATOR_FAULT.has(normaliseFailureCode(code));
}

/**
 * A failure that clears on its own vs one that needs a human. Only used to
 * decide whether the UI says "try again" — never shown as a distinct message,
 * because a customer retrying an unfunded account learns nothing new.
 */
const TRANSIENT = new Set([AI_FAILURE.RATE_LIMITED, AI_FAILURE.EMPTY_REPLY, AI_FAILURE.UNPARSEABLE]);
export function isTransient(code) { return TRANSIENT.has(normaliseFailureCode(code)); }

/**
 * The code a CUSTOMER-FACING response body may carry. Collapses every
 * operator fault to `ai_unavailable`; passes through the two findings that are
 * genuinely about the page (`no_match`, `page_no_content`) because the client
 * shows different, useful copy for those.
 *
 * Call this at every point a failure code crosses into a public response.
 */
export function publicFailureCode(code) {
  const normalised = normaliseFailureCode(code);
  return isOperatorFault(normalised) ? AI_FAILURE.UNAVAILABLE : normalised;
}

// ── Customer-facing ──────────────────────────────────────────────────────────
// ONE sentence for every operator fault. Resist the urge to differentiate:
// each variant you add is another way for our internal state to reach a
// customer's screen, and none of them changes what they can do about it.
const GENERIC_OPERATOR_FAULT =
  "AI enrichment is temporarily unavailable. This is a problem on our side, not with your page — try again shortly.";

/**
 * The message a customer may see. Never names a vendor, a key, a bill or an
 * environment variable.
 *
 * @param {string} code
 * @param {{ what?: string }} [opts] `what` names the thing that failed, e.g.
 *   "this capability" or "the summary", so one string serves several surfaces.
 */
export function userFacingMessage(code, opts = {}) {
  const what = opts.what || "this";
  switch (normaliseFailureCode(code)) {
    case AI_FAILURE.NO_CONTENT:
      // Theirs to act on, and says nothing about us.
      return "We couldn't read any text from this page. It may render entirely in JavaScript — try again with JS rendering enabled.";
    case AI_FAILURE.ABSENT:
      // The one case where the honest answer really is about their page. Note
      // it says what we READ, so "found nothing" is a claim we can stand behind.
      return `We read this page and the pages it links to, and found nothing matching ${what}.`;
    default:
      return isOperatorFault(code) ? GENERIC_OPERATOR_FAULT : "No data was returned for this.";
  }
}

// ── Operator-facing (admin screens only) ─────────────────────────────────────
// Mirrors PROVIDER_ERROR_COPY in netlify/functions/lib/aiProviders.js. The two
// exist separately because this one must be importable into the browser bundle
// without pulling in the Netlify function tree; a registry test asserts the
// code sets stay in step.
export const OPERATOR_COPY = {
  [AI_FAILURE.NOT_CONFIGURED]: "No AI provider key is set on this server. Set GEMINI_API_KEY, AI_API_KEY or OPENAI_API_KEY.",
  [AI_FAILURE.BAD_KEY]:        "An AI provider rejected the API key. Reissue it and update the environment variable.",
  [AI_FAILURE.NO_CREDIT]:      "An AI provider account is out of credit. Top up billing.",
  [AI_FAILURE.RATE_LIMITED]:   "An AI provider is rate-limiting requests. The key is valid.",
  [AI_FAILURE.CHAIN_FAILED]:   "Every configured AI provider failed. Check /admin/ai → Test all providers.",
  [AI_FAILURE.EMPTY_REPLY]:    "The model returned an empty response.",
  [AI_FAILURE.UNPARSEABLE]:    "The model answered but not in a readable form.",
  [AI_FAILURE.NO_CONTENT]:     "The scrape produced no readable text for this page.",
  [AI_FAILURE.ABSENT]:         "The model read the page and found nothing matching the capability.",
  // Only ever seen if a customer-facing code is fed back into an admin view.
  [AI_FAILURE.UNAVAILABLE]:    "An AI failure was redacted for the customer. The specific cause is in the function log and on /admin/ai.",
};

/** The full diagnosis. ADMIN SCREENS ONLY — never render this to a customer. */
export function operatorMessage(code) {
  return OPERATOR_COPY[normaliseFailureCode(code)]
    || "The AI request failed. Check /admin/ai → Test all providers.";
}
