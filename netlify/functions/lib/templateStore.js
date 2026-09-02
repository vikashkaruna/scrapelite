// netlify/functions/lib/templateStore.js — service-key data access for
// workflow_templates / template_runs / credit_ledger.
//
// Every table here is service-key-only by RLS (0036/0037), so this module is
// the ONLY way the product reaches them — the browser never touches Supabase
// directly. Same posture as lib/workspaces.js.

import { createClient } from "@supabase/supabase-js";

export function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Every template row, newest version first. */
export async function listTemplates(env = process.env) {
  const db = serviceDb(env);
  if (!db) return { ok: false, reason: "not_configured", rows: [] };
  const { data, error } = await db
    .from("workflow_templates")
    .select("*")
    .in("status", ["published", "draft"])
    .order("template_key", { ascending: true })
    .order("version", { ascending: false });
  if (error) return { ok: false, reason: error.message, rows: [] };
  return { ok: true, rows: data || [] };
}

export async function getTemplate(key, version, env = process.env) {
  const db = serviceDb(env);
  if (!db) return null;
  let qb = db.from("workflow_templates").select("*").eq("template_key", key);
  qb = version != null ? qb.eq("version", version) : qb.eq("status", "published");
  const { data, error } = await qb.limit(1);
  if (error || !data?.length) return null;
  return data[0];
}

/**
 * Publish any seed that has no published version yet. Idempotent by
 * construction: a key that already has one is skipped, so this is safe to call
 * on every cold start. It never OVERWRITES a published version — that would
 * violate the immutability the 0036 trigger enforces anyway.
 */
export async function ensureSeeded(seeds, env = process.env) {
  const db = serviceDb(env);
  if (!db) return { ok: false, reason: "not_configured", seeded: [] };

  const { data: existing, error } = await db
    .from("workflow_templates")
    .select("template_key, status");
  if (error) return { ok: false, reason: error.message, seeded: [] };

  const haveLive = new Set(
    (existing || []).filter((r) => r.status === "published").map((r) => r.template_key),
  );
  const haveAny = new Set((existing || []).map((r) => r.template_key));

  const seeded = [];
  for (const t of seeds) {
    if (t.status === "draft") {
      // Draft seeds are inserted once so Phase 4 only has to flip status,
      // but they are never published here.
      if (!haveAny.has(t.template_key)) {
        await db.from("workflow_templates").insert({
          template_key: t.template_key, version: 1, status: "draft",
          title: t.title, persona: t.persona, summary: t.summary,
          input_schema: t.input_schema, extraction_schema: t.extraction_schema,
          output_schema: t.output_schema, prompt_bundle: t.prompt_bundle,
          credit_cost: t.credit_cost, plan_entitlement: t.plan_entitlement,
          min_plan: t.min_plan,
        });
        seeded.push(t.template_key);
      }
      continue;
    }
    if (haveLive.has(t.template_key)) continue;
    const { error: pubErr } = await db.rpc("publish_template_version", {
      p_key: t.template_key,
      p_def: {
        title: t.title, persona: t.persona, summary: t.summary,
        input_schema: t.input_schema, extraction_schema: t.extraction_schema,
        output_schema: t.output_schema, prompt_bundle: t.prompt_bundle,
        credit_cost: t.credit_cost, plan_entitlement: t.plan_entitlement,
        min_plan: t.min_plan,
      },
      p_actor: null,
    });
    if (!pubErr) seeded.push(t.template_key);
  }
  return { ok: true, seeded };
}

export async function createRun(row, env = process.env) {
  const db = serviceDb(env);
  if (!db) return { ok: false, reason: "not_configured" };
  const { data, error } = await db.from("template_runs").insert(row).select().limit(1);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, run: data?.[0] || null };
}

export async function updateRun(runId, patch, env = process.env) {
  const db = serviceDb(env);
  if (!db) return { ok: false, reason: "not_configured" };
  const { data, error } = await db
    .from("template_runs").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", runId).select().limit(1);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, run: data?.[0] || null };
}

export async function getRun(runId, env = process.env) {
  const db = serviceDb(env);
  if (!db) return null;
  const { data, error } = await db.from("template_runs").select("*").eq("id", runId).limit(1);
  if (error || !data?.length) return null;
  return data[0];
}

export async function listRuns(userId, limit = 25, env = process.env) {
  const db = serviceDb(env);
  if (!db) return [];
  const { data, error } = await db
    .from("template_runs").select("*")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return data || [];
}

export async function recordSources(runId, sources, env = process.env) {
  const db = serviceDb(env);
  if (!db || !Array.isArray(sources) || sources.length === 0) return;
  await db.from("template_run_sources").insert(
    sources.slice(0, 50).map((s) => ({
      run_id: runId, url: s.url, canonical_url: s.canonical_url || null,
      fetched_at: s.fetched_at || new Date().toISOString(),
      http_status: s.http_status ?? null, provider: s.provider || null,
      content_hash: s.content_hash || null, bytes: s.bytes ?? null, error: s.error || null,
    })),
  );
}

/** Write the estimate the user was shown, so drift stays measurable. */
export async function recordEstimate(row, env = process.env) {
  const db = serviceDb(env);
  if (!db) return;
  await db.from("credit_estimates").insert(row);
}

/** Append ledger rows. Called ONLY with rows creditModel deemed chargeable. */
export async function chargeLedger(entries, env = process.env) {
  const db = serviceDb(env);
  if (!db || !entries?.length) return { ok: true, charged: 0 };
  for (const e of entries) {
    await db.rpc("credit_spend", {
      p_user_id: e.user_id || null,
      p_run_id: e.run_id || null,
      p_reason: e.reason,
      p_credits: e.credits,
      p_unit: e.unit,
      p_quantity: e.quantity,
      p_meta: {},
      p_workspace_id: e.workspace_id || null,
    });
  }
  return { ok: true, charged: entries.length };
}

export async function creditBalance(userId, month, env = process.env) {
  const db = serviceDb(env);
  if (!db || !userId) return 0;
  const { data, error } = await db.rpc("credit_balance", { p_user_id: userId, p_month: month || null });
  if (error) return 0;
  return Number(data) || 0;
}
