// src/lib/integrationsClient.js — client wrapper for the server-side
// integration endpoints on /api/integrations/*.
//
// The integration branch moved credentials server-side: the user connects
// once via /account#integrations (PAT + base/table/database IDs get stored
// in Supabase), and every subsequent push reuses those stored credentials
// via this wrapper.
//
// Four providers are push-style (HubSpot, Notion, Airtable, Slack). Slack
// is a notification channel — pushing posts ONE Block Kit message per
// item to the user's per-user webhook — but the user-facing affordance
// ("Push to Slack") lives in the same dropdown as the record-store
// providers, so it's included here. Zapier is event-driven (the dispatcher
// writes to zapier_events for polling) and is NOT in this list.
//
// Auth: every call uses the user's Supabase access token. We get it
// from `supabase.auth.getSession()` so we never store or refresh it
// ourselves. If the user is not signed in, every method throws an
// `Error("not_signed_in")` so callers can route to a sign-in modal.

import { supabase } from "./supabaseClient.js";

// The 5 push-style providers. Order = display order in the menu.
export const PUSH_PROVIDERS = [
  { slug: "hubspot",  name: "HubSpot",  icon: "trending-up",   desc: "Push company + contacts to your CRM" },
  { slug: "notion",   name: "Notion",   icon: "bookmark",      desc: "Create pages in a database" },
  { slug: "airtable", name: "Airtable", icon: "layers",        desc: "Add records to a base" },
  { slug: "zapier",   name: "Zapier",   icon: "share",         desc: "Push to Zapier webhook or connected Zap" },
  { slug: "slack",    name: "Slack",    icon: "message-square", desc: "Post a summary to your channel" },
];

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("not_signed_in");
  return session.access_token;
}

async function authedFetch(path, init = {}) {
  const token = await getAccessToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    // Same-origin by default, but explicit so the Edge Access
    // basic-auth cookie is guaranteed to travel with the request.
    credentials: "same-origin",
  });
  // Edge Access (Netlify's site-wide basic auth, used on branch
  // deploys) returns 401 with an HTML body that JS-redirects to
  // app.netlify.com/edge-access. If we don't detect that shape, the
  // old code set `body = { error: <huge HTML string> }` and the
  // user saw the raw HTML in the toast. Detect it and substitute a
  // clear message — same pattern as apiClient.request() (§20).
  // res.headers.get may be missing in some test mocks; treat that
  // as "no content-type known" and let the JSON path run.
  const getHeader = (h) =>
    typeof res.headers?.get === "function" ? res.headers.get(h) : "";
  const contentType = getHeader("content-type") || "";
  const isHtml = contentType.includes("text/html");
  // See apiClient.js: Edge Access is 401 + HTML. HTML alone is any Netlify
  // error page (timeout, crash, SPA catch-all) and must not be reported as a
  // sign-in problem the reader can do nothing about.
  const isEdgeAccess = isHtml && res.status === 401;
  let body = {};
  let edgeAccess = false;
  if (isEdgeAccess) {
    body = {
      error: "Site authentication required. Refresh the page and sign in again (the branch deploy uses Netlify Edge Access).",
    };
    edgeAccess = true;
  } else if (isHtml) {
    body = {
      error: res.status >= 500 || res.status === 0
        ? `The server did not complete this request (${res.status}). This is a problem on our side — try again shortly.`
        : `This request could not be reached (${res.status}). Please refresh and try again.`,
    };
  } else {
    const text = await res.text();
    if (text) {
      try { body = JSON.parse(text); } catch { body = { error: text }; }
    }
  }
  return { ok: res.ok, status: res.status, body, edgeAccess };
}

// Fetch the connection status of a single provider.
//   Returns one of:
//     { connected: false, error?, edgeAccess? }
//     { connected: true, connection: { has_token, account_label, database_id, ... } }
export async function getIntegrationStatus(slug) {
  try {
    const { ok, body, edgeAccess } = await authedFetch(`/api/integrations/${slug}/status`);
    if (!ok) {
      const r = { connected: false, error: body?.error || `status_unknown` };
      if (edgeAccess) r.edgeAccess = true;
      return r;
    }
    return body;
  } catch (err) {
    if (err?.message === "not_signed_in") return { connected: false, error: "not_signed_in" };
    return { connected: false, error: err?.message || "network" };
  }
}

// Fetch connection status for all 3 push providers in parallel.
//   Returns a map { hubspot: { connected, ... }, notion: ..., airtable: ... }
export async function getPushProviderStatuses() {
  const results = await Promise.all(
    PUSH_PROVIDERS.map(async (p) => [p.slug, await getIntegrationStatus(p.slug)])
  );
  return Object.fromEntries(results);
}

