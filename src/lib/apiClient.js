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

/**
 * Read the current session token.
 *
 * Exported so discoverabilityClient.js shares ONE auth source rather than
 * subscribing to the session separately. Two modules tracking the same token
 * is how one of them ends up a session behind and 401s for reasons nobody can
 * reproduce. The Discoverability module keeps its own client because its
 * report endpoints return markdown and CSV, which `request()` — which always
 * calls res.json() — cannot handle.
 */
export function getAuthToken() {
  if (!_authToken && typeof window !== "undefined") {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && ((key.startsWith("sb-") && key.endsWith("-auth-token")) || key === "supabase.auth.token")) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const token = parsed?.access_token || parsed?.currentSession?.access_token;
            if (token) {
              _authToken = token;
              break;
            }
          }
        }
      }
    } catch {
      /* ignore storage read error */
    }
  }
  return _authToken;
}

async function request(path, method = "GET", body) {
  const headers = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

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
    // Edge Access is a 401 AND an HTML body. Matching on the body alone told
    // every user of a healthy production site to "sign in again (branch
    // deploy)" whenever ANY HTML error page came back — a Netlify function
    // timeout (502/504), a crash, or the SPA catch-all answering an unmatched
    // /api path with index.html. Template runs died this way: the real fault
    // was ours, and the message sent the user to look for a login that does
    // not exist. Blaming the reader for our own failure is the exact pattern
    // this codebase keeps having to undo, so the status is now required.
    const isEdgeAccess = isHtml && res.status === 401;
    let errData = {};
    if (!isHtml) {
      try { errData = await res.json(); } catch { /* not JSON */ }
    }
    let message = errData.error;
    if (isEdgeAccess) {
      message = "Site authentication required. Refresh the page and sign in again (the branch deploy uses Netlify Edge Access).";
    } else if (isHtml) {
      // An HTML body that is not Edge Access is an infrastructure error page,
      // never something the reader can act on. Say so plainly and keep the
      // status, which is what actually distinguishes the causes in a report.
      message = res.status >= 500 || res.status === 0
        ? `The server did not complete this request (${res.status}). This is a problem on our side, not with the page you asked for — try again shortly.`
        : `This request could not be reached (${res.status}). Please refresh and try again.`;
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
    // ⚠️ Deliberately NOT lifting an operator `hint` off the body. Customer-
    // facing endpoints no longer send one (see netlify/functions/lib/
    // aiFailure.js), and re-adding this plumbing is how an operator string
    // finds its way back onto a customer's screen: the UI would render it the
    // moment some endpoint started returning it again. Admin screens read
    // their detail from the admin-gated endpoints instead.
    if (isEdgeAccess) e.edgeAccess = true;
    if (isHtml) e.htmlErrorPage = true;
    throw e;
  }

  return res.json();
}

