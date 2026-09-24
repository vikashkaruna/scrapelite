// netlify/functions/lib/engagement/engagementStore.js — data access for the
// Prospect Engagement Engine (tables from 0081 + 0082).
//
// ── RULES EVERY FUNCTION HERE OBEYS ─────────────────────────────────────────
//
// 1. EVERY QUERY IS SCOPED BY user_id. The service key bypasses RLS, so this
//    file IS the tenancy boundary.
//
// 2. A PARENT ID FROM A REQUEST IS A CLAIM, NOT A FACT. A campaign or prospect
//    id is checked against a row the caller owns before anything is written
//    beneath it — 404, never 403, so the endpoint is not an existence oracle
//    over other tenants' uuids (review F-13).
//
// 3. WRITES TAKE AN ALLOW-LIST OF FIELDS, never a spread of the request body.
//    0081's updateCampaign spread `updates` into the UPDATE, so `user_id` was
//    writable (review F-7).
//
// 4. NO SILENT IN-MEMORY STORE. 0081 fell back to per-process Maps when
//    Supabase was not configured — in a deployed function that "saves" data
//    and loses it on the next cold start (review F-15). Unconfigured is a 503.
//    Tests inject a real Postgres (PGlite) through __setServiceDbForTests.
//
// 5. ERRORS ARE CODES. Raw database messages are logged, never returned.

import { createClient } from "@supabase/supabase-js";
import { transitionProspect, PROSPECT_STATUSES, STATUS_METADATA } from "../../../../src/lib/engagement/stateMachine.js";
import { dedupeProspects, normalizeEmail, normalizePhone } from "../../../../src/lib/engagement/syncConnectors.js";
import { normalizeAddress } from "../../../../src/lib/engagement/suppressionModel.js";
import { validateSender } from "./engagementGuards.js";
import { validateMessageGuardrails, generatePersonalizedVariants, cleanLines } from "../../../../src/lib/engagement/aiMessageGenerator.js";

// ── Database handle ─────────────────────────────────────────────────────────

function defaultServiceDb(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

let dbFactory = defaultServiceDb;

export function serviceDb(env = process.env) {
  return dbFactory(env);
}

/** Test seam: point every engagement module at a PGlite-backed client. */
export function __setServiceDbForTests(factory) {
  dbFactory = factory || defaultServiceDb;
}

const NO_OWNER = { ok: false, status: 401, code: "unauthenticated", error: "Sign in to continue." };
const UNCONFIGURED = { ok: false, status: 503, code: "store_unconfigured", error: "The engagement store is not configured." };
const ownerless = (userId) => !userId || typeof userId !== "string";

function dbFail(where, error) {
  console.error(`[engagementStore] ${where}:`, error?.message || error);
  return { ok: false, status: 500, code: "store_error", error: "Something went wrong saving this change." };
}

const notFound = (what) => ({ ok: false, status: 404, code: "not_found", error: `${what} not found.` });

function withDb(userId, env) {
  if (ownerless(userId)) return { fail: NO_OWNER };
  const db = serviceDb(env);
  if (!db) return { fail: UNCONFIGURED };
  return { db };
}

// ── Field allow-lists ───────────────────────────────────────────────────────

const CAMPAIGN_STATUSES = ["active", "paused", "completed", "archived"];
const CHANNELS = ["email", "whatsapp", "telegram", "sms"];
const PROSPECT_SOURCES = ["manual", "datiq_extraction", "datiq_list", "google_sheets", "airtable", "csv"];
const CHANNEL_PREFS = ["email", "whatsapp", "telegram", "sms", "auto"];
export const MAX_PROSPECTS_PER_IMPORT = 1000;

const str = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);
const plainObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

function cleanBrandKit(v) {
  const o = plainObject(v) || {};
  const out = {};
  for (const k of ["company_name", "value_prop", "cta_url", "cta_label", "tone", "logo_url"]) {
    const s = str(o[k], k === "value_prop" ? 300 : 200);
    if (s) out[k] = s;
  }
  // The sign-off keeps its line breaks (up to 4 lines) — the one multi-line field.
  const sign = cleanLines(o.signoff_name).join("\n");
  if (sign) out.signoff_name = sign;
  return out;
}

function cleanSettings(v) {
  const o = plainObject(v) || {};
  const delay = Number(o.followup_delay_days);
  const maxF = Number(o.max_followups);
  return {
    followup_delay_days: Number.isFinite(delay) ? Math.min(30, Math.max(1, Math.round(delay))) : 4,
    max_followups: Number.isFinite(maxF) ? Math.min(5, Math.max(0, Math.round(maxF))) : 2,
    // Approval is not optional in this engine: every outbound message is
    // reviewed by a human before it can be queued.
    require_approval: true,
  };
}