// Push a list of extractions to a provider.
//
// Per-provider shape:
//   HubSpot  — single item, called N times for an N-item list (server
//              endpoint takes { extraction }, not { items }).
//   Notion   — single call, body { items: [...] }, uses stored databaseId
//              and stored schema.
//   Airtable — single call, body { items: [...] }, uses stored baseId/tableId.
//   Slack    — single call, body { items: [...] }, server posts one
//              Block Kit message per item to the user's per-user webhook.
//
// Returns the aggregated server response:
//   { ok, pushed, total, errors: [...], failedRecords: [...] }
export async function pushToIntegration(slug, items) {

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "no_items", message: "No extractions to push." };
  }
  const clean = items.filter((x) => x && typeof x === "object");
  if (clean.length === 0) {
    return { ok: false, error: "no_items", message: "No valid extractions to push." };
  }

  try {
    if (slug === "hubspot") {
      // HubSpot takes one extraction at a time. Loop sequentially so we
      // surface per-row errors in failedRecords instead of failing the
      // whole batch on the first bad row. `action: "push"` in the body
      // is the §15/§16 dispatch-source fallback so the request still
      // routes to the hubspot handler's `push` sub-endpoint even when
      // Netlify's redirect engine drops the URL sub-path.
      const failedRecords = [];
      let pushed = 0;
      for (const item of clean) {
        const { ok, body } = await authedFetch(`/api/integrations/hubspot/push`, {
          method: "POST",
          body: JSON.stringify({ extraction: item, action: "push" }),
        });
        if (ok) {
          pushed += 1;
        } else {
          failedRecords.push({ url: item?.url, error: body?.error || "push_failed" });
        }
      }
      return {
        ok: failedRecords.length === 0,
        pushed,
        total: clean.length,
        errors: failedRecords.map((r) => r.error),
        failedRecords,
      };
    }

    if (slug === "notion" || slug === "airtable") {
      // `action: "push"` in the body is the §15/§16 dispatch-source
      // fallback so the request still routes to the provider's `push`
      // sub-endpoint even when Netlify's redirect engine drops the
      // URL sub-path on this branch deploy.
      const { ok, body, status } = await authedFetch(`/api/integrations/${slug}/push`, {
        method: "POST",
        body: JSON.stringify({ items: clean, action: "push" }),
      });
      if (!ok) {
        // The server returns 412 with `{ error: "<provider> is not
        // connected…" }` when the user hasn't set up this provider in
        // /account#integrations yet. Surface that as a structured
        // not_connected result so the Export modal can render a
        // "Set up <provider> in Account → Integrations" link instead
        // of a red error box. The Slack path below already does this;
        // Airtable/Notion were missing it, which made a missing
        // connection look like a hard push failure. 2026-08-11 fix.
        if (status === 412) {
          return {
            ok: false,
            pushed: 0,
            total: clean.length,
            errors: [body?.error || "not_connected"],
            failedRecords: [],
            message: body?.error || `${slug} is not connected.`,
            not_connected: true,
          };
        }
        return {
          ok: false,
          pushed: 0,
          total: clean.length,
          errors: [body?.error || "push_failed"],
          failedRecords: [],
          message: body?.error || "Push failed",
        };
      }
      return {
        ok: body.ok !== false,
        pushed: body.pushed ?? clean.length,
        total: body.total ?? clean.length,
        errors: body.errors || [],
        failedRecords: body.failedRecords || [],
      };
    }

    if (slug === "zapier") {
      const { ok, body, status } = await authedFetch(`/api/integrations/zapier/push`, {
        method: "POST",
        body: JSON.stringify({ items: clean, action: "push" }),
      });
      if (!ok) {
        if (status === 412) {
          return {
            ok: false,
            pushed: 0,
            total: clean.length,
            errors: [body?.error || "not_connected"],
            failedRecords: [],
            message: body?.error || "Zapier is not connected.",
            not_connected: true,
          };
        }
        return {
          ok: false,
          pushed: 0,
          total: clean.length,
          errors: [body?.error || "push_failed"],
          failedRecords: [],
          message: body?.error || "Push to Zapier failed",
        };
      }
      return {
        ok: body.ok !== false,
        pushed: body.pushed ?? clean.length,
        total: body.total ?? clean.length,
        errors: body.errors || [],
        failedRecords: body.failedRecords || [],
      };
    }

    if (slug === "slack") {
      // Slack: one POST with the full items list, server resolves the
      // user's per-user webhook and posts one Block Kit message per item.
      // Returns 412 with `{ error: "Slack is not connected…" }` when the
      // user hasn't set up Slack — we surface that as a special-case
      // error so the client can route to the setup page.
      //
      // `action: "send"` in the body is the §15/§16 dispatch-source
      // fallback. On the branch deploy, Netlify's redirect engine is
      // known to drop the URL sub-path on `/api/integrations/slack/*`
      // (so the function is called at `/.netlify/functions/integrations-slack`
      // with no `/send` tail). The handler's `splat` resolution reads
      // body.action FIRST, so the request still dispatches to handleSend.
      // Without this field, the user sees:
      //   "No such endpoint: /integrations/slack/ (POST) (splat="")"
      // which is the handler's 404 fallback when all three splat sources
      // (body / query / path) are empty.
      const { ok, body, status } = await authedFetch(`/api/integrations/slack/send`, {
        method: "POST",
        body: JSON.stringify({ items: clean, action: "send" }),
      });
      if (!ok) {
        if (status === 412) {
          return {
            ok: false,
            pushed: 0,
            total: clean.length,
            errors: [body?.error || "not_connected"],
            failedRecords: [],
            message: body?.error || "Slack is not connected.",
            not_connected: true,
          };
        }
        return {
          ok: false,
          pushed: 0,
          total: clean.length,
          errors: [body?.error || "push_failed"],
          failedRecords: [],
          message: body?.error || "Push failed",
        };
      }
      return {
        ok: body.ok !== false,
        pushed: body.sent ?? clean.length,
        total: body.total ?? clean.length,
        errors: body.errors || [],
        failedRecords: body.failedRecords || [],
      };
    }

    return { ok: false, error: "unsupported_provider", message: `Unknown provider: ${slug}` };
  } catch (err) {
    if (err?.message === "not_signed_in") {
      return { ok: false, error: "not_signed_in", message: "Sign in to push to integrations." };
    }
    return { ok: false, error: "network", message: err?.message || "Network error" };
  }
}