export const apiClient = {
  // ── Firecrawl ──────────────────────────────────────────────────────────────
  /**
   * Scrape a single URL or map a domain (options.mapMode = true).
   * `options.workspaceId` is optional and lifted OUT of the options object
   * onto the top-level request body — the server's option-copy is a fixed
   * whitelist (renderJs/mapMode/noCache/customPrompt) that would silently
   * drop anything else left nested inside `options`. When set, the server
   * checks the caller's seat in that workspace (a paused seat is refused)
   * before running the scrape. Omit it for a personal extraction, unchanged
   * from before this parameter existed.
   */
  extract: (url, options = {}) => {
    const { workspaceId, ...scrapeOptions } = options;
    return request("/extract", "POST", {
      url, options: scrapeOptions, ...(workspaceId ? { workspaceId } : {}),
    });
  },

  /** Reserve one server-side anonymous usage credit (used for batch runs). */
  consumeGuestCredit: (kind = "single") =>
    request("/guest-usage", "POST", { kind }),

  /**
   * The caller's credit position. Read-only, and a HINT — every charge
   * re-sums the ledger server-side. See src/lib/credits/creditClient.js.
   */
  credits: () => request("/credits", "GET"),

  /**
   * Redeem a credit coupon. Server-side by necessity: the ledger sits behind
   * the service key and the browser cannot — and must not — write to it.
   */
  redeemCredits: (code) => request("/credits", "POST", { code }),

  // ── AI (Anthropic Claude) ──────────────────────────────────────────────────
  /** Send a messages-API request. Payload: { model?, max_tokens?, messages }. */
  ai: (payload) => request("/ai", "POST", payload),

  // ── Activation events / PQL ────────────────────────────────────────────────
  // Deliberately NOT routed through the analytics table: see
  // src/lib/pql/pqlClient.js for why these need a private, service-key-written
  // store rather than the world-readable analytics_events.
  pqlEvents: (payload) => request("/pql/events", "POST", payload),
  pqlScore: (payload) => request("/pql/score", "POST", payload),

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

  // ── Export email (Resend, server-side, real file attached) ─────────────────
  // Replaces the old client-side webhook/mailto flow: the server builds the
  // actual CSV/PDF/Markdown/JSON file, gates on the SAME export.<fmt> and
  // export.email capabilities entitlementModel.js already enforces for
  // downloads, and sends it via Resend as an attachment. Payload:
  // { items, format: "csv"|"pdf"|"markdown"|"json", to: string[] }.
  sendExportEmail: (payload) => request("/export-email", "POST", payload),

  // ── Referrals ("invite a friend, you both get 25") ─────────────────────────
  // Codes are minted server-side and rewards applied server-side; nothing here
  // names a user or an amount. See netlify/functions/referral.js for why.

  /** This user's invite code plus their referral standing. */
  getReferral: () => request("/referral", "GET"),

  /** Redeem someone else's code. The server credits both sides atomically. */
  redeemReferral: (code) => request("/referral", "POST", { code }),

  // ── Team workspaces ──────────────────────────────────────────────────────
  // A workspace membership is a real, billable seat gated by
  // entitlementModel.js's workspace.create / workspace.team_seats — the
  // server decides eligibility, this just calls the endpoint. See
  // netlify/functions/workspaces.js.

  /** My workspaces, plus whether the plan allows creating another. */
  listWorkspaces: () => request("/workspaces", "GET"),

  /** One workspace's members and (for owner/admin) pending invites. */
  getWorkspace: (workspaceId) =>
    request(`/workspaces?workspaceId=${encodeURIComponent(workspaceId)}`, "GET"),

  /** Create a workspace owned by the signed-in user. */
  createWorkspace: (name) => request("/workspaces", "POST", { action: "create", name }),

  /** Invite `email` into `workspaceId`, as `role` ('member' or 'admin'). */
  inviteToWorkspace: (workspaceId, email, role = "member") =>
    request("/workspaces", "POST", { action: "invite", workspaceId, email, role }),

  /** Accept an invite token as the signed-in user. */
  acceptWorkspaceInvite: (token) => request("/workspaces", "POST", { action: "accept", token }),

  /** Remove a member, or leave (targetUserId === your own id). */
  removeWorkspaceMember: (workspaceId, targetUserId) =>
    request("/workspaces", "POST", { action: "remove", workspaceId, targetUserId }),

  /**
   * Pause or resume one member's seat. Not a removal — the seat is still
   * theirs and still counts against the plan's team_seats.
   */
  setWorkspaceMemberPaused: (workspaceId, targetUserId, paused) =>
    request("/workspaces", "POST", { action: "set_member_paused", workspaceId, targetUserId, paused }),

  setWorkspaceDiscoverabilityRole: (workspaceId, targetUserId, role) =>
    request("/workspaces", "POST", {
      action: "set_discoverability_role", workspaceId, targetUserId, role,
    }),

  /** Revoke a still-pending invite. */
  revokeWorkspaceInvite: (workspaceId, inviteId) =>
    request("/workspaces", "POST", { action: "revoke_invite", workspaceId, inviteId }),

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