/**
 * Validate the editable fields of a campaign. Unknown keys are ignored, and
 * `user_id`, `workspace_id`, `id` and timestamps are never accepted.
 * `workspace_id` is deliberately unsupported until membership is checked here.
 */
function campaignFields(payload = {}, env, { partial }) {
  const out = {};
  if (!partial || "name" in payload) {
    const name = str(payload.name, 120);
    if (!name) return { error: { ok: false, status: 400, code: "name_required", error: "Campaign name is required." } };
    out.name = name;
  }
  if ("description" in payload) out.description = str(payload.description, 1000);
  if ("status" in payload) {
    if (!CAMPAIGN_STATUSES.includes(payload.status)) {
      return { error: { ok: false, status: 400, code: "invalid_status", error: "Unknown campaign status." } };
    }
    out.status = payload.status;
  }
  if ("channel_priority" in payload) {
    const list = Array.isArray(payload.channel_priority) ? payload.channel_priority.filter((c) => CHANNELS.includes(c)) : [];
    out.channel_priority = list.length ? [...new Set(list)] : ["email"];
  }
  if ("brand_kit" in payload) out.brand_kit = cleanBrandKit(payload.brand_kit);
  if ("settings" in payload) out.settings = cleanSettings(payload.settings);
  if ("sender" in payload) {
    if (payload.sender == null || (plainObject(payload.sender) && !payload.sender.from_email)) {
      out.sender = {};
    } else {
      const v = validateSender(payload.sender, env);
      if (!v.ok) return { error: { ok: false, status: 400, code: v.code, error: v.error } };
      out.sender = v.sender;
    }
  }
  return { fields: out };
}

// ── Campaigns ───────────────────────────────────────────────────────────────

export async function listCampaigns(userId, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const { data, error } = await db.from("engagement_campaigns").select("*")
    .eq("user_id", userId).order("created_at", { ascending: false });
  if (error) return dbFail("listCampaigns", error);
  return { ok: true, campaigns: data || [] };
}

export async function getCampaign(campaignId, userId, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  if (!campaignId) return { ok: false, status: 400, code: "campaign_required", error: "Missing campaign_id." };
  const { data, error } = await db.from("engagement_campaigns").select("*")
    .eq("id", campaignId).eq("user_id", userId).maybeSingle();
  if (error) return error.code === "22P02" ? notFound("Campaign") : dbFail("getCampaign", error);
  if (!data) return notFound("Campaign");
  return { ok: true, campaign: data };
}

// Campaign names are unique per account, compared case- and space-insensitively.
// Two campaigns called "Q4 outreach" are indistinguishable in the selector, and a
// person who picks the wrong one sends to the wrong list. Checked here rather
// than by a unique index: accounts already holding duplicates must still load,
// and the loser of a simultaneous create gets a duplicate, not lost work.
const nameKey = (n) => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();

async function nameTaken(db, userId, name, exceptId = null) {
  const { data, error } = await db.from("engagement_campaigns").select("id,name").eq("user_id", userId);
  if (error) return { error: dbFail("campaignNameCheck", error) };
  const key = nameKey(name);
  const clash = (data || []).find((c) => c.id !== exceptId && nameKey(c.name) === key);
  return clash
    ? { error: { ok: false, status: 409, code: "campaign_name_taken", error: `A campaign called "${clash.name}" already exists. Choose a different name.` } }
    : {};
}

export async function createCampaign(userId, payload = {}, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const v = campaignFields(payload, env, { partial: false });
  if (v.error) return v.error;
  const taken = await nameTaken(db, userId, v.fields.name);
  if (taken.error) return taken.error;
  const row = {
    user_id: userId,
    status: "active",
    channel_priority: ["email"],
    brand_kit: {},
    settings: cleanSettings({}),
    sender: {},
    ...v.fields,
  };
  const { data, error } = await db.from("engagement_campaigns").insert(row).select("*").single();
  if (error) return dbFail("createCampaign", error);
  return { ok: true, campaign: data };
}

export async function updateCampaign(campaignId, userId, updates = {}, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const v = campaignFields(plainObject(updates) || {}, env, { partial: true });
  if (v.error) return v.error;
  if (Object.keys(v.fields).length === 0) return getCampaign(campaignId, userId, env);
  if ("name" in v.fields) {
    const taken = await nameTaken(db, userId, v.fields.name, campaignId);
    if (taken.error) return taken.error;
  }
  const { data, error } = await db.from("engagement_campaigns").update(v.fields)
    .eq("id", campaignId).eq("user_id", userId).select("*");
  if (error) return error.code === "22P02" ? notFound("Campaign") : dbFail("updateCampaign", error);
  if (!data || data.length === 0) return notFound("Campaign");
  return { ok: true, campaign: data[0] };
}

