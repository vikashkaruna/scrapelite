// netlify/functions/lib/ruleStore.js — Data access for Native Signal Routing (PRD 5).
//
// Manages signal_rules and rule_executions audit records.

import { createClient } from "@supabase/supabase-js";
import { validateScope, replaceRuleSources, sourcesForRules } from "./ruleSources.js";
import { evaluateSignalRule, formatActionPayload } from "../../../src/lib/rules/ruleModel.js";
import { isPublicHttpUrlAsync } from "./publicUrl.js";
import { statusFor, nextRetryAt } from "../../../src/lib/rules/retryModel.js";

const _localRules = new Map();
const _localExecutions = new Map();

// Every query below runs under the SERVICE key, which bypasses RLS. A missing
// user id must therefore be a refusal, never an unfiltered query: `if (userId)
// q = q.eq("user_id", userId)` returned EVERY user's rules — including the
// Slack webhook URLs and HubSpot tokens held in `action_config` — to an
// unauthenticated caller. Ownership is asserted here as well as in the handler
// so a future caller cannot reintroduce the hole by forgetting the 401.
const NO_OWNER = { ok: false, reason: "unauthenticated", status: 401 };
const ownerless = (userId) => !userId || typeof userId !== "string";

export function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}


// A signal rule stores a destination the server will POST to when the rule
// fires. Anything a user can put here becomes a server-issued request, so it is
// validated at WRITE time, using the same SSRF guard `extract.js` applies to
// scrape targets: private ranges, link-local, loopback and non-http schemes are
// all refused. Validating at write time rather than dispatch time means a
// malicious destination can never sit dormant in the table waiting for the
// dispatcher to be built.
//
// Slack is additionally pinned to its own webhook host — a "Slack" rule that
// posts anywhere else is either a mistake or an exfiltration channel wearing a
// Slack label, and the UI offers no reason to want one.
const SLACK_WEBHOOK_HOST = "hooks.slack.com";

export async function validateActionConfig(actionType, actionConfig = {}) {
  const cfg = actionConfig && typeof actionConfig === "object" ? actionConfig : {};
  const type = actionType || "slack";

  if (type === "email") {
    const to = String(cfg.to || cfg.email || "").trim();
    // Deliberately permissive on shape, strict on injection: a header-splitting
    // newline in a recipient is the only thing that turns this into a relay.
    if (!to || /[\r\n]/.test(to) || !to.includes("@")) {
      return { ok: false, reason: "A valid recipient email address is required." };
    }
    return { ok: true };
  }

  // Slack routed through the user's stored connection carries no URL in the
  // rule body — same posture as hubspot below, and for the same reason: a
  // webhook URL is a secret, and asking a user to paste one into a rule form
  // both leaks it into every read of that rule and makes "is Slack connected?"
  // unanswerable. The URL is resolved at dispatch from integration_connections.
  if (type === "slack" && cfg.use_connection === true) {
    return { ok: true };
  }

  if (type === "hubspot") {
    // No caller-supplied URL: the HubSpot destination is resolved server-side
    // from the workspace's stored connection, never from the rule body.
    return { ok: true };
  }

  const url = String(cfg.url || cfg.webhook_url || cfg.webhookUrl || "").trim();
  if (!url) return { ok: false, reason: "A destination URL is required for this action." };

  // Two things matter about which guard is used here.
  //
  // (1) `isPublicHttpUrl` has a MIXED contract despite its JSDoc: it THROWS for
  //     a bad scheme or malformed input but RETURNS FALSE for a private IP. A
  //     caller that only wraps it in try/catch silently accepts
  //     http://169.254.169.254/ — the cloud instance-metadata endpoint, the
  //     highest-value SSRF target there is. Both channels are handled below.
  //
  // (2) The ASYNC variant is the correct one here. The sync guard's own comment
  //     says it treats any hostname as public and leaves DNS to the async path.
  //     A destination is stored once and POSTed to repeatedly, so a hostname
  //     the attacker controls (resolving to 127.0.0.1) must be resolved now.
  //     `extract.js` reaches for the same variant for the same reason.
  let safe = false;
  try {
    safe = await isPublicHttpUrlAsync(url);
  } catch (e) {
    return { ok: false, reason: `Destination URL rejected: ${e.message}` };
  }
  if (!safe) {
    return {
      ok: false,
      reason: "Destination URL rejected: it resolves to a private or reserved address.",
    };
  }

  if (type === "slack") {
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { host = ""; }
    if (host !== SLACK_WEBHOOK_HOST) {
      return { ok: false, reason: `A Slack action must post to ${SLACK_WEBHOOK_HOST}.` };
    }
  }

  return { ok: true };
}

