// netlify/functions/lib/scrapeConsent.js — per-host scraping attestations.
//
// DatIQ honours robots.txt by default. When a host disallows us, that refusal
// stands unless the SIGNED-IN person asking has told us, on the record, that
// they have permission for that host. This module stores and reads that
// record; complianceEngine.js stays a pure reading of the host's own rules and
// knows nothing about it.
//
// ── THE RULE THAT MAKES THIS AN OVERRIDE AND NOT A BYPASS ────────────────────
// The grant is resolved SERVER-SIDE from the caller's JWT. The client never
// sends "I consented" in a request body and the server would ignore it if it
// did. A flag a client can set is not an attestation, it is a query parameter
// that turns compliance off — which is precisely the thing FD3 exists to
// prevent (one abusive caller getting our shared egress IPs banned for
// everyone).
//
// ── FAILURE MODE: FAIL CLOSED ───────────────────────────────────────────────
// This is the ONE lookup in the extract path that does NOT fail open, and the
// asymmetry is deliberate. requireEntitlement.js and jobControl.js fail open
// because an infrastructure blip must not take the product down. Here, failing
// open would mean an unreachable Supabase silently grants everyone permission
// to scrape every disallowed host on earth. The safe default when we cannot
// read the record is "there is no record" — the user sees the normal refusal
// and can retry. Do not "fix" this to match the others.

/** Bumped when the attestation wording changes materially, so an old grant is
 *  distinguishable from one made under the current text. */
export const SCRAPE_CONSENT_POLICY_VERSION = "2026-08-23";

/** How long a self-certification stays good before it must be renewed. Mirrors
 *  the column default in 0028_scrape_consent.sql; kept here too so the handler
 *  can report the expiry it just created without a second round trip. */
export const CONSENT_TTL_DAYS = 180;

/**
 * Normalise a host for storage and lookup: lowercase, no trailing dot, and a
 * leading "www." stripped so www.example.com and example.com are ONE grant.
 *
 * It deliberately stops there. Permission for a company's careers site is not
 * permission for its API host, so no eTLD+1 collapsing and no subdomain
 * wildcarding — those would quietly widen an attestation the user never made.
 */