export async function deleteCampaign(campaignId, userId, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const { data, error } = await db.from("engagement_campaigns").delete()
    .eq("id", campaignId).eq("user_id", userId).select("id");
  if (error) return error.code === "22P02" ? notFound("Campaign") : dbFail("deleteCampaign", error);
  if (!data || data.length === 0) return notFound("Campaign");
  return { ok: true };
}

// ── Prospects ───────────────────────────────────────────────────────────────

/** PostgREST `or()` syntax treats , ( ) and * as structure — strip them from user search. */
export function sanitizeSearch(q) {
  return String(q || "").replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function listProspects(campaignId, userId, filters = {}, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  let query = db.from("engagement_prospects").select("*").eq("user_id", userId).eq("campaign_id", campaignId);
  if (filters.status && STATUS_METADATA[filters.status]) query = query.eq("status", filters.status);
  const search = sanitizeSearch(filters.search);
  if (search) {
    query = query.or(["first_name", "last_name", "email", "company"].map((c) => `${c}.ilike.*${search}*`).join(","));
  }
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return error.code === "22P02" ? { ok: true, prospects: [] } : dbFail("listProspects", error);
  return { ok: true, prospects: data || [] };
}

export async function getProspect(prospectId, userId, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const { data, error } = await db.from("engagement_prospects").select("*")
    .eq("id", prospectId).eq("user_id", userId).maybeSingle();
  if (error) return error.code === "22P02" ? notFound("Prospect") : dbFail("getProspect", error);
  if (!data) return notFound("Prospect");
  return { ok: true, prospect: data };
}

function prospectRow(p, { userId, campaignId }) {
  const custom = plainObject(p.custom_attributes) || {};
  return {
    user_id: userId,
    campaign_id: campaignId,
    first_name: str(p.first_name, 80),
    last_name: str(p.last_name, 80),
    email: normalizeAddress("email", p.email),
    phone: normalizeAddress("sms", p.phone),
    company: str(p.company, 160),
    role: str(p.role, 120),
    industry: str(p.industry, 120),
    country: str(p.country, 80),
    // An import always starts at the beginning of the funnel; a status from
    // a CSV column is not an observed event.
    status: PROSPECT_STATUSES.NEW,
    channel_preference: CHANNEL_PREFS.includes(p.channel_preference) ? p.channel_preference : "auto",
    source: PROSPECT_SOURCES.includes(p.source) ? p.source : "manual",
    source_id: str(p.source_id, 200),
    custom_attributes: JSON.stringify(custom).length <= 4000 ? custom : {},
    engagement_score: 0,
  };
}

/**
 * Say, for every skipped duplicate, WHAT it matched and WHO it matched — the
 * import result used to show only a count, so nobody could check which
 * contacts were skipped. `existing: null` means it repeated another row of the
 * same import rather than someone already in the campaign.
 */
export function describeDuplicates(duplicates = [], existing = []) {
  const byEmail = new Map();
  const byPhone = new Map();
  for (const p of existing) {
    const e = normalizeEmail(p.email); if (e && !byEmail.has(e)) byEmail.set(e, p);
    const ph = normalizePhone(p.phone); if (ph && !byPhone.has(ph)) byPhone.set(ph, p);
  }
  return duplicates.map((d) => {
    const e = normalizeEmail(d.email);
    const ph = normalizePhone(d.phone);
    const hit = (e && byEmail.get(e)) || (ph && byPhone.get(ph)) || null;
    const matchedOn = e && (hit ? byEmail.get(e) === hit : true) ? "email" : "phone";
    return {
      first_name: d.first_name || null, last_name: d.last_name || null, email: d.email || null, phone: d.phone || null,
      matched_on: matchedOn,
      value: matchedOn === "email" ? e : ph,
      existing: hit ? {
        id: hit.id,
        name: [hit.first_name, hit.last_name].filter(Boolean).join(" ") || hit.email || hit.phone,
        created_at: hit.created_at || null,
      } : null,
    };
  });
}

export async function addProspects(campaignId, userId, rawProspects = [], env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const camp = await getCampaign(campaignId, userId, env);
  if (!camp.ok) return camp;

  if (!Array.isArray(rawProspects) || rawProspects.length === 0) {
    return { ok: true, prospects: [], duplicates: [], stats: { total: 0, uniqueCount: 0, dupCount: 0, invalidCount: 0 } };
  }
  if (rawProspects.length > MAX_PROSPECTS_PER_IMPORT) {
    return {
      ok: false, status: 413, code: "import_too_large",
      error: `Import at most ${MAX_PROSPECTS_PER_IMPORT} prospects at a time.`,
    };
  }

  const rows = rawProspects.map((p) => prospectRow(plainObject(p) || {}, { userId, campaignId }));
  const reachable = rows.filter((r) => r.email || r.phone);
  const invalidCount = rows.length - reachable.length;

  const existing = await listProspects(campaignId, userId, {}, env);
  if (!existing.ok) return existing;
  const { unique, duplicates, stats } = dedupeProspects(reachable, existing.prospects);

  const described = describeDuplicates(duplicates, existing.prospects);
  if (unique.length === 0) return { ok: true, prospects: [], duplicates: described, stats: { ...stats, invalidCount } };

  const { data, error } = await db.from("engagement_prospects").insert(unique).select("*");
  if (error) {
    if (error.code === "23505") {
      return { ok: false, status: 409, code: "duplicate_prospect", error: "Some of these prospects were added at the same time by another import. Refresh and try again." };
    }
    return dbFail("addProspects", error);
  }
  return { ok: true, prospects: data || [], duplicates: described, stats: { ...stats, invalidCount } };
}

/** Fields a person may correct on a prospect. Stage, score and history are not here on purpose. */
export const EDITABLE_PROSPECT_FIELDS = ["first_name", "last_name", "email", "phone", "company", "role", "industry", "country"];
const FIELD_MAX = { first_name: 80, last_name: 80, company: 160, role: 120, industry: 120, country: 80 };

/**
 * Correct a prospect's details (owner request 2026-09-24).
 *
 *   - Only EDITABLE_PROSPECT_FIELDS are read from `updates`; anything else in
 *     the body (user_id, status, engagement_score…) is ignored.
 *   - Email and phone are normalised exactly as on import. A value already
 *     held by ANOTHER prospect in the same campaign is refused, naming them.
 *   - Consent follows the ADDRESS: an opt-out on the old address stays there,
 *     and the consent panel simply reads the new address's status.
 *   - Open drafts are rebuilt with the corrected details (hand edits kept,
 *     approved-but-unsent back to review) — the brand-kit refresh rules.
 */
export async function updateProspect(prospectId, userId, updates = {}, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const cur = await getProspect(prospectId, userId, env);
  if (!cur.ok) return cur;
  const before = cur.prospect;
  const u = plainObject(updates) || {};

  const patch = {};
  for (const k of EDITABLE_PROSPECT_FIELDS) {
    if (!(k in u)) continue;
    if (k === "email") {
      const raw = String(u.email ?? "").trim();
      const v = raw ? normalizeAddress("email", raw) : null;
      if (raw && !v) return { ok: false, status: 400, code: "email_invalid", error: `"${raw}" is not a valid email address.` };
      patch.email = v;
    } else if (k === "phone") {
      const raw = String(u.phone ?? "").trim();
      const v = raw ? normalizeAddress("sms", raw) : null;
      if (raw && !v) return { ok: false, status: 400, code: "phone_invalid", error: `"${raw}" is not a valid phone number.` };
      patch.phone = v;
    } else {
      patch[k] = str(u[k], FIELD_MAX[k]);
    }
  }
  const next = { ...before, ...patch };
  if (!next.email && !next.phone) {
    return { ok: false, status: 400, code: "address_required", error: "A prospect needs an email or a phone number." };
  }
  const changed = Object.keys(patch).filter((k) => (patch[k] ?? null) !== (before[k] ?? null));
  if (changed.length === 0) return { ok: true, prospect: before, changed: [], refresh: null };

  // A clash with someone else in this campaign — refused by name, not by index error.
  for (const [field, value] of [["email", changed.includes("email") && next.email], ["phone", changed.includes("phone") && next.phone]]) {
    if (!value) continue;
    const { data: clash } = await db.from("engagement_prospects").select("id,first_name,last_name,email,phone")
      .eq("user_id", userId).eq("campaign_id", before.campaign_id).eq(field, value).neq("id", prospectId).limit(1);
    if (clash?.length) {
      const who = [clash[0].first_name, clash[0].last_name].filter(Boolean).join(" ") || clash[0].email || clash[0].phone;
      return { ok: false, status: 409, code: "prospect_duplicate", error: `${value} is already ${who} in this campaign.` };
    }
  }

  const { data, error } = await db.from("engagement_prospects").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", prospectId).eq("user_id", userId).select("*");
  if (error) {
    if (error.code === "23505") return { ok: false, status: 409, code: "prospect_duplicate", error: "Another prospect in this campaign already has that email or phone." };
    return dbFail("updateProspect", error);
  }
  await logActivity(db, {
    user_id: userId, campaign_id: before.campaign_id, prospect_id: prospectId,
    event_type: "details_edited", details: { fields: changed },
  });
  const refresh = await refreshUnsentMessages(before.campaign_id, userId, env, { prospectId });
  return {
    ok: true, prospect: data?.[0] || next, changed,
    refresh: refresh.ok ? { refreshed: refresh.refreshed, backToReview: refresh.backToReview, keptEdited: refresh.keptEdited } : null,
  };
}

async function logActivity(db, activity) {
  const { error } = await db.from("engagement_activity_log").insert(activity);
  if (error) console.error("[engagementStore] activity log write failed:", error.message);
  return !error;
}

/**
 * Move a prospect through the state machine and append the audit row.
 * `meta` is built by the SERVER — never forward a request body here.
 */
export async function updateProspectStatus(prospectId, campaignId, userId, nextStatus, meta = {}, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  let q = db.from("engagement_prospects").select("*").eq("id", prospectId).eq("user_id", userId);
  if (campaignId) q = q.eq("campaign_id", campaignId);
  const { data: current, error } = await q.maybeSingle();
  if (error) return error.code === "22P02" ? notFound("Prospect") : dbFail("updateProspectStatus", error);
  if (!current) return notFound("Prospect");

  const t = transitionProspect(current, nextStatus, meta);
  if (!t.ok) return { ok: false, status: 409, code: t.error || "illegal_transition", error: t.reason || "That status change is not allowed." };

  const { data: updated, error: upErr } = await db.from("engagement_prospects").update({
    status: t.prospect.status,
    engagement_score: t.prospect.engagement_score,
    last_contacted_at: t.prospect.last_contacted_at,
    updated_at: t.prospect.updated_at,
  }).eq("id", prospectId).eq("user_id", userId).eq("status", current.status).select("*");
  if (upErr) return dbFail("updateProspectStatus", upErr);
  // The status moved underneath us (a webhook, another tab): report it rather
  // than overwrite a newer state with an older decision.
  if (!updated || updated.length === 0) {
    return { ok: false, status: 409, code: "status_changed", error: "This prospect was updated elsewhere. Refresh and try again." };
  }

  await logActivity(db, { ...t.activity, user_id: userId });
  return { ok: true, prospect: updated[0], activity: t.activity };
}

export async function deleteProspect(prospectId, userId, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const { data, error } = await db.from("engagement_prospects").delete()
    .eq("id", prospectId).eq("user_id", userId).select("id");
  if (error) return error.code === "22P02" ? notFound("Prospect") : dbFail("deleteProspect", error);
  if (!data || data.length === 0) return notFound("Prospect");
  return { ok: true };
}

export async function listActivity(prospectId, userId, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const { data, error } = await db.from("engagement_activity_log").select("*")
    .eq("prospect_id", prospectId).eq("user_id", userId).order("timestamp", { ascending: false }).limit(200);
  if (error) return error.code === "22P02" ? { ok: true, activity: [] } : dbFail("listActivity", error);
  return { ok: true, activity: data || [] };
}

// ── Messages ────────────────────────────────────────────────────────────────

const PROSPECT_SUMMARY = ["first_name", "last_name", "company", "email", "phone"];

export async function listMessages(campaignId, userId, filters = {}, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  let q = db.from("engagement_messages").select("*").eq("user_id", userId).eq("campaign_id", campaignId);
  if (filters.approval_status) q = q.eq("approval_status", String(filters.approval_status));
  if (filters.status) q = q.eq("status", String(filters.status));
  if (Array.isArray(filters.ids) && filters.ids.length) q = q.in("id", filters.ids);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) return error.code === "22P02" ? { ok: true, messages: [] } : dbFail("listMessages", error);

  // Attach a prospect summary with a second query — embedded selects are
  // avoided so the same code runs against PostgREST and the PGlite harness.
  const ids = [...new Set((data || []).map((m) => m.prospect_id))];
  let byId = new Map();
  if (ids.length) {
    const pr = await db.from("engagement_prospects").select(["id", ...PROSPECT_SUMMARY].join(","))
      .eq("user_id", userId).in("id", ids);
    if (!pr.error) byId = new Map((pr.data || []).map((p) => [p.id, p]));
  }
  const messages = (data || []).map((m) => {
    const p = byId.get(m.prospect_id);
    return { ...m, engagement_prospects: p ? Object.fromEntries(PROSPECT_SUMMARY.map((k) => [k, p[k]])) : null };
  });
  return { ok: true, messages };
}

