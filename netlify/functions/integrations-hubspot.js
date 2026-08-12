// netlify/functions/integrations-hubspot.js
//
// F-INT-2 — HubSpot CRM push endpoint.
//
// POST /api/integrations/hubspot/push
//   Body: { extraction: { ... } }
//   Auth: Supabase JWT (same as /api/extractions)
//   Effect: pushes the extraction's company + contacts to HubSpot using
//           the user's stored HubSpot access token.
//
// GET    /api/integrations/hubspot/status
//   Returns whether the user has connected HubSpot, the connected account
//   label, and a token hint. Never returns the access token.
//
// POST   /api/integrations/hubspot/connect
//   Body: { accessToken: "pat-na1-...", accountLabel?: "ACME Hub" }
//   Effect: stores the HubSpot Private App access token. v1 doesn't do
//           OAuth — users paste a Private App token in the Account UI. v1.1
//           will add the full OAuth flow.
//
// PATCH  /api/integrations/hubspot/connect
//   Body: { accountLabel?: "..." }
//   Effect: rename the connection. Token rotation requires a full
//           re-paste through POST /connect.
//
// DELETE /api/integrations/hubspot/connect
//   Effect: disconnects HubSpot (removes the stored token).
//
// POST   /api/integrations/hubspot/test
//   Effect: probe the stored access token against the CRM API. Returns
//           { ok, portalId? } on success, or an error if the PAT was
//           revoked.

import { createClient } from "@supabase/supabase-js";
import {
  pushExtractionToHubSpot,
  DEFAULT_CONTACT_MAPPING,
  DEFAULT_COMPANY_MAPPING,
} from "./lib/hubspotService.js";
import {
  getConnection,
  upsertConnection,
  deleteConnection,
} from "./lib/integrationConnectionStore.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

function getSupabaseForUser(authHeader) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
    auth: { persistSession: false },
  });
}

async function readJsonBody(event) {
  if (!event.body) return {};
  if (event.isBase64Encoded) {
    return JSON.parse(Buffer.from(event.body, "base64").toString("utf8"));
  }
  return JSON.parse(event.body);
}

// Return a short, non-secret hint of an opaque token — just the last
// 4 chars. Safe to ship to the browser; doesn't help an attacker
// reconstruct the full token. Used by /status so the Account UI can
// show "pat-na1-…-xQ7z" without ever receiving the full PAT.
function tokenHint(token) {
  if (!token || typeof token !== "string") return null;
  const tail = token.slice(-4);
  if (token.length <= 4) return tail;
  // Show first 7 + ellipsis + last 4, mirroring GitHub / Stripe's
  // convention for PAT display.
  return `${token.slice(0, 7)}…${tail}`;
}

