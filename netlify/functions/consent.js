// netlify/functions/consent.js
//
// The durable half of analytics consent. The browser keeps a localStorage copy
// for the synchronous read in <head> (public/analytics.js); this endpoint keeps
// the record that survives a cleared browser and answers "when did they agree,
// under which policy version, and from where?".
//
// Endpoints (via the /api/* → /.netlify/functions/:splat rule in netlify.toml):
//
//   POST /api/consent
//     Body: { analytics: "granted"|"denied", source?, policyVersion?,
//             sessionId?, gaClientId? }
//     Upserts the current record and appends an audit row.
//
//   GET  /api/consent?sessionId=…
//     Current record for a session (or for the JWT's user, if signed in).
//
//   POST /api/consent/link
//     Body: { sessionId }
//     Requires a JWT. Back-fills user_id onto the anonymous session's record,
//     which is how a pre-signup consent becomes traceable to a person.
//
//   POST /api/consent/withdraw
//     Body: { sessionId? }
//     Records a denial AND hard-deletes this subject's analytics_events rows.
//
// ⚠️ SECURITY: user_id is ALWAYS resolved from the Authorization JWT and NEVER
// read from the request body. A client that could name its own user_id could
// forge a consent record for somebody else — the same class of bug as
// verify-payment.js trusting a client-supplied planId.
//
// ⚠️ PRIVACY: no IP address is stored, ever. A coarse country is enough to
// reason about which regime applies, and collecting a full IP in order to prove
// that someone consented to analytics would defeat the point of asking.

import { authenticateBearer } from "./lib/supabaseServerClient.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const VALID_CHOICES = new Set(["granted", "denied"]);
const VALID_SOURCES = new Set(["banner", "privacy_page", "withdrawal", "link"]);
const DEFAULT_POLICY_VERSION = "2026-08-15";

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