export async function createMessages(campaignId, userId, rows = [], env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  if (!rows.length) return { ok: true, messages: [] };
  const { data, error } = await db.from("engagement_messages").insert(rows.map((m) => ({
    user_id: userId,
    campaign_id: campaignId,
    prospect_id: m.prospect_id,
    channel: m.channel,
    variant: m.variant || "A",
    subject: m.subject || null,
    body: m.body,
    body_html: m.body_html || null,
    status: "pending_approval",
    approval_status: "pending",
    guardrail_checks: m.guardrail_checks || { passed: false, violations: ["not checked"] },
  }))).select("*");
  if (error) return dbFail("createMessages", error);
  return { ok: true, messages: data || [] };
}

/**
 * Rebuild every UNSENT draft of a campaign from its current brand kit.
 *
 *   pending_approval → regenerated in place.
 *   queued (approved, not yet claimed) → regenerated AND returned to review:
 *     a person approved the OLD text, and "what was approved is what gets
 *     sent" (review F-28) would otherwise be false.
 *   edited by a reviewer → never overwritten; counted so the UI can say so.
 *
 * Every write is conditional on the status it read, so a message the
 * dispatcher claims mid-refresh is left alone rather than changed under it.
 */
export async function refreshUnsentMessages(campaignId, userId, env = process.env, { prospectId = null } = {}) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const camp = await getCampaign(campaignId, userId, env);
  if (!camp.ok) return camp;

  let mq = db.from("engagement_messages").select("*")
    .eq("user_id", userId).eq("campaign_id", campaignId).in("status", ["pending_approval", "queued"]);
  if (prospectId) mq = mq.eq("prospect_id", prospectId);
  const { data: msgs, error } = await mq;
  if (error) return dbFail("refreshUnsentMessages", error);
  const summary = { refreshed: 0, backToReview: 0, keptEdited: 0 };
  if (!msgs?.length) return { ok: true, ...summary };

  const ids = [...new Set(msgs.map((m) => m.prospect_id))];
  const { data: prs } = await db.from("engagement_prospects").select("*").eq("user_id", userId).in("id", ids);
  const byId = new Map((prs || []).map((p) => [p.id, p]));

  for (const m of msgs) {
    if (m.metadata?.edited_by_reviewer) { summary.keptEdited += 1; continue; }
    const p = byId.get(m.prospect_id);
    if (!p) continue;
    const [v] = generatePersonalizedVariants(p, camp.campaign, camp.campaign.brand_kit, { channels: [m.channel], variants: [m.variant] });
    if (!v) continue;
    const patch = {
      subject: v.subject, body: v.body, body_html: v.bodyHtml, guardrail_checks: v.guardrails,
      metadata: { ...(m.metadata || {}), refreshed_from_brand_kit_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    };
    if (m.status === "queued") Object.assign(patch, { status: "pending_approval", approval_status: "pending" });
    const { data: upd, error: upErr } = await db.from("engagement_messages").update(patch)
      .eq("id", m.id).eq("user_id", userId).eq("status", m.status).select("id");
    if (upErr) { console.error("[engagementStore] refresh failed:", m.id, upErr.message); continue; }
    if (!upd?.length) continue; // claimed or changed meanwhile
    if (m.status === "queued") summary.backToReview += 1; else summary.refreshed += 1;
  }
  return { ok: true, ...summary };
}