/**
 * Partial update of a connection (rename, change IDs, refresh schema).
 * Used by the ExportIntegrations modal when the user wants to:
 *   - rename the connection (accountLabel)
 *   - change Airtable Base/Table IDs (and re-fetch the schema)
 *   - refresh the Airtable field map (refreshSchema: true)
 *
 * Returns { ok, ...providerSpecific } on success or { ok: false, error }
 * on failure.
 */
export async function patchIntegrationConnection(slug, patch) {
  try {
    const { ok, body, status } = await authedFetch(`/api/integrations/${slug}/connect`, {
      method: "PATCH",
      body: JSON.stringify({ action: "connect", ...patch }),
    });
    if (!ok) {
      return { ok: false, error: body?.error || `HTTP ${status}` };
    }
    return { ok: true, ...body };
  } catch (err) {
    if (err?.message === "not_signed_in") {
      return { ok: false, error: "not_signed_in", message: "Sign in to update the connection." };
    }
    return { ok: false, error: "network", message: err?.message || "Network error" };
  }
}

/**
 * Test the connection — server uses the stored credentials to verify
 * the integration is still wired up correctly. Returns the test result
 * (e.g. for Airtable: { ok, tableName, fieldCount, matched, fieldMap }).
 */
export async function testIntegrationConnection(slug) {
  try {
    // Zapier's public `/test` endpoint is for the Zapier private app: it
    // requires the plaintext per-Zap token in X-Zapier-Token. The Account UI
    // intentionally never reads that token back after it is minted, so a
    // browser POST to `/test` cannot be a valid user-side connection check.
    // Confirm the stored connection through the authenticated status endpoint
    // instead. This also avoids calling `/test` with POST when Zapier exposes
    // that endpoint as GET only.
    if (slug === "zapier") {
      const status = await getIntegrationStatus(slug);
      if (!status?.connected) {
        return { ok: false, error: status?.error || "Zapier is not connected." };
      }
      return { ok: true };
    }

    const { ok, body, status } = await authedFetch(`/api/integrations/${slug}/test`, {
      method: "POST",
      body: JSON.stringify({ action: "test" }),
    });
    if (!ok) {
      return { ok: false, error: body?.error || `HTTP ${status}` };
    }
    return { ok: true, ...body };
  } catch (err) {
    if (err?.message === "not_signed_in") {
      return { ok: false, error: "not_signed_in", message: "Sign in to test the connection." };
    }
    return { ok: false, error: "network", message: err?.message || "Network error" };
  }
}

/**
 * Fetch all available tables for an Airtable base dynamically using stored credentials.
 */
export async function fetchAirtableTablesClient(baseId) {
  try {
    const { ok, body, status } = await authedFetch(
      baseId ? `/api/integrations/airtable/tables?baseId=${encodeURIComponent(baseId)}` : `/api/integrations/airtable/tables`,
      {
        method: "POST",
        body: JSON.stringify({ action: "tables", baseId }),
      }
    );
    if (!ok) {
      return { ok: false, error: body?.error || `HTTP ${status}` };
    }
    return { ok: true, tables: body.tables || [] };
  } catch (err) {
    if (err?.message === "not_signed_in") {
      return { ok: false, error: "not_signed_in", message: "Sign in to list Airtable tables." };
    }
    return { ok: false, error: "network", message: err?.message || "Network error" };
  }
}

/**
 * Create a new table in Airtable dynamically and optionally set it as active.
 */
export async function createAirtableTableClient({ baseId, tableName = "DatIQ Extractions", fields, setAsActive = true } = {}) {
  try {
    const { ok, body, status } = await authedFetch(`/api/integrations/airtable/create-table`, {
      method: "POST",
      body: JSON.stringify({ action: "create-table", baseId, tableName, fields, setAsActive }),
    });
    if (!ok) {
      return { ok: false, error: body?.error || `HTTP ${status}` };
    }
    return { ok: true, ...body };
  } catch (err) {
    if (err?.message === "not_signed_in") {
      return { ok: false, error: "not_signed_in", message: "Sign in to create an Airtable table." };
    }
    return { ok: false, error: "network", message: err?.message || "Network error" };
  }
}

