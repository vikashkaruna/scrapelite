// admin-general-config.js — read/write global application settings.
//
//   GET  /api/admin-general-config  → { ok, settings, persisted }
//   POST /api/admin-general-config  (Authorization: Bearer <admin token>)
//                                   body: { settings: { ... } }  OR flat { key: value, ... }
//                                   → upserts Supabase app_config row key='general'
//
// Settings are non-secret (behavior parameters only — no keys).
// Writes are gated by the admin session token (see lib/adminToken.js).

import { verifyAdminToken, bearerFromEvent } from "./lib/adminToken.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};

const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

const DEFAULTS = {
  guest_trial_soft_limit: 3,
  guest_trial_reprompt_interval: 2,
  guest_single_hard_limit: 10,
  guest_batch_hard_limit: 5,
  // Contact-page SLA rows. Strings, not integers — sanitized by stripping
  // control chars and capping length so a misbehaving admin UI cannot write
  // an arbitrarily long value or break the contact page layout.
  contact_sla_general_label:    "General support",
  contact_sla_general_time:     "Within 48 h",
  contact_sla_billing_label:    "Billing issues",
  contact_sla_billing_time:     "Within 24 h",
  contact_sla_enterprise_label: "Enterprise enquiries",
  contact_sla_enterprise_time:  "Within 24 h",
};

function SUPABASE_CONFIGURED() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

async function readFromSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/app_config?key=eq.general&select=value`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.value ?? null;
}

async function upsertToSupabase(value) {
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
    body: JSON.stringify({ key: "general", value, updated_at: new Date().toISOString() }),
  });
  return res.ok;
}

function sanitize(raw) {
  const out = {};
  const intField = (k, min, max) => {
    const v = Number(raw[k]);
    if (Number.isInteger(v) && v >= min && v <= max) out[k] = v;
  };
  intField("guest_trial_soft_limit", 1, 100);
  intField("guest_trial_reprompt_interval", 1, 20);
  intField("guest_single_hard_limit", 1, 1000);
  intField("guest_batch_hard_limit", 1, 100);
  // String fields for the contact-page "Response times" card. We strip control
  // characters and cap length to keep the /contact page layout intact — the
  // labels and times are display copy, not free-form notes.
  const strField = (k, max) => {
    const v = raw[k];
    if (typeof v !== "string") return;
    const cleaned = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
    if (cleaned) out[k] = cleaned;
  };
  strField("contact_sla_general_label",    60);
  strField("contact_sla_general_time",     40);
  strField("contact_sla_billing_label",    60);
  strField("contact_sla_billing_time",     40);
  strField("contact_sla_enterprise_label", 60);
  strField("contact_sla_enterprise_time",  40);
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };

  if (event.httpMethod === "GET") {
    let stored = null;
    try { stored = await readFromSupabase(); } catch { /* ignore */ }
    const settings = { ...DEFAULTS, ...(stored || {}) };
    return respond(200, { ok: true, settings, persisted: SUPABASE_CONFIGURED() });
  }

  if (event.httpMethod === "POST") {
    const auth = verifyAdminToken(bearerFromEvent(event));
    if (!auth.ok) return respond(401, { ok: false, error: auth.reason || "Unauthorized" });

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch {
      return respond(400, { ok: false, error: "Invalid JSON" });
    }

    // Accept both { settings: {...} } and flat { key: value } shapes.
    const raw = body.settings || body;
    const sanitized = sanitize(raw);
    if (!Object.keys(sanitized).length) {
      return respond(400, { ok: false, error: "No valid settings to save." });
    }

    if (!SUPABASE_CONFIGURED()) {
      return respond(200, {
        ok: true, persisted: false, demo: auth.demo,
        warning: "Supabase not configured — settings not persisted server-side.",
      });
    }

    // Merge with existing stored values so partial updates don't wipe other fields.
    let existing = {};
    try { existing = (await readFromSupabase()) || {}; } catch { /* ignore */ }
    const merged = { ...DEFAULTS, ...existing, ...sanitized };

    let saved = false;
    try { saved = await upsertToSupabase(merged); } catch { saved = false; }
    if (!saved) return respond(502, { ok: false, error: "Failed to persist settings to Supabase." });
    return respond(200, { ok: true, persisted: true, demo: auth.demo, settings: merged });
  }

  return respond(405, { ok: false, error: "Method not allowed" });
};