/** Prospect statuses from which an approved message moves the prospect to `queued`. */
const QUEUEABLE_PROSPECT = [PROSPECT_STATUSES.NEW, PROSPECT_STATUSES.FOLLOWUP_DUE, PROSPECT_STATUSES.UNRESPONSIVE];

/**
 * Approve a draft, optionally with the reviewer's edits.
 *
 * ⚠️ WHAT WAS REVIEWED IS WHAT IS SENT. The queue lets a reviewer edit the
 * subject and body; 0081 accepted those edits and threw them away, so the
 * approved text was never the sent text. Edits are saved here, the guardrails
 * re-run on the EDITED copy, and an edited body drops its HTML version — a
 * stale HTML part would show recipients the pre-edit wording.
 */
export async function approveMessage(messageId, userId, env = process.env, edits = null) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const { data: msg, error } = await db.from("engagement_messages").select("*")
    .eq("id", messageId).eq("user_id", userId).maybeSingle();
  if (error) return error.code === "22P02" ? notFound("Message") : dbFail("approveMessage", error);
  if (!msg) return notFound("Message");

  const patch = {};
  if (edits && typeof edits === "object") {
    const subject = edits.subject != null ? String(edits.subject).slice(0, 300) : msg.subject;
    const body = edits.body != null ? String(edits.body).slice(0, 20000) : msg.body;
    if (subject !== msg.subject || body !== msg.body) {
      patch.subject = subject;
      patch.body = body;
      if (body !== msg.body) patch.body_html = null;
      patch.guardrail_checks = validateMessageGuardrails({ channel: msg.channel, subject, body });
      patch.metadata = { ...(msg.metadata || {}), edited_by_reviewer: true };
    }
  }
  const checks = patch.guardrail_checks || msg.guardrail_checks;

  // A message that fails its guardrails cannot be approved — edit it until it
  // passes (review F-28).
  if (!checks?.passed) {
    return { ok: false, status: 422, code: "guardrails_failed", error: "This draft fails a compliance check and cannot be approved.", violations: checks?.violations || [] };
  }

  // Conditional update: only a draft still awaiting review can be approved.
  // Re-approving a sent or rejected message would re-queue it (review F-1).
  const { data: upd, error: upErr } = await db.from("engagement_messages")
    .update({ ...patch, approval_status: "approved", status: "queued", updated_at: new Date().toISOString() })
    .eq("id", messageId).eq("user_id", userId).eq("status", "pending_approval").select("*");
  if (upErr) return dbFail("approveMessage", upErr);
  if (!upd || upd.length === 0) {
    return { ok: false, status: 409, code: "not_pending", error: "Only a draft awaiting review can be approved." };
  }

  const pr = await getProspect(msg.prospect_id, userId, env);
  if (pr.ok && QUEUEABLE_PROSPECT.includes(pr.prospect.status)) {
    await updateProspectStatus(msg.prospect_id, msg.campaign_id, userId, PROSPECT_STATUSES.QUEUED, {
      channel: msg.channel, messageId: msg.id, eventType: "message_approved",
    }, env);
  } else {
    await logActivity(db, {
      user_id: userId, campaign_id: msg.campaign_id, prospect_id: msg.prospect_id, message_id: msg.id,
      event_type: "message_approved", channel: msg.channel, details: {},
    });
  }
  return { ok: true, message: upd[0] };
}

