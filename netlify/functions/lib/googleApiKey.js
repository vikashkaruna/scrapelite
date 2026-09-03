// googleApiKey.js — tell Google's two incompatible key formats apart, and
// recognise the response you get for using the wrong one.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
// DatIQ holds two Google credentials in two env vars, and they are NOT
// interchangeable:
//
//   GEMINI_API_KEY   → generativelanguage.googleapis.com (the Gemini API)
//   PAGESPEED_API_KEY → www.googleapis.com/pagespeedonline (Core Web Vitals)
//
// Google AI Studio now issues only the newer **auth key** format, which begins
// `AQ.` and is accepted by the Gemini API's own endpoints. Every other Google
// API — PageSpeed Insights included — still wants a **Cloud API key**, the
// `AIza…` form minted in the Cloud console. Give PageSpeed an `AQ.` key and it
// answers:
//
//   "API keys are not supported by this API. Expected OAuth2 access token or
//    other authentication credentials that assert a principal."
//
// Which is true, unhelpful, and — read as a generic `bad_key` — sends an
// operator to reissue a key that was never the right SHAPE. The two keys look
// interchangeable in a settings screen (same vendor, same length, both start
// with A) so pasting one into the other's slot is the obvious mistake to make.
//
// ⚠️ AND IT IS WORSE THAN NO KEY. PageSpeed works unauthenticated at low
// volume, so an EMPTY var degrades gracefully while a WRONG one fails every
// single lookup — turning "LCP/INP/CLS at a reduced quota" into "not measured,
// on every audit, for ever". That asymmetry is why fetchWebVitals retries
// keyless on a rejection of this shape rather than treating the key as
// authoritative.

/** The Cloud console's API-key format: `AIza` + 35 URL-safe characters. */
const CLOUD_KEY_RE = /^AIza[0-9A-Za-z_-]{10,}$/;

/** AI Studio's newer auth-key format. */
const AI_STUDIO_KEY_RE = /^AQ\./;

/**
 * Which kind of Google credential is this?
 * @returns {"none"|"cloud"|"ai_studio"|"oauth"|"unknown"}
 */
export function googleKeyKind(key) {
  const k = String(key || "").trim();
  if (!k) return "none";
  if (CLOUD_KEY_RE.test(k)) return "cloud";
  if (AI_STUDIO_KEY_RE.test(k)) return "ai_studio";
  if (/^ya29\./.test(k)) return "oauth";      // an access token, not a key
  return "unknown";
}

/**
 * Does this response mean "your credential is the wrong KIND", as opposed to
 * "your key is invalid" or "you are over quota"?
 *
 * Matched on Google's own wording rather than the status alone, because the
 * same 400/403 pair also carries genuine bad-key and permission errors, and
 * the remedy differs: a wrong-kind key means MINT A DIFFERENT KEY, a bad key
 * means reissue THIS one, and a disabled API means enable it.
 *
 * @param {number} status
 * @param {object} body the parsed error body (`{ error: { message, status } }`)
 */
export function isCredentialKindRejection(status, body) {
  if (status !== 400 && status !== 401 && status !== 403) return false;
  const msg = String(body?.error?.message || "").toLowerCase();
  return /api keys are not supported/.test(msg)
    || /expected oauth2 access token/.test(msg)
    || /assert a principal/.test(msg);
}

/** Any credential problem at all — the set worth retrying without a key. */
export function isCredentialRejection(status, body) {
  if (isCredentialKindRejection(status, body)) return true;
  if (status !== 400 && status !== 401 && status !== 403) return false;
  const msg = String(body?.error?.message || "").toLowerCase();
  return /api key not valid/.test(msg)
    || /invalid api key/.test(msg)
    || /api key expired/.test(msg)
    || /has not been used in project|is disabled|permission denied|blocked/.test(msg);
}

/**
 * Operator-facing advice for a PageSpeed key, or null when it looks right.
 * Names the exact remedy, because "reissue the key" is the wrong instruction
 * for three of these four cases.
 */
export function pageSpeedKeyAdvice(key) {
  switch (googleKeyKind(key)) {
    case "none":
    case "cloud":
      return null;
    case "ai_studio":
      return "This is a Google AI Studio key (the `AQ.` format used by GEMINI_API_KEY). "
        + "PageSpeed Insights does not accept it. Set PAGESPEED_API_KEY to a Cloud API key "
        + "(Google Cloud console → APIs & Services → Credentials → Create API key) with the "
        + "PageSpeed Insights API enabled — those begin `AIza`.";
    case "oauth":
      return "This is an OAuth access token (`ya29.`), not an API key, and it expires within the hour. "
        + "Set PAGESPEED_API_KEY to a Cloud API key beginning `AIza`.";
    default:
      return "This does not look like a Google Cloud API key (those begin `AIza`). "
        + "PageSpeed Insights will reject it, and audits will fall back to keyless quota.";
  }
}
