// netlify/functions/lib/ruleStore.js — Data access for Native Signal Routing (PRD 5).
//
// Manages signal_rules and rule_executions audit records.

import { createClient } from "@supabase/supabase-js";
import { evaluateSignalRule, formatActionPayload } from "../../src/lib/rules/ruleModel.js";

const _localRules = new Map();
const _localExecutions = new Map();

export function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function listRules(userId, env = process.env) {
  const db = serviceDb(env);
  if (!db) {
    const list = Array.from(_localRules.values()).filter((r) => !userId || r.user_id === userId);
    return { ok: true, rules: list };
  }

  let q = db.from("signal_rules").select("*").order("created_at", { ascending: false });
  if (userId) q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error) return { ok: false, reason: error.message, rules: [] };
  return { ok: true, rules: data || [] };
}

export async function createRule(userId, { name, trigger_source, conditions = [], action_type, action_config = {} }, env = process.env) {
  const db = serviceDb(env);
  const ruleId = "rule_" + Math.random().toString(36).slice(2, 10);
  const now = new Date().toISOString();

  if (!db) {
    const rule = {
      id: ruleId,
      user_id: userId || "usr_demo",
      name: name || "Signal Rule",
      status: "active",
      trigger_source: trigger_source || "watchlist",
      conditions,
      action_type: action_type || "slack",
      action_config,
      created_at: now,
      updated_at: now,
    };
    _localRules.set(ruleId, rule);
    return { ok: true, rule };
  }

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
    })
    .select()
    .single();

  if (error) return { ok: false, reason: error.message };
  return { ok: true, rule: data };
}

export async function deleteRule(ruleId, userId, env = process.env) {
  const db = serviceDb(env);
  if (!db) {
    _localRules.delete(ruleId);
    return { ok: true };
  }

  let q = db.from("signal_rules").delete().eq("id", ruleId);
  if (userId) q = q.eq("user_id", userId);

  const { error } = await q;
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

export async function recordExecution(ruleId, userId, { status, eventPayload, actionResponse, error = null, latencyMs = 0 }, env = process.env) {
  const db = serviceDb(env);
  const now = new Date().toISOString();

  if (!db) {
    const execId = "exec_" + Math.random().toString(36).slice(2, 10);
    const exec = {
      id: execId,
      rule_id: ruleId,
      user_id: userId || "usr_demo",
      status,
      event_payload: eventPayload,
      action_response: actionResponse,
      error,
      latency_ms: latencyMs,
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
      status,
      event_payload: eventPayload,
      action_response: actionResponse,
      error,
      latency_ms: latencyMs,
    })
    .select()
    .single();

  if (dbErr) return { ok: false, reason: dbErr.message };
  return { ok: true, execution: data };
}