export async function rejectMessage(messageId, userId, reason, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const { data, error } = await db.from("engagement_messages")
    .update({
      approval_status: "rejected", status: "rejected",
      rejection_reason: str(reason, 500) || "Rejected by reviewer",
      updated_at: new Date().toISOString(),
    })
    .eq("id", messageId).eq("user_id", userId).in("status", ["pending_approval", "queued", "failed"]).select("*");
  if (error) return error.code === "22P02" ? notFound("Message") : dbFail("rejectMessage", error);
  if (!data || data.length === 0) {
    return { ok: false, status: 409, code: "not_rejectable", error: "A message that has been sent cannot be rejected." };
  }
  return { ok: true, message: data[0] };
}

/** Put a failed message back in the queue (e.g. after the sender was fixed). */
export async function retryMessage(messageId, userId, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const { data, error } = await db.from("engagement_messages")
    .update({ status: "queued", failure_code: null, updated_at: new Date().toISOString() })
    .eq("id", messageId).eq("user_id", userId).eq("status", "failed").eq("approval_status", "approved").select("*");
  if (error) return error.code === "22P02" ? notFound("Message") : dbFail("retryMessage", error);
  if (!data || data.length === 0) return { ok: false, status: 409, code: "not_failed", error: "Only a failed message can be retried." };
  return { ok: true, message: data[0] };
}

