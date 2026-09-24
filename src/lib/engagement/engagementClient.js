// src/lib/engagement/engagementClient.js — browser client for /api/engagement-engine.
//
// ── NO LOCAL FALLBACK, ON PURPOSE ───────────────────────────────────────────
// The previous client caught EVERY error — 400, 401, 404, 500 alike — and
// carried on in localStorage. A signed-in user's failed write therefore
// "succeeded" on screen and vanished; a failed send looked sent; and prospect
// names, emails and phone numbers were left in localStorage under
// `datiq_engagement_*`, surviving sign-out on a shared machine (review F-14).
//
// Outreach is a feature with consequences for real people. Every call here
// either reaches the server or throws an Error carrying the server's `code`
// and HTTP `status`, and the page shows it.

import { supabase } from "../supabaseClient.js";

const ENDPOINT = "/api/engagement-engine";

/** Legacy localStorage prefix from the pre-review build — swept on sign-out. */
export const LEGACY_LOCAL_PREFIX = "datiq_engagement_";

async function authHeader() {
  try {
    const { data } = (await supabase?.auth.getSession()) || {};
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function call(method, { query, body } = {}) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== "")).toString()}` : "";
  let res;
  try {
    res = await fetch(`${ENDPOINT}${qs}`, {
      method,
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error("Could not reach DatIQ. Check your connection and try again.");
    e.code = "network_error";
    throw e;
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok || data.ok === false) {
    const e = new Error(data.error || data.message || `Request failed (${res.status})`);
    e.status = res.status;
    e.code = data.code || null;
    e.details = data;
    throw e;
  }
  return data;
}

const get = (action, params = {}) => call("GET", { query: { action, ...params } });
const post = (action, payload = {}) => call("POST", { body: { action, ...payload } });

// ── Access ──────────────────────────────────────────────────────────────────
export const getAccess = () => get("access");

// ── Campaigns ───────────────────────────────────────────────────────────────
export const listCampaigns = () => get("list_campaigns");
export const getCampaign = (id) => get("get_campaign", { campaign_id: id });
export const createCampaign = (payload) => post("create_campaign", payload);
export const updateCampaign = (campaignId, updates) => post("update_campaign", { campaign_id: campaignId, updates });
export const deleteCampaign = (campaignId) => post("delete_campaign", { campaign_id: campaignId });

// ── Prospects ───────────────────────────────────────────────────────────────
export const listProspects = (campaignId, filters = {}) =>
  get("list_prospects", { campaign_id: campaignId, status: filters.status, search: filters.search });
export const updateProspect = (prospectId, updates) => post("update_prospect", { prospect_id: prospectId, updates });
export const addProspects = (campaignId, prospects = []) =>
  post("add_prospects", { campaign_id: campaignId, prospects });
export const updateProspectStatus = (campaignId, prospectId, status, note) =>
  post("update_prospect_status", { campaign_id: campaignId, prospect_id: prospectId, status, note });
export const deleteProspect = (prospectId) => post("delete_prospect", { prospect_id: prospectId });

export async function getActivityLogs(_campaignId, prospectId) {
  const res = await get("list_activity", { prospect_id: prospectId });
  return { logs: res.activity || [] };
}
export const addProspectNote = (_campaignId, prospectId, note) => post("add_note", { prospect_id: prospectId, note });

// ── Messages ────────────────────────────────────────────────────────────────
export const listMessages = (campaignId) => get("list_messages", { campaign_id: campaignId });

/** Draft one email for one prospect (their assigned A/B variant). */
export const generateProspectMessage = (campaignId, prospectId, channel = "email") =>
  post("generate_messages", { campaign_id: campaignId, prospect_ids: [prospectId], channel });

/** Draft for many prospects (or the whole campaign when `prospectIds` is empty). */
export const generateMessagesForProspects = (campaignId, prospectIds = [], channel = "email") =>
  post("generate_messages", { campaign_id: campaignId, prospect_ids: prospectIds, channel });

/** `edits` = { subject, body } from the reviewer; what they approve is what is sent. */
export const approveMessage = (_campaignId, messageId, edits) =>
  post("approve_message", { message_id: messageId, edits: edits || undefined });
export const rejectMessage = (_campaignId, messageId, reason) => post("reject_message", { message_id: messageId, reason });
export const retryMessage = (messageId) => post("retry_message", { message_id: messageId });

/** Send approved messages now; whatever does not fit the request is sent by the queue within minutes. */
export const sendApproved = (campaignId, messageIds) =>
  post("send_messages", { campaign_id: campaignId, message_ids: messageIds });

// ── Consent (per channel) ───────────────────────────────────────────────────
export const listSuppressions = (prospectId) => get("list_suppressions", { prospect_id: prospectId });
export const optOut = (prospectId, channels, note) => post("opt_out", { prospect_id: prospectId, channels, note });
export const liftSuppression = (suppressionId) => post("lift_suppression", { suppression_id: suppressionId });

// ── Analytics ───────────────────────────────────────────────────────────────
export const getAnalytics = (campaignId) => get("get_analytics", { campaign_id: campaignId });