function readJsonBody(event) {
  if (!event?.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function serviceHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * Coarse country only. Netlify exposes geo differently across contexts, so try
 * the known shapes and give up quietly — an unknown country is fine, a wrong
 * one is worse, and an IP is never acceptable.
 */
function countryOf(event) {
  const h = event?.headers || {};
  const direct = h["x-country"] || h["x-nf-country"];
  if (typeof direct === "string" && direct.length === 2) return direct.toUpperCase();
  const geo = h["x-nf-geo"];
  if (typeof geo === "string" && geo) {
    try {
      const decoded = JSON.parse(Buffer.from(geo, "base64").toString("utf8"));
      const code = decoded?.country?.code;
      if (typeof code === "string" && code.length === 2) return code.toUpperCase();
    } catch {
      /* not the base64-JSON shape */
    }
  }
  return null;
}

/** Truncated so a hostile or broken client can't write unbounded rows. */
function userAgentOf(event) {
  const ua = event?.headers?.["user-agent"];
  return typeof ua === "string" && ua ? ua.slice(0, 512) : null;
}

/**
 * Resolve the signed-in user, if any. Consent is explicitly allowed WITHOUT a
 * JWT — most consent is given before signup, and refusing anonymous visitors
 * would leave no record for the majority of them.
 */
async function optionalUser(event) {
  const hasAuth = !!(event?.headers?.authorization || event?.headers?.Authorization);
  if (!hasAuth) return null;
  const auth = await authenticateBearer(event, { label: "consent" });
  return auth.ok ? auth.user : null;
}

function subjectKeyFor(sessionId, userId) {
  if (sessionId) return `session:${sessionId}`;
  if (userId) return `user:${userId}`;
  return null;
}

async function pgFetch({ url, key }, path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, init);
  return res;
}

async function writeConsent(env, { subjectKey, sessionId, userId, analytics, policyVersion, gaClientId }) {
  const row = {
    subject_key: subjectKey,
    session_id: sessionId || subjectKey,
    user_id: userId || null,
    analytics,
    policy_version: policyVersion,
    updated_at: new Date().toISOString(),
  };
  // Only overwrite ga_client_id when we actually have one — a later consent
  // update from a browser where gtag failed to load must not blank out the id
  // captured earlier, or the GA-side deletion path loses its handle.
  if (gaClientId) row.ga_client_id = gaClientId;

  return pgFetch(env, "consent_records?on_conflict=subject_key", {
    method: "POST",
    headers: serviceHeaders(env.key, {
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify(row),
  });
}

async function appendAudit(env, { subjectKey, sessionId, userId, analytics, policyVersion, source, userAgent, country }) {
  return pgFetch(env, "consent_audit", {
    method: "POST",
    headers: serviceHeaders(env.key, { Prefer: "return=minimal" }),
    body: JSON.stringify({
      subject_key: subjectKey,
      session_id: sessionId || null,
      user_id: userId || null,
      analytics,
      policy_version: policyVersion,
      source,
      user_agent: userAgent,
      country,
    }),
  });
}

async function handleWrite(event, { source: forcedSource } = {}) {
  const env = serviceEnv();
  const body = readJsonBody(event);
  const user = await optionalUser(event);

  const analytics = String(body.analytics || "");
  if (!VALID_CHOICES.has(analytics)) {
    return respond(400, { error: "analytics must be 'granted' or 'denied'" });
  }

  const source = forcedSource || (VALID_SOURCES.has(body.source) ? body.source : "banner");
  const policyVersion = String(body.policyVersion || DEFAULT_POLICY_VERSION).slice(0, 64);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 128) : "";
  const gaClientId = typeof body.gaClientId === "string" ? body.gaClientId.slice(0, 128) : null;
  const userId = user?.id || null;

  const subjectKey = subjectKeyFor(sessionId, userId);
  if (!subjectKey) {
    return respond(400, { error: "sessionId is required for an anonymous consent record" });
  }

  // No database configured (local dev, or a deploy without the service key).
  // The visitor's choice still applies — it is already in localStorage and
  // already pushed to Consent Mode. Losing the audit copy must not surface as
  // an error over a cookie banner, so this is a soft 200 that says so.
  if (!env) {
    return respond(200, { ok: true, persisted: false, reason: "service_db_unconfigured" });
  }

  try {
    const res = await writeConsent(env, {
      subjectKey, sessionId, userId, analytics, policyVersion, gaClientId,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[consent] upsert failed", res.status, detail.slice(0, 300));
      return respond(502, { error: `Could not record consent (${res.status})` });
    }

    // Audit is best-effort relative to the record: if the append fails we still
    // report success, because the visitor's choice IS stored and honoured.
    // The failure is logged for the operator rather than shown to the user.
    const auditRes = await appendAudit(env, {
      subjectKey, sessionId, userId, analytics, policyVersion, source,
      userAgent: userAgentOf(event),
      country: countryOf(event),
    });
    if (!auditRes.ok) {
      console.error("[consent] audit append failed", auditRes.status);
    }

    return respond(200, { ok: true, persisted: true, subjectKey, analytics });
  } catch (err) {
    console.error("[consent] write threw", err?.message);
    return respond(502, { error: "Could not record consent" });
  }
}

async function handleRead(event) {
  const env = serviceEnv();
  if (!env) return respond(200, { ok: true, record: null, reason: "service_db_unconfigured" });

  const user = await optionalUser(event);
  const sessionId = event?.queryStringParameters?.sessionId || "";
  const subjectKey = subjectKeyFor(sessionId, user?.id);
  if (!subjectKey) return respond(400, { error: "sessionId is required" });

  // A signed-in user's record is looked up by user_id first, so the choice
  // follows them to a new device where the session id is different.
  const filter = user?.id
    ? `or=(user_id.eq.${user.id},subject_key.eq.${subjectKey})`
    : `subject_key=eq.${subjectKey}`;

  try {
    const res = await pgFetch(
      env,
      `consent_records?${filter}&select=analytics,policy_version,updated_at&order=updated_at.desc&limit=1`,
      { headers: serviceHeaders(env.key) },
    );
    if (!res.ok) return respond(502, { error: `Lookup failed (${res.status})` });
    const rows = await res.json();
    return respond(200, { ok: true, record: Array.isArray(rows) ? rows[0] || null : null });
  } catch (err) {
    console.error("[consent] read threw", err?.message);
    return respond(502, { error: "Lookup failed" });
  }
}

/**
 * Attach the now-known user to an anonymous session's consent record. Called by
 * AuthProvider on SIGNED_IN. Does NOT change the choice — linking an identity
 * to an existing decision is not the same act as making a new one, so it audits
 * with source 'link' and leaves `analytics` exactly as it was.
 */
async function handleLink(event) {
  const env = serviceEnv();
  const body = readJsonBody(event);
  const user = await optionalUser(event);
  if (!user) return respond(401, { error: "Authentication required" });

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 128) : "";
  if (!sessionId) return respond(400, { error: "sessionId is required" });
  if (!env) return respond(200, { ok: true, linked: false, reason: "service_db_unconfigured" });

  const subjectKey = `session:${sessionId}`;
  try {
    const res = await pgFetch(env, `consent_records?subject_key=eq.${encodeURIComponent(subjectKey)}`, {
      method: "PATCH",
      headers: serviceHeaders(env.key, { Prefer: "return=representation" }),
      body: JSON.stringify({ user_id: user.id, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) return respond(502, { error: `Link failed (${res.status})` });
    const rows = await res.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return respond(200, { ok: true, linked: false, reason: "no_record" });

    await appendAudit(env, {
      subjectKey,
      sessionId,
      userId: user.id,
      analytics: row.analytics,
      policyVersion: row.policy_version || DEFAULT_POLICY_VERSION,
      source: "link",
      userAgent: userAgentOf(event),
      country: countryOf(event),
    });

    return respond(200, { ok: true, linked: true });
  } catch (err) {
    console.error("[consent] link threw", err?.message);
    return respond(502, { error: "Link failed" });
  }
}

/**
 * Withdraw consent and erase this subject's analytics rows.
 *
 * Scope note, stated plainly here because the Privacy Policy states it too:
 * this deletes DatIQ's own analytics_events. Data already inside Google
 * Analytics needs Google's User Deletion API, which requires a Google Cloud
 * service account this project does not have — so that remains a manual
 * request in the GA4 admin UI, using the ga_client_id captured at consent time.
 */
async function handleWithdraw(event) {
  const env = serviceEnv();
  const body = readJsonBody(event);
  const user = await optionalUser(event);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 128) : "";

  if (!sessionId && !user?.id) {
    return respond(400, { error: "sessionId is required" });
  }
  if (!env) return respond(200, { ok: true, deleted: 0, reason: "service_db_unconfigured" });

  // Record the denial first. If the delete below fails we must not be left
  // having erased data while still showing consent as granted.
  // isBase64Encoded must be cleared alongside the body: the spread would carry
  // `true` over from the original request, and readJsonBody would then try to
  // base64-decode the plain JSON string below, silently yielding {} and a 400.
  const writeRes = await handleWrite(
    {
      ...event,
      isBase64Encoded: false,
      body: JSON.stringify({ ...body, analytics: "denied", sessionId }),
    },
    { source: "withdrawal" },
  );
  if (writeRes.statusCode >= 400) return writeRes;

  let deleted = 0;
  const targets = [];
  if (sessionId) targets.push(`session_id=eq.${encodeURIComponent(sessionId)}`);
  if (user?.id) targets.push(`user_id=eq.${user.id}`);

  try {
    for (const filter of targets) {
      const res = await pgFetch(env, `analytics_events?${filter}`, {
        method: "DELETE",
        headers: serviceHeaders(env.key, { Prefer: "return=representation" }),
      });
      if (!res.ok) {
        console.error("[consent] erase failed", res.status, filter);
        return respond(502, { error: `Could not erase analytics data (${res.status})` });
      }
      const rows = await res.json().catch(() => []);
      deleted += Array.isArray(rows) ? rows.length : 0;
    }
  } catch (err) {
    console.error("[consent] erase threw", err?.message);
    return respond(502, { error: "Could not erase analytics data" });
  }

  return respond(200, { ok: true, deleted });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  // /api/consent/withdraw arrives as /.netlify/functions/consent/withdraw.
  const fnName = "/.netlify/functions/consent";
  const tail = (event.path || "").startsWith(fnName)
    ? (event.path || "").slice(fnName.length).replace(/^\/+/, "")
    : "";
  const sub = (event.queryStringParameters?.splat || tail).split("/").filter(Boolean)[0] || "";

  try {
    if (event.httpMethod === "GET" && !sub) return await handleRead(event);
    if (event.httpMethod === "POST") {
      if (!sub) return await handleWrite(event);
      if (sub === "withdraw") return await handleWithdraw(event);
      if (sub === "link") return await handleLink(event);
    }
    return respond(404, { error: "Unknown consent endpoint" });
  } catch (err) {
    // Without this, a throw surfaces as an opaque Netlify 502 with no body —
    // the same failure mode integrations-zapier.js documents at its dispatch.
    console.error("[consent] unhandled", err?.message);
    return respond(500, { error: err?.message || "Internal error" });
  }
};