/** Open (not yet sent) messages for these prospects on this channel. */
export async function openMessagesFor(prospectIds, channel, userId, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  if (!prospectIds.length) return { ok: true, messages: [] };
  const { data, error } = await db.from("engagement_messages").select("id,prospect_id,status")
    .eq("user_id", userId).eq("channel", channel).in("prospect_id", prospectIds)
    .in("status", ["pending_approval", "queued", "sending"]);
  if (error) return dbFail("openMessagesFor", error);
  return { ok: true, messages: data || [] };
}

// ── Suppressions (per channel, per tenant) ──────────────────────────────────

export async function listSuppressions(userId, { channel, addresses } = {}, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  let q = db.from("engagement_suppressions").select("*").eq("user_id", userId);
  if (channel) q = q.eq("channel", channel);
  if (Array.isArray(addresses)) {
    if (!addresses.length) return { ok: true, suppressions: [] };
    q = q.in("address", addresses);
  }
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1000);
  if (error) return dbFail("listSuppressions", error);
  return { ok: true, suppressions: data || [] };
}

/** Insert suppression rows; an existing (tenant, channel, address) row is kept as-is. */
export async function addSuppressions(rows = [], env = process.env) {
  const db = serviceDb(env);
  if (!db) return UNCONFIGURED;
  if (!rows.length) return { ok: true, suppressions: [] };
  const { data, error } = await db.from("engagement_suppressions")
    .upsert(rows, { onConflict: "user_id,channel,address", ignoreDuplicates: true }).select("*");
  if (error) return dbFail("addSuppressions", error);
  return { ok: true, suppressions: data || [] };
}

