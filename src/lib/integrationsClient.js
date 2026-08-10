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

// The 4 push-style providers. Order = display order in the menu.
// Slack comes last because it's the most "ephemeral" destination — a
// notification, not a record store — and the others are more common
// workflows for power users.
export const PUSH_PROVIDERS = [
  { slug: "hubspot",  name: "HubSpot",  icon: "trending-up",   desc: "Push company + contacts to your CRM" },
  { slug: "notion",   name: "Notion",   icon: "bookmark",      desc: "Create pages in a database" },
  { slug: "airtable", name: "Airtable", icon: "layers",        desc: "Add records to a base" },
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
  });
  const text = await res.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { body = { error: text }; }
  }
  return { ok: res.ok, status: res.status, body };
}

// Fetch the connection status of a single provider.
//   Returns one of:
//     { connected: false }
//     { connected: true, connection: { has_token, account_label, database_id, ... } }
export async function getIntegrationStatus(slug) {
  try {
    const { ok, body } = await authedFetch(`/api/integrations/${slug}/status`);
    if (!ok) return { connected: false, error: body?.error || `status_${status || "unknown"}` };
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
      // whole batch on the first bad row.
      const failedRecords = [];
      let pushed = 0;
      for (const item of clean) {
        const { ok, body } = await authedFetch(`/api/integrations/hubspot/push`, {
          method: "POST",
          body: JSON.stringify({ extraction: item }),
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
      const { ok, body } = await authedFetch(`/api/integrations/${slug}/push`, {
        method: "POST",
        body: JSON.stringify({ items: clean }),
      });
      if (!ok) {
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

    if (slug === "slack") {
      // Slack: one POST with the full items list, server resolves the
      // user's per-user webhook and posts one Block Kit message per item.
      // Returns 412 with `{ error: "Slack is not connected…" }` when the
      // user hasn't set up Slack — we surface that as a special-case
      // error so the client can route to the setup page.
      const { ok, body, status } = await authedFetch(`/api/integrations/slack/send`, {
        method: "POST",
        body: JSON.stringify({ items: clean }),
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
