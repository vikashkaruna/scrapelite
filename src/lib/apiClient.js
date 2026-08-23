// Central HTTP client for all /api/* calls (Netlify Functions).
//
// Architecture: UI → apiClient → /api/* → Netlify Function → external/internal service
//
// All service modules (firecrawlService, aiService, extractionsRepo) use this
// instead of calling external APIs directly, keeping secret keys server-side.
//
// Auth: call setAuthToken(jwt) whenever the Supabase session changes (done by
// AuthProvider). Every subsequent request will include Authorization: Bearer <jwt>.

const BASE = "/api";

let _authToken = null;

/** Called by AuthProvider whenever the session changes. */
export function setAuthToken(token) {
  _authToken = token ?? null;
}

async function request(path, method = "GET", body) {
  const headers = { "Content-Type": "application/json" };
  if (_authToken) headers["Authorization"] = `Bearer ${_authToken}`;

  const opts = {
    method,
    headers,
    // Same-origin by default; explicit for clarity. The Edge Access
    // basic-auth cookie lives on the site domain and must travel with
    // every API call to the function. Omitting `credentials` would
    // default to `same-origin` for same-origin requests, but making
    // it explicit protects against future bundler changes that might
    // strip the default.
    credentials: "same-origin",
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);

  if (!res.ok) {
    // Edge Access (Netlify's site-wide basic auth, used on branch
    // deploys) returns 401 with an HTML page that JS-redirects to the
    // app.netlify.com/edge-access login. res.json() throws on HTML,
    // and the catch would fall back to res.statusText ("Unauthorized")
    // — which is correct but useless for the user. Detect the Edge
    // Access shape and surface a clear, actionable message.
    const contentType = res.headers.get("content-type") || "";
    const isHtml = contentType.includes("text/html");
    let errData = {};
    if (!isHtml) {
      try { errData = await res.json(); } catch { /* not JSON */ }
    }
    let message = errData.error;
    if (isHtml) {
      message = "Site authentication required. Refresh the page and sign in again (the branch deploy uses Netlify Edge Access).";
    } else if (!message) {
      message = `API ${method} ${path} failed (${res.status})`;
    }
    const e = new Error(message);
    e.status = res.status;
    e.detail = errData.detail;
    e.useLocalStorage = errData.useLocalStorage === true;
    // Machine-readable verdict from the server, carried through so callers can
    // branch on it instead of pattern-matching the prose in `message`. Dropping
    // these was how a deliberate robots.txt refusal reached classifyError as an
    // unrecognised string and got reported as "Something went wrong. An
    // unexpected error occurred." — see src/lib/errorMessages.js.
    if (errData.code) e.code = errData.code;
    if (errData.host) e.host = errData.host;
    if (errData._complianceBlocked === true) e.complianceBlocked = true;
    if (errData.consentAvailable === true) e.consentAvailable = true;
    // Referral refusals carry a `reason` (invalid | self | already |
    // unavailable) whose user-facing wording the SERVER owns, so the two can
    // never drift into describing the same verdict differently.
    if (errData.reason) e.reason = errData.reason;
    if (isHtml) e.edgeAccess = true;
    throw e;
  }

  return res.json();
}

