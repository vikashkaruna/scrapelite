// netlify/functions/scrape-consent.js
//
// The record behind "I have permission to scrape this site".
//
// DatIQ honours robots.txt by default. When a host disallows us, /api/extract
// refuses — and for a SIGNED-IN caller it says the refusal is overridable. This
// endpoint is how that override is made, read and revoked.
//
// Endpoints (via the /api/* → /.netlify/functions/:splat rule in netlify.toml):
//
//   POST   /api/scrape-consent      Body: { host, source? }
//     Records the attestation for the JWT's user. Idempotent — re-attesting
//     renews the 180-day expiry and appends a fresh audit row.
//
//   GET    /api/scrape-consent?host=…
//     Is there an unexpired attestation? Omit `host` to list them all.
//
//   DELETE /api/scrape-consent?host=…
//     Withdraws it. Consent you cannot revoke is not consent, so this is a
//     first-class operation and not an admin-only cleanup.
//
// ⚠️ SECURITY — the two rules that make this an override and not a bypass:
//
//   1. user_id is ALWAYS resolved from the Authorization JWT, NEVER from the
//      request body. Same class of bug as verify-payment.js once trusting a
//      client-supplied planId: a caller that could name its own user_id could
//      forge somebody else's permission.
//
//   2. There is no "consented" flag on /api/extract. The extract path re-reads
//      this record server-side on every request. A flag a client can set is not
//      an attestation — it is a query parameter that turns compliance off, which
//      is exactly what FD3 exists to prevent.
//
// ⚠️ GUESTS ARE REFUSED, on purpose. An attestation moves responsibility for a
// scrape onto the person making it, and an anonymous cookie is nobody to move
// it to — it can be cleared and re-made without limit. See the header of
// supabase/migrations/0028_scrape_consent.sql.

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import {
  grantScrapeConsent,
  withdrawScrapeConsent,
  hasScrapeConsent,
  listScrapeConsents,
  normalizeConsentHost,
  SCRAPE_CONSENT_POLICY_VERSION,
  CONSENT_TTL_DAYS,
} from "./lib/scrapeConsent.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const VALID_SOURCES = new Set(["extract_refusal", "settings"]);

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // Every method here needs a real, verified identity. There is no degraded
  // or guest path: failing to identify the caller means we cannot attribute
  // the attestation, and an unattributable attestation is worthless.
  const auth = await authenticateBearer(event, { label: "scrape-consent" });
  if (!auth.ok) {
    return respond(auth.status || 401, auth.body || { error: "Authentication required" });
  }
  const userId = auth.user.id;

  if (event.httpMethod === "GET") {
    const host = event.queryStringParameters?.host || "";
    if (!host) {
      const { rows, degraded } = await listScrapeConsents(userId);
      return respond(200, { ok: true, consents: rows, degraded });
    }
    const normalized = normalizeConsentHost(host);
    if (!normalized) return respond(400, { error: "A valid host is required" });
    const { granted, expiresAt, degraded } = await hasScrapeConsent(userId, normalized);
    return respond(200, { ok: true, host: normalized, granted, expiresAt, degraded });
  }

  if (event.httpMethod === "POST") {
    let body = {};
    try { body = event.body ? JSON.parse(event.body) : {}; }
    catch { return respond(400, { error: "Invalid JSON body" }); }

    const normalized = normalizeConsentHost(body.host);
    if (!normalized) return respond(400, { error: "A valid host is required" });

    // `confirmed` must be explicitly true. The UI gates its button on a
    // checkbox; this is the server-side half of the same requirement, so a
    // mis-wired client cannot attest on someone's behalf by accident.
    if (body.confirmed !== true) {
      return respond(400, { error: "You must confirm you have permission to extract this site." });
    }

    const source = VALID_SOURCES.has(body.source) ? body.source : "extract_refusal";
    const result = await grantScrapeConsent(userId, normalized, event, source);
    if (!result.ok) return respond(502, { error: result.error });
    return respond(200, {
      ok: true,
      host: result.host,
      expiresAt: result.expiresAt,
      policyVersion: SCRAPE_CONSENT_POLICY_VERSION,
      ttlDays: CONSENT_TTL_DAYS,
    });
  }

  if (event.httpMethod === "DELETE") {
    const host = event.queryStringParameters?.host || "";
    const normalized = normalizeConsentHost(host);
    if (!normalized) return respond(400, { error: "A valid host is required" });
    const result = await withdrawScrapeConsent(userId, normalized, event);
    if (!result.ok) return respond(502, { error: result.error });
    return respond(200, { ok: true, host: result.host, granted: false });
  }

  return respond(405, { error: "Method not allowed" });
};