export function normalizeConsentHost(input) {
  let host = String(input || "").trim().toLowerCase();
  if (!host) return "";
  // Accept a full URL or a bare host.
  if (host.includes("://")) {
    try { host = new URL(host).hostname.toLowerCase(); } catch { return ""; }
  } else {
    // A bare host must not carry a path, query, port or credentials.
    if (/[\s/?#@]/.test(host)) return "";
  }
  host = host.replace(/\.$/, "");
  host = host.replace(/^www\./, "");
  // Reject anything that isn't plausibly a hostname.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return "";
  return host;
}

/** Service-key REST handle. Deliberately not the SDK — matches the house style
 *  used by requireEntitlement.js and guestUsage.js. */
function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

/**
 * Is there an unexpired attestation for this user and host?
 * Returns { granted: boolean, expiresAt: string|null, degraded: boolean }.
 * `degraded: true` means we could not read the record — see the fail-closed
 * note at the top. Callers must treat degraded exactly like `granted: false`.
 */
export async function hasScrapeConsent(userId, host, env = process.env) {
  const h = normalizeConsentHost(host);
  if (!userId || !h) return { granted: false, expiresAt: null, degraded: false };
  const db = serviceDb(env);
  if (!db) return { granted: false, expiresAt: null, degraded: true };

  try {
    const qs = new URLSearchParams({
      select: "host,expires_at",
      user_id: `eq.${userId}`,
      host: `eq.${h}`,
      // Expiry is enforced in the QUERY, not in JS after the fact: an expired
      // grant must never be readable as a grant, even by a caller that forgets
      // to compare the date.
      expires_at: `gt.${new Date().toISOString()}`,
      limit: "1",
    });
    const res = await fetch(`${db.base}/scrape_consent_records?${qs}`, { headers: db.headers });
    if (!res.ok) return { granted: false, expiresAt: null, degraded: true };
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return { granted: Boolean(row), expiresAt: row?.expires_at || null, degraded: false };
  } catch {
    return { granted: false, expiresAt: null, degraded: true };
  }
}

/** Coarse ISO country from Netlify's own geo context. Never an IP. */
function countryOf(event) {
  const geo = event?.headers?.["x-nf-geo"] || event?.headers?.["X-Nf-Geo"];
  if (geo) {
    try {
      const parsed = JSON.parse(Buffer.from(geo, "base64").toString("utf8"));
      if (parsed?.country?.code) return String(parsed.country.code).slice(0, 2).toUpperCase();
    } catch { /* fall through */ }
  }
  const cc = event?.headers?.["x-country"] || event?.headers?.["x-nf-client-connection-country"];
  return cc ? String(cc).slice(0, 2).toUpperCase() : null;
}

/** Append an audit row. Best-effort by design: the audit trail must never be
 *  the reason a grant or a withdrawal fails. It is logged loudly instead. */
async function writeAudit(db, row) {
  try {
    const res = await fetch(`${db.base}/scrape_consent_audit`, {
      method: "POST",
      headers: { ...db.headers, Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      console.error("[DatIQ] scrape_consent_audit write failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[DatIQ] scrape_consent_audit write threw:", err.message);
  }
}

/**
 * Record an attestation for (userId, host). Idempotent — re-attesting renews
 * the expiry and appends a fresh audit row rather than erroring.
 * Returns { ok, host, expiresAt, error }.
 */
export async function grantScrapeConsent(userId, host, event, source = "extract_refusal", env = process.env) {
  const h = normalizeConsentHost(host);
  if (!userId) return { ok: false, error: "Authentication required" };
  if (!h) return { ok: false, error: "A valid host is required" };
  const db = serviceDb(env);
  if (!db) return { ok: false, error: "Consent storage is not configured" };

  const expiresAt = new Date(Date.now() + CONSENT_TTL_DAYS * 86_400_000).toISOString();
  try {
    const res = await fetch(
      `${db.base}/scrape_consent_records?on_conflict=user_id,host`,
      {
        method: "POST",
        headers: { ...db.headers, Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          user_id: userId,
          host: h,
          policy_version: SCRAPE_CONSENT_POLICY_VERSION,
          granted_at: new Date().toISOString(),
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text();
      console.error("[DatIQ] scrape consent upsert failed:", res.status, detail);
      return { ok: false, error: "Could not record your confirmation. Please try again." };
    }
    await writeAudit(db, {
      user_id: userId,
      host: h,
      action: "granted",
      policy_version: SCRAPE_CONSENT_POLICY_VERSION,
      source,
      user_agent: (event?.headers?.["user-agent"] || "").slice(0, 500) || null,
      country: countryOf(event),
    });
    return { ok: true, host: h, expiresAt };
  } catch (err) {
    console.error("[DatIQ] scrape consent upsert threw:", err.message);
    return { ok: false, error: "Could not record your confirmation. Please try again." };
  }
}

/**
 * Withdraw an attestation. Consent you cannot revoke is not consent, so this
 * is a first-class operation, not an admin-only cleanup.
 * Returns { ok, host, error }.
 */
export async function withdrawScrapeConsent(userId, host, event, env = process.env) {
  const h = normalizeConsentHost(host);
  if (!userId) return { ok: false, error: "Authentication required" };
  if (!h) return { ok: false, error: "A valid host is required" };
  const db = serviceDb(env);
  if (!db) return { ok: false, error: "Consent storage is not configured" };

  try {
    const qs = new URLSearchParams({ user_id: `eq.${userId}`, host: `eq.${h}` });
    const res = await fetch(`${db.base}/scrape_consent_records?${qs}`, {
      method: "DELETE",
      headers: { ...db.headers, Prefer: "return=minimal" },
    });
    if (!res.ok) {
      console.error("[DatIQ] scrape consent delete failed:", res.status, await res.text());
      return { ok: false, error: "Could not withdraw your confirmation. Please try again." };
    }
    await writeAudit(db, {
      user_id: userId,
      host: h,
      action: "withdrawn",
      policy_version: SCRAPE_CONSENT_POLICY_VERSION,
      source: "withdrawal",
      user_agent: (event?.headers?.["user-agent"] || "").slice(0, 500) || null,
      country: countryOf(event),
    });
    return { ok: true, host: h };
  } catch (err) {
    console.error("[DatIQ] scrape consent delete threw:", err.message);
    return { ok: false, error: "Could not withdraw your confirmation. Please try again." };
  }
}

/** List a user's unexpired attestations (for an account-settings surface). */
export async function listScrapeConsents(userId, env = process.env) {
  if (!userId) return { rows: [], degraded: false };
  const db = serviceDb(env);
  if (!db) return { rows: [], degraded: true };
  try {
    const qs = new URLSearchParams({
      select: "host,granted_at,expires_at,policy_version",
      user_id: `eq.${userId}`,
      expires_at: `gt.${new Date().toISOString()}`,
      order: "granted_at.desc",
    });
    const res = await fetch(`${db.base}/scrape_consent_records?${qs}`, { headers: db.headers });
    if (!res.ok) return { rows: [], degraded: true };
    return { rows: await res.json(), degraded: false };
  } catch {
    return { rows: [], degraded: true };
  }
}

export const _internal = { serviceDb, countryOf, normalizeConsentHost };
