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

export async function createRule({ name, trigger_source, conditions, action_type, action_config }) {
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
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to create signal rule: ${res.status}`);
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
    throw new Error(body.error || `Failed to update signal rule: ${res.status}`);
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