export async function listRules(userId, env = process.env) {
  if (ownerless(userId)) return { ...NO_OWNER, rules: [] };

  const db = serviceDb(env);
  if (!db) {
    const list = Array.from(_localRules.values()).filter((r) => r.user_id === userId);
    return { ok: true, rules: list };
  }

  const { data, error } = await db
    .from("signal_rules")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, reason: error.message, rules: [] };
  const rules = data || [];
  // Each rule carries the lists/watchlists it is linked to (0085).
  const sources = await sourcesForRules(db, userId, rules.map((r) => r.id));
  return { ok: true, rules: rules.map((r) => ({ ...r, source_scope: r.source_scope || "all", sources: sources[r.id] || [] })) };
}

export async function createRule(userId, { name, trigger_source, conditions = [], action_type, action_config = {}, source_scope = "all", sources = [] }, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;

  // A rule's action_config carries an outbound destination the server will
  // later POST to. Validate it at write time: an unchecked URL here is a
  // stored SSRF primitive, and the repo already owns the guard that stops it.
  const destination = await validateActionConfig(action_type, action_config);
  if (!destination.ok) return { ok: false, reason: destination.reason, status: 400 };

  const db = serviceDb(env);
  const ruleId = "rule_" + Math.random().toString(36).slice(2, 10);
  const now = new Date().toISOString();

  if (!db) {
    const rule = {
      id: ruleId,
      user_id: userId,
      name: name || "Signal Rule",
      status: "active",
      trigger_source: trigger_source || "watchlist",
      conditions,
      action_type: action_type || "slack",
      action_config,
      source_scope: "all",
      sources: [],
      created_at: now,
      updated_at: now,
    };
    _localRules.set(ruleId, rule);
    return { ok: true, rule };
  }

  // Which lists/watchlists this rule listens to (0085). Checked before the rule
  // exists, so a bad source never leaves a half-made rule behind.
  const scope = await validateScope(db, userId, trigger_source, source_scope, sources);
  if (!scope.ok) return scope;

  const { data, error } = await db
    .from("signal_rules")
    .insert({
      user_id: userId,
      name,
      trigger_source,
      conditions,
      action_type,
      action_config,
      status: "active",
      source_scope: scope.scope,
    })
    .select()
    .single();

  if (error) return { ok: false, reason: error.message };
  if (scope.sources.length) {
    const linked = await replaceRuleSources(db, userId, data.id, scope.sources);
    if (!linked.ok) {
      await db.from("signal_rules").delete().eq("id", data.id).eq("user_id", userId);
      return { ok: false, reason: "Could not link the chosen sources.", status: 500 };
    }
  }
  return { ok: true, rule: { ...data, sources: scope.sources } };
}

export async function updateRule(userId, ruleId, updates = {}, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;

  if (updates.action_type || updates.action_config) {
    const destination = await validateActionConfig(updates.action_type, updates.action_config);
    if (!destination.ok) return { ok: false, reason: destination.reason, status: 400 };
  }

  const db = serviceDb(env);
  const now = new Date().toISOString();

  if (!db) {
    const existing = _localRules.get(ruleId);
    if (!existing || existing.user_id !== userId) {
      return { ok: false, reason: "Rule not found or unauthorized", status: 404 };
    }
    const updated = {
      ...existing,
      ...updates,
      updated_at: now,
    };
    _localRules.set(ruleId, updated);
    return { ok: true, rule: updated };
  }

  const payload = {
    ...updates,
    updated_at: now,
  };
  delete payload.id;
  delete payload.user_id;
  delete payload.sources;
  delete payload.paused_reason; // the platform's field, never the client's

  const { data: current, error: readErr } = await db
    .from("signal_rules").select("*").eq("id", ruleId).eq("user_id", userId).maybeSingle();
  if (readErr) return { ok: false, reason: readErr.message };
  if (!current) return { ok: false, reason: "Rule not found or unauthorized", status: 404 };

  // Scope / sources change (0085). Validated against the rule's (possibly new)
  // trigger before anything is written.
  let newSources = null;
  const scopeChange = "source_scope" in updates || "sources" in updates || "trigger_source" in updates;
  if (scopeChange) {
    const trigger = updates.trigger_source || current.trigger_source;
    const scopeName = updates.source_scope || current.source_scope || "all";
    let requested = updates.sources;
    if (requested === undefined && scopeName === "selected") {
      requested = (await sourcesForRules(db, userId, [ruleId]))[ruleId] || [];
    }
    const scope = await validateScope(db, userId, trigger, scopeName, requested || []);
    if (!scope.ok) return scope;
    payload.source_scope = scope.scope;
    newSources = scope.sources;
  }

  // Resuming a rule the platform paused for lack of sources: allowed only once
  // it has sources again (or listens to all), and it clears the reason.
  if (updates.status === "active") {
    const scopeName = payload.source_scope || current.source_scope || "all";
    const count = newSources ? newSources.length
      : ((await sourcesForRules(db, userId, [ruleId]))[ruleId] || []).length;
    if (scopeName === "selected" && count === 0) {
      return { ok: false, status: 409, code: "no_sources", reason: "Link at least one source before resuming this rule, or let it listen to all of them." };
    }
    payload.paused_reason = null;
  }

  // Order matters for the 0085 pause trigger: links are added before the rule
  // is saved, and removed only after a switch to 'all' is saved.
  if (newSources?.length) {
    const linked = await replaceRuleSources(db, userId, ruleId, newSources);
    if (!linked.ok) return { ok: false, reason: "Could not link the chosen sources.", status: 500 };
  }

  const { data, error } = await db
    .from("signal_rules")
    .update(payload)
    .eq("id", ruleId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) return { ok: false, reason: error.message };
  if (newSources && newSources.length === 0) {
    const cleared = await replaceRuleSources(db, userId, ruleId, []);
    if (!cleared.ok) return { ok: false, reason: "Could not remove the old sources.", status: 500 };
  }
  const sources = newSources || (await sourcesForRules(db, userId, [ruleId]))[ruleId] || [];
  return { ok: true, rule: { ...data, sources } };
}