export const apiClient = {
  // ── Firecrawl ──────────────────────────────────────────────────────────────
  /** Scrape a single URL or map a domain (options.mapMode = true). */
  extract: (url, options = {}) =>
    request("/extract", "POST", { url, options }),

  /** Reserve one server-side anonymous usage credit (used for batch runs). */
  consumeGuestCredit: (kind = "single") =>
    request("/guest-usage", "POST", { kind }),

  // ── AI (Anthropic Claude) ──────────────────────────────────────────────────
  /** Send a messages-API request. Payload: { model?, max_tokens?, messages }. */
  ai: (payload) => request("/ai", "POST", payload),

  // ── Contact form ───────────────────────────────────────────────────────────
  /**
   * Deliver a /contact submission as email (Resend, server-side).
   * The destination inbox is resolved by the function from `type` — the client
   * cannot address the mail. Payload: { type, name, email, subject, message }.
   */
  sendContactEmail: (payload) => request("/contact-email", "POST", payload),

  // ── Analytics consent ──────────────────────────────────────────────────────
  // Routed through here rather than a bare fetch so the Authorization header
  // travels with them: the function resolves user_id from the JWT and never
  // from the body, so a consent recorded without the header would be filed as
  // anonymous even for a signed-in user.
  /** Record a choice. Payload: { analytics, source, policyVersion, sessionId, gaClientId }. */
  recordConsent: (payload) => request("/consent", "POST", payload),

  /** Back-fill user_id onto this session's existing record. Payload: { sessionId }. */
  linkConsent: (payload) => request("/consent/link", "POST", payload),

  /** Deny + erase this subject's analytics_events rows. Payload: { sessionId }. */
  withdrawConsent: (payload) => request("/consent/withdraw", "POST", payload),

  // ── Product analytics ingest ───────────────────────────────────────────────
  /**
   * Batch-write in-house events. Payload: { events: [...] }.
   * The browser can no longer INSERT into analytics_events directly — that
   * required an anon RLS policy which also made the table world-readable
   * (see 0024_analytics_rls.sql).
   */
  recordAnalytics: (payload) => request("/analytics", "POST", payload),

  // ── Extractions CRUD ───────────────────────────────────────────────────────
  /** List all saved extractions, newest first. */
  listExtractions: () => request("/extractions", "GET"),

  /** Persist a new extraction. Returns the saved row with server-assigned id. */
  createExtraction: (payload) =>
    request("/extractions", "POST", payload),

  /** Merge fields into an existing extraction (used for enrichment tab sync). */
  patchExtraction: (id, fields) =>
    request(`/extractions?id=${encodeURIComponent(id)}`, "PATCH", fields),

  /** Delete an extraction by id. */
  deleteExtraction: (id) =>
    request(`/extractions?id=${encodeURIComponent(id)}`, "DELETE"),

  // ── Referrals ("invite a friend, you both get 25") ─────────────────────────
  // Codes are minted server-side and rewards applied server-side; nothing here
  // names a user or an amount. See netlify/functions/referral.js for why.

  /** This user's invite code plus their referral standing. */
  getReferral: () => request("/referral", "GET"),

  /** Redeem someone else's code. The server credits both sides atomically. */
  redeemReferral: (code) => request("/referral", "POST", { code }),

  // ── Scrape consent ("I have permission to extract this site") ──────────────
  // The record behind an override of a robots.txt refusal. The server resolves
  // the user from the JWT; nothing here names a user, and /api/extract never
  // accepts a "consented" flag — it re-reads the record itself on every call.

  /** Is there an unexpired attestation for `host`? Omit host to list them all. */
  getScrapeConsent: (host) =>
    request(host ? `/scrape-consent?host=${encodeURIComponent(host)}` : "/scrape-consent", "GET"),

  /** Record an attestation. `confirmed` must be true — the server re-checks it. */
  grantScrapeConsent: (host, source = "extract_refusal") =>
    request("/scrape-consent", "POST", { host, confirmed: true, source }),

  /** Withdraw it. Consent you cannot revoke is not consent. */
  revokeScrapeConsent: (host) =>
    request(`/scrape-consent?host=${encodeURIComponent(host)}`, "DELETE"),

  // ── Schedules CRUD (recurring extraction / track-changes) ───────────────────
  /** List all schedules for the current session, newest first. */
  listSchedules: () => request("/schedules", "GET"),

  /** Create or update a schedule. Returns the saved row. */
  upsertSchedule: (payload) => request("/schedules", "POST", payload),

  /** Delete a schedule by id. */
  deleteSchedule: (id) =>
    request(`/schedules?id=${encodeURIComponent(id)}`, "DELETE"),
};
