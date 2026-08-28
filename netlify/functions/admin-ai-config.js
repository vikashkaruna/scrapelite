// admin-ai-config.js — read/write the AI provider chain config.
//
//   GET  /api/admin-ai-config   → { ok, config, keyPresence, persisted, demo }
//   POST /api/admin-ai-config   (Authorization: Bearer <admin token>)
//                               body: { order, models, enabled, maxTokens }
//                               → upserts the Supabase app_config 'ai' row
//
// The stored value is NON-SECRET (provider names, model ids, order) — the API
// keys themselves live only in env. Writes require a valid admin session token
// (see lib/adminToken.js). Persistence needs Supabase (SUPABASE_URL +
// SUPABASE_SERVICE_KEY); without it, GET still returns effective defaults and
// POST reports persisted:false so the admin UI can warn.

import { loadAiConfig, keyPresence, PROVIDER_META, PILLAR_KEYS, SUPABASE_CONFIGURED } from "./lib/aiProviders.js";
import { verifyAdminToken, bearerFromEvent } from "./lib/adminToken.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};

const respond = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

const VALID = new Set(Object.keys(PROVIDER_META));
const VALID_PILLARS = new Set(PILLAR_KEYS);

// Keep only known providers / sane values before persisting. Shared between
// the top-level (default/global) chain and each pillar override, since both
// are the same {order, models, enabled} shape.
function sanitizeChain(input) {
  if (!input || typeof input !== "object") return {};
  const order = Array.isArray(input.order)
    ? input.order.map((s) => String(s).toLowerCase()).filter((p) => VALID.has(p))
    : [];
  const models = {};
  const enabled = {};
  for (const p of VALID) {
    if (input.models && input.models[p] != null) models[p] = String(input.models[p]).trim().slice(0, 120);
    if (input.enabled && typeof input.enabled[p] === "boolean") enabled[p] = input.enabled[p];
  }
  const out = {};
  if (order.length) out.order = order;
  if (Object.keys(models).length) out.models = models;
  if (Object.keys(enabled).length) out.enabled = enabled;
  return out;
}

// Keep only known providers / sane values before persisting.
function sanitize(input) {
  const out = sanitizeChain(input);
  const mt = Number(input.maxTokens);
  if (mt > 0) out.maxTokens = Math.min(8192, Math.round(mt));

  // Pillar keys are restricted to VALID_PILLARS (PILLAR_KEYS in
  // aiProviders.js) — an arbitrary key here would silently do nothing (no
  // caller ever passes it to runChain's `pillar` option), so rejecting it up
  // front is better than storing a config nobody reads.
  if (input.pillars && typeof input.pillars === "object") {
    const pillars = {};
    for (const key of Object.keys(input.pillars)) {
      if (!VALID_PILLARS.has(key)) continue;
      const chain = sanitizeChain(input.pillars[key]);
      if (Object.keys(chain).length) pillars[key] = chain;
    }
    if (Object.keys(pillars).length) out.pillars = pillars;
  }
  return out;
}

async function upsert(value) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return false;
  const res = await fetch(`${url}/rest/v1/app_config?on_conflict=key`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ key: "ai", value, updated_at: new Date().toISOString() }),
  });
  return res.ok;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };

  if (event.httpMethod === "GET") {
    const auth = verifyAdminToken(bearerFromEvent(event));
    if (!auth.ok) return respond(401, { ok: false, error: auth.reason || "Unauthorized" });
    const config = await loadAiConfig();
    return respond(200, {
      ok: true,
      config,
      keyPresence: keyPresence(),
      providers: PROVIDER_META,
      persisted: SUPABASE_CONFIGURED(),
      demo: auth.demo,
    });
  }

  if (event.httpMethod === "POST") {
    const auth = verifyAdminToken(bearerFromEvent(event));
    if (!auth.ok) return respond(401, { ok: false, error: auth.reason || "Unauthorized" });

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return respond(400, { ok: false, error: "Invalid JSON" }); }

    const value = sanitize(body);
    if (!value.order && !value.models && !value.enabled && !value.maxTokens && !value.pillars) {
      return respond(400, { ok: false, error: "Nothing valid to save." });
    }

    if (!SUPABASE_CONFIGURED()) {
      return respond(200, { ok: true, persisted: false, demo: auth.demo,
        warning: "Supabase not configured — config not persisted server-side." });
    }

    let saved = false;
    try { saved = await upsert(value); } catch { saved = false; }
    if (!saved) return respond(502, { ok: false, error: "Failed to persist config to Supabase." });
    return respond(200, { ok: true, persisted: true, demo: auth.demo, value });
  }

  return respond(405, { ok: false, error: "Method not allowed" });
};