export async function getSuppression(id, userId, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const { data, error } = await db.from("engagement_suppressions").select("*")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) return error.code === "22P02" ? notFound("Opt-out") : dbFail("getSuppression", error);
  if (!data) return notFound("Opt-out");
  return { ok: true, suppression: data };
}

export async function deleteSuppression(id, userId, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const { data, error } = await db.from("engagement_suppressions").delete()
    .eq("id", id).eq("user_id", userId).select("id");
  if (error) return dbFail("deleteSuppression", error);
  if (!data || data.length === 0) return notFound("Opt-out");
  return { ok: true };
}

// ── Analytics ───────────────────────────────────────────────────────────────

const REACHED = {
  sent: ["sent", "delivered", "opened", "clicked", "replied", "converted"],
  delivered: ["delivered", "opened", "clicked", "replied", "converted"],
  opened: ["opened", "clicked", "replied", "converted"],
  clicked: ["clicked", "replied", "converted"],
  replied: ["replied", "converted"],
};

export async function getAnalytics(campaignId, userId, env = process.env) {
  const { db, fail } = withDb(userId, env);
  if (fail) return fail;
  const camp = await getCampaign(campaignId, userId, env);
  if (!camp.ok) return camp;

  const [pr, ms] = await Promise.all([
    db.from("engagement_prospects").select("status,engagement_score").eq("user_id", userId).eq("campaign_id", campaignId),
    db.from("engagement_messages").select("variant,channel,status,sent_at,delivered_at,opened_at,clicked_at,replied_at")
      .eq("user_id", userId).eq("campaign_id", campaignId),
  ]);
  if (pr.error) return dbFail("getAnalytics", pr.error);
  const prospects = pr.data || [];

  const counts = {};
  for (const p of prospects) counts[p.status] = (counts[p.status] || 0) + 1;
  const sum = (list) => list.reduce((n, s) => n + (counts[s] || 0), 0);
  const funnel = {
    sent: sum(REACHED.sent), delivered: sum(REACHED.delivered), opened: sum(REACHED.opened),
    clicked: sum(REACHED.clicked), replied: sum(REACHED.replied), converted: counts.converted || 0,
  };
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

  // Per-variant results, from MESSAGE timestamps — a later bounce does not
  // erase the fact that a message was opened.
  const variants = {};
  const channelBreakdown = {};
  for (const m of ms.error ? [] : ms.data || []) {
    if (!m.sent_at) continue;
    const ch = channelBreakdown[m.channel] || (channelBreakdown[m.channel] = { sent: 0, delivered: 0, opened: 0, replied: 0, converted: 0 });
    ch.sent += 1;
    if (m.delivered_at || m.opened_at || m.clicked_at || m.replied_at) ch.delivered += 1;
    if (m.opened_at) ch.opened += 1;
    if (m.replied_at) ch.replied += 1;
    const key = `${m.channel}:${m.variant}`;
    const v = variants[key] || (variants[key] = { channel: m.channel, variant: m.variant, sent: 0, opened: 0, clicked: 0, replied: 0 });
    v.sent += 1;
    if (m.opened_at) v.opened += 1;
    if (m.clicked_at) v.clicked += 1;
    if (m.replied_at) v.replied += 1;
  }

  return {
    ok: true,
    total_prospects: prospects.length,
    counts,
    funnel,
    rates: {
      delivery_rate: pct(funnel.delivered, funnel.sent),
      open_rate: pct(funnel.opened, funnel.delivered),
      click_rate: pct(funnel.clicked, funnel.opened),
      reply_rate: pct(funnel.replied, funnel.delivered),
      conversion_rate: pct(funnel.converted, prospects.length),
    },
    variants: Object.values(variants),
    // Conversion is a prospect outcome, not a message event, so it is not
    // attributed to a channel here.
    channel_breakdown: channelBreakdown,
  };
}