export async function deleteRule(ruleId, userId, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;

  const db = serviceDb(env);
  if (!db) {
    const existing = _localRules.get(ruleId);
    // Silent success on a rule you do not own, so ids cannot be enumerated by
    // watching for a different error — the rule templates.js already follows.
    if (existing && existing.user_id === userId) _localRules.delete(ruleId);
    return { ok: true };
  }

  const { error } = await db
    .from("signal_rules")
    .delete()
    .eq("id", ruleId)
    .eq("user_id", userId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export function testRuleWithPayload(rule, samplePayload) {
  const evalResult = evaluateSignalRule(rule, samplePayload);
  const formattedPayload = evalResult.matches ? formatActionPayload(rule, samplePayload) : null;
  return {
    matches: evalResult.matches,
    reasons: evalResult.reasons,
    formattedPayload,
  };
}

/**
 * Record one dispatch attempt.
 *
 * `attempt` and the retry schedule are computed HERE rather than by the caller,
 * so every writer gets the same policy. A retryable failure is stored as
 * `retrying` with a due time; anything terminal is stored as it happened.
 */
export async function recordExecution(ruleId, userId, { status, eventPayload, actionResponse, error = null, latencyMs = 0, attempt = 1, httpStatus = null }, env = process.env) {
  const outcome = { status, httpStatus };
  const storedStatus = statusFor(outcome, attempt);
  const dueAt = nextRetryAt(outcome, attempt);

  const db = serviceDb(env);
  const now = new Date().toISOString();

  if (!db) {
    const execId = "exec_" + Math.random().toString(36).slice(2, 10);
    const exec = {
      id: execId,
      rule_id: ruleId,
      user_id: userId,
      status: storedStatus,
      event_payload: eventPayload,
      action_response: actionResponse,
      error,
      latency_ms: latencyMs,
      attempt,
      next_retry_at: dueAt,
      executed_at: now,
    };
    _localExecutions.set(execId, exec);
    return { ok: true, execution: exec };
  }

  const { data, error: dbErr } = await db
    .from("rule_executions")
    .insert({
      rule_id: ruleId,
      user_id: userId,
      status: storedStatus,
      event_payload: eventPayload,
      action_response: actionResponse,
      error,
      latency_ms: latencyMs,
      attempt,
      next_retry_at: dueAt,
    })
    .select()
    .single();

  if (dbErr) return { ok: false, reason: dbErr.message };
  return { ok: true, execution: data };
}

export async function listExecutions(userId, { limit = 50 } = {}, env = process.env) {
  const db = serviceDb(env);
  if (!db) {
    const list = Array.from(_localExecutions.values())
      .filter((e) => !userId || e.user_id === userId)
      .sort((a, b) => new Date(b.executed_at || 0) - new Date(a.executed_at || 0))
      .slice(0, limit);
    return { ok: true, executions: list };
  }

  const { data, error } = await db
    .from("rule_executions")
    .select("id, rule_id, user_id, status, event_payload, action_response, error, latency_ms, attempt, executed_at")
    .eq("user_id", userId)
    .order("executed_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false, reason: error.message, executions: [] };
  return { ok: true, executions: data || [] };
}