async function authenticateRequest(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader) {
    return { ok: false, response: respond(401, { error: "Authentication required" }) };
  }
  // Extract the raw JWT — supabase-js v2.108+ returns AuthSessionMissingError
  // when `getUser()` is called on a client with no session and no
  // `hasCustomAuthorizationHeader: true` flag, EVEN IF the global Authorization
  // header is set. Passing the JWT directly is the documented server-side
  // pattern and bypasses the flag check entirely (the request still sends
  // the `Authorization: Bearer <jwt>` header to /auth/v1/user).
  // — fix 2026-08-12, "Invalid or expired session" on every integration
  // connect modal click.
  const jwt = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim();
  if (!jwt) {
    return { ok: false, response: respond(401, { error: "Authentication required" }) };
  }
  const supabase = getSupabaseForUser(authHeader);
  if (!supabase) {
    return { ok: false, response: respond(503, { error: "Supabase not configured" }) };
  }
  const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !user) {
    return { ok: false, response: respond(401, { error: "Invalid or expired session" }) };
  }
  return { ok: true, user };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // Path: /integrations/hubspot/{status|connect|push}
  // Netlify routing: this function is mounted at /api/integrations/hubspot/*
  // Resolve the sub-path from THREE sources, in priority order:
  //   1. body.action          — sent by the Account UI (2026-08-10 fix)
  //   2. event.queryStringParameters.splat — original Netlify redirect form
  //   3. event.path tail      — fallback for path-based routing
  // The body form is the only reliable one in production (Netlify is dropping
  // the URL sub-path on this branch deploy), but the other two are kept for
  // backward compatibility with curl tests and other clients.
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* ignore */ }
  const splatFromBody = (body && typeof body.action === "string") ? body.action : "";
  const splatFromQuery = event.queryStringParameters?.splat || "";
  const fnName = "/.netlify/functions/integrations-hubspot";
  const tail = (event.path || "").startsWith(fnName)
    ? (event.path || "").slice(fnName.length).replace(/^\/+/, "")
    : "";
  const splat = splatFromBody || splatFromQuery || tail;
  const subPath = splat.split("/").filter(Boolean);

  // Authenticate every request
  const auth = await authenticateRequest(event);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  try {
    // GET /api/integrations/hubspot/status
    if (event.httpMethod === "GET" && (subPath.length === 0 || subPath[0] === "status")) {
      const r = await getConnection({ userId, provider: "hubspot" });
      if (!r.ok) return respond(500, { error: r.error });
      if (!r.connection) {
        return respond(200, { connected: false, provider: "hubspot" });
      }
      // Never return the access_token. We DO return a short hint
      // (last 4 chars of the token) so the Account UI can show
      // "pat-na1-…-xQ7z" without leaking anything useful.
      const { access_token, refresh_token, ...safe } = r.connection;
      return respond(200, {
        connected: true,
        provider: "hubspot",
        connection: {
          ...safe,
          token_hint: tokenHint(access_token),
        },
      });
    }

    // POST /api/integrations/hubspot/connect
    if (event.httpMethod === "POST" && subPath[0] === "connect") {
      const body = await readJsonBody(event);
      const accessToken = body?.accessToken;
      if (!accessToken || typeof accessToken !== "string" || accessToken.length < 20) {
        return respond(400, { error: "accessToken is required (paste it from your HubSpot Private App)." });
      }
      // Probe HubSpot to confirm the token works. v1 doesn't validate
      // scopes; users grant whatever they need in the Private App.
      let probe;
      try {
        probe = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (err) {
        return respond(502, { error: `HubSpot probe failed: ${err.message}` });
      }
      if (!probe.ok) {
        return respond(400, { error: `HubSpot rejected the token (status ${probe.status}).` });
      }
      const r = await upsertConnection({
        userId,
        provider: "hubspot",
        fields: {
          access_token: accessToken,
          account_label: body.accountLabel || "HubSpot",
        },
      });
      if (!r.ok) return respond(500, { error: r.error });
      return respond(200, { ok: true, connected: true });
    }

    // DELETE /api/integrations/hubspot/connect
    // Disconnect is the only DELETE endpoint for HubSpot; route it
    // regardless of the sub-path (the body.action source only applies
    // to POST; DELETE is unambiguous).
    if (event.httpMethod === "DELETE") {
      const r = await deleteConnection({ userId, provider: "hubspot" });
      if (!r.ok) return respond(500, { error: r.error });
      return respond(200, { ok: true, connected: false });
    }

    // PATCH /api/integrations/hubspot/connect
    // Partial update. Only accountLabel is accepted — token rotation
    // requires a full re-paste through POST /connect. We do NOT probe
    // HubSpot on PATCH because nothing about the probe would have
    // changed (we're not touching the token).
    if (event.httpMethod === "PATCH" && subPath[0] === "connect") {
      const body = await readJsonBody(event);
      const fields = {};
      if (typeof body?.accountLabel === "string" && body.accountLabel.trim()) {
        fields.account_label = body.accountLabel.trim();
      }
      if (Object.keys(fields).length === 0) {
        return respond(400, { error: "No updatable fields supplied. Use { accountLabel }." });
      }
      const r = await upsertConnection({ userId, provider: "hubspot", fields });
      if (!r.ok) return respond(500, { error: r.error });
      return respond(200, { ok: true, connected: true });
    }

    // POST /api/integrations/hubspot/test
    // Probe the stored access token by calling a cheap read endpoint
    // (GET /crm/v3/objects/contacts?limit=1). Returns the portal ID on
    // success so the Account UI can show "Connected to HubSpot ID 12345".
    if (event.httpMethod === "POST" && subPath[0] === "test") {
      const conn = await getConnection({ userId, provider: "hubspot", includeSecrets: true });
      if (!conn.ok) return respond(500, { error: conn.error });
      if (!conn.connection) return respond(412, { error: "HubSpot is not connected. Set it up in Account → Integrations." });
      const accessToken = conn.connection.access_token;
      if (!accessToken) return respond(412, { error: "HubSpot access token is missing. Reconnect in Account → Integrations." });
      let probe;
      try {
        probe = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (err) {
        return respond(502, { error: `HubSpot probe failed: ${err.message}` });
      }
      if (!probe.ok) {
        // HubSpot returns 401 when the PAT is revoked. Surface that as a
        // clear "reconnect" hint instead of the raw status.
        if (probe.status === 401) {
          return respond(401, { error: "HubSpot rejected the token (401). The Private App may have been revoked or its scopes changed. Reconnect in Account → Integrations." });
        }
        return respond(502, { error: `HubSpot returned ${probe.status}.` });
      }
      // Hit /account-info/v1/details to get the portal ID — a separate
      // cheap call so the Account UI can show "Connected to Hub ID 12345".
      let portalId = null;
      try {
        const r2 = await fetch("https://api.hubapi.com/account-info/v1/details", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (r2.ok) {
          const info = await r2.json().catch(() => ({}));
          portalId = info?.portalId || null;
        }
      } catch { /* non-fatal */ }
      return respond(200, { ok: true, portalId });
    }

    // POST /api/integrations/hubspot/push
    if (event.httpMethod === "POST" && subPath[0] === "push") {
      const body = await readJsonBody(event);
      const extraction = body?.extraction;
      if (!extraction || typeof extraction !== "object") {
        return respond(400, { error: "extraction is required" });
      }
      // Look up the user's token
      const conn = await getConnection({ userId, provider: "hubspot", includeSecrets: true });
      if (!conn.ok) return respond(500, { error: conn.error });
      if (!conn.connection) {
        return respond(412, { error: "HubSpot is not connected. Connect it in Account → Integrations first." });
      }
      const accessToken = conn.connection.access_token;
      if (!accessToken) {
        return respond(412, { error: "HubSpot access token is missing. Reconnect in Account → Integrations." });
      }
      // Field mapping override (user-edited in the Account UI)
      const contactMapping = body?.contactMapping || DEFAULT_CONTACT_MAPPING;
      const companyMapping = body?.companyMapping || DEFAULT_COMPANY_MAPPING;
      const result = await pushExtractionToHubSpot(extraction, {
        accessToken,
        contactMapping,
        companyMapping,
      });
      return respond(200, result);
    }

    return respond(404, { error: `No such endpoint: /integrations/hubspot/${subPath.join("/")} (${event.httpMethod})` });
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
