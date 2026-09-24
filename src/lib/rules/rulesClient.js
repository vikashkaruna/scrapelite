// src/lib/rules/rulesClient.js — Client SDK for Native Signal Routing (PRD 5).
//
// Manages if-this-then-that signal routing rules, payload testing, and integrations.

import { supabase } from "../supabaseClient.js";

async function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (!supabase) return headers;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore offline/missing auth */
  }
  return headers;
}

export async function listRules() {
  const headers = await authHeaders();
  const res = await fetch("/api/signal-rules", { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch signal rules: ${res.status}`);
  }
  return res.json();
}

/** An Error carrying the server's code and, for a 409 in_use, the rules. */
function apiError(body, fallback, status) {
  const e = new Error(body.error || fallback);
  e.status = status;
  e.code = body.code || null;
  e.rules = body.rules || [];
  return e;
}

export async function createRule({ name, trigger_source, conditions, action_type, action_config, source_scope = "all", sources = [] }) {
  const headers = await authHeaders();
  const res = await fetch("/api/signal-rules", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "create",
      name,
      trigger_source,
      conditions,
      action_type,
      action_config,
      source_scope,
      sources,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw apiError(body, `Failed to create signal rule: ${res.status}`, res.status);
  }
  return res.json();
}

export async function updateRule(ruleId, updates) {
  const headers = await authHeaders();
  const res = await fetch("/api/signal-rules", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "update",
      ruleId,
      updates,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw apiError(body, `Failed to update signal rule: ${res.status}`, res.status);
  }
  return res.json();
}

export async function deleteRule(ruleId) {
  const headers = await authHeaders();
  const res = await fetch("/api/signal-rules", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "delete", ruleId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to delete signal rule: ${res.status}`);
  }
  return res.json();
}

export async function testRule(rule, samplePayload) {
  const headers = await authHeaders();
  const res = await fetch("/api/signal-rules", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "test", rule, samplePayload }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to test signal rule: ${res.status}`);
  }
  return res.json();
}

/**
 * Send one real message to a destination the user is configuring, before the
 * rule is saved. Returns { ok, status, error, httpStatus } — `status` is the
 * dispatcher's own verdict, so a `refused` here means the destination failed
 * validation (SSRF guard, wrong Slack host) rather than simply not answering.
 */
export async function testDestination(action_type, action_config) {
  const headers = await authHeaders();
  const res = await fetch("/api/signal-rules", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "test_destination", action_type, action_config }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Could not test the destination (${res.status})`);
  return body;
}

/** Remove one list/watchlist from a rule. The last one pauses the rule. */
export async function unlinkSource(ruleId, sourceType, sourceId) {
  const headers = await authHeaders();
  const res = await fetch("/api/signal-rules", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "unlink_source", ruleId, sourceType, sourceId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(body, `Failed to unlink: ${res.status}`, res.status);
  return body;
}

/** The rules that listen to one list or watchlist ("Used by rules"). */
export async function rulesForSource(sourceType, sourceId) {
  const headers = await authHeaders();
  const res = await fetch("/api/signal-rules", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "rules_for_source", sourceType, sourceId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(body, `Failed to load rules: ${res.status}`, res.status);
  return body.rules || [];
}
