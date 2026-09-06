// netlify/functions/lib/engagement/engagementStore.js — Data access for Prospect Engagement Engine
//
// Manages engagement_campaigns, engagement_prospects, engagement_messages,
// engagement_activity_log, and engagement_sync_configs.
//
// Uses the Supabase service key when available, with in-memory fallback for
// local tests and offline dev. Enforces tenant ownership checks on all queries.

import { createClient } from "@supabase/supabase-js";
import {
  transitionProspect,
  PROSPECT_STATUSES,
  calculateEngagementScore,
} from "../../../../src/lib/engagement/stateMachine.js";
import { dedupeProspects } from "../../../../src/lib/engagement/syncConnectors.js";

const _localCampaigns = new Map();
const _localProspects = new Map();
const _localMessages = new Map();
const _localActivity = new Map();
const _localSyncConfigs = new Map();

const NO_OWNER = { ok: false, reason: "unauthenticated", status: 401 };
const ownerless = (userId) => !userId || typeof userId !== "string";

export function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Campaigns ───────────────────────────────────────────────────────────────

export async function listCampaigns(userId, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);

  if (!db) {
    const list = Array.from(_localCampaigns.values())
      .filter((c) => c.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { ok: true, campaigns: list };
  }

  const { data, error } = await db
    .from("engagement_campaigns")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, campaigns: data || [] };
}

export async function getCampaign(campaignId, userId, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  if (!campaignId) return { ok: false, error: "Missing campaignId", status: 400 };
  const db = serviceDb(env);

  if (!db) {
    const c = _localCampaigns.get(campaignId);
    if (!c || c.user_id !== userId) return { ok: false, error: "Campaign not found", status: 404 };
    return { ok: true, campaign: c };
  }

  const { data, error } = await db
    .from("engagement_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return { ok: false, error: error?.message || "Campaign not found", status: 404 };
  return { ok: true, campaign: data };
}

export async function createCampaign(userId, payload = {}, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  if (!payload.name) return { ok: false, error: "Campaign name is required", status: 400 };

  const db = serviceDb(env);
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    workspace_id: payload.workspace_id || null,
    name: payload.name.trim(),
    description: payload.description ? payload.description.trim() : null,
    status: payload.status || "active",
    channel_priority: payload.channel_priority || ["email", "whatsapp", "sms"],
    brand_kit: payload.brand_kit || {},
    settings: payload.settings || { followup_delay_days: 4, require_approval: true },
    created_at: now,
    updated_at: now,
  };

  if (!db) {
    const id = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const created = { id, ...row };
    _localCampaigns.set(id, created);
    return { ok: true, campaign: created };
  }

  const { data, error } = await db
    .from("engagement_campaigns")
    .insert(row)
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, campaign: data };
}

export async function updateCampaign(campaignId, userId, updates = {}, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);

  if (!db) {
    const c = _localCampaigns.get(campaignId);
    if (!c || c.user_id !== userId) return { ok: false, error: "Campaign not found", status: 404 };
    const updated = { ...c, ...updates, updated_at: new Date().toISOString() };
    _localCampaigns.set(campaignId, updated);
    return { ok: true, campaign: updated };
  }

  const { data, error } = await db
    .from("engagement_campaigns")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, campaign: data };
}

export async function deleteCampaign(campaignId, userId, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);

  if (!db) {
    const c = _localCampaigns.get(campaignId);
    if (!c || c.user_id !== userId) return { ok: false, error: "Campaign not found", status: 404 };
    _localCampaigns.delete(campaignId);
    // Cascade delete local prospects, messages, activity
    for (const [id, p] of _localProspects.entries()) {
      if (p.campaign_id === campaignId) _localProspects.delete(id);
    }
    for (const [id, m] of _localMessages.entries()) {
      if (m.campaign_id === campaignId) _localMessages.delete(id);
    }
    return { ok: true };
  }

  const { error } = await db
    .from("engagement_campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── Prospects ───────────────────────────────────────────────────────────────

export async function listProspects(campaignId, userId, filters = {}, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);

  if (!db) {
    let list = Array.from(_localProspects.values())
      .filter((p) => p.user_id === userId && p.campaign_id === campaignId);

    if (filters.status) list = list.filter((p) => p.status === filters.status);
    if (filters.search) {
      const s = filters.search.toLowerCase();
      list = list.filter((p) =>
        (p.first_name && p.first_name.toLowerCase().includes(s)) ||
        (p.last_name && p.last_name.toLowerCase().includes(s)) ||
        (p.email && p.email.toLowerCase().includes(s)) ||
        (p.company && p.company.toLowerCase().includes(s))
      );
    }

    return { ok: true, prospects: list };
  }

  let query = db
    .from("engagement_prospects")
    .select("*")
    .eq("user_id", userId)
    .eq("campaign_id", campaignId);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.search) {
    query = query.or(
      `first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,company.ilike.%${filters.search}%`
    );
  }

  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, prospects: data || [] };
}

export async function addProspects(campaignId, userId, rawProspects = [], env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  if (!Array.isArray(rawProspects) || rawProspects.length === 0) {
    return { ok: true, prospects: [], stats: { total: 0, uniqueCount: 0, dupCount: 0 } };
  }

  // Fetch existing prospects for deduplication
  const existingRes = await listProspects(campaignId, userId, {}, env);
  const existing = existingRes.prospects || [];
  const { unique, duplicates, stats } = dedupeProspects(rawProspects, existing);

  if (unique.length === 0) {
    return { ok: true, prospects: [], duplicates, stats };
  }

  const now = new Date().toISOString();
  const rows = unique.map((p) => ({
    user_id: userId,
    campaign_id: campaignId,
    first_name: p.first_name || null,
    last_name: p.last_name || null,
    email: p.email || null,
    phone: p.phone || null,
    company: p.company || null,
    role: p.role || null,
    industry: p.industry || null,
    country: p.country || null,
    status: p.status || PROSPECT_STATUSES.NEW,
    channel_preference: p.channel_preference || "auto",
    source: p.source || "manual",
    source_id: p.source_id || null,
    custom_attributes: p.custom_attributes || {},
    engagement_score: p.engagement_score || 0,
    created_at: now,
    updated_at: now,
  }));

  const db = serviceDb(env);

  if (!db) {
    const created = rows.map((r, i) => {
      const id = `prs_${Date.now()}_${i}`;
      const item = { id, ...r };
      _localProspects.set(id, item);
      return item;
    });
    return { ok: true, prospects: created, duplicates, stats };
  }

  const { data, error } = await db
    .from("engagement_prospects")
    .insert(rows)
    .select("*");

  if (error) return { ok: false, error: error.message };
  return { ok: true, prospects: data || [], duplicates, stats };
}

export async function updateProspectStatus(prospectId, campaignId, userId, nextStatus, meta = {}, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);

  let currentProspect = null;

  if (!db) {
    currentProspect = _localProspects.get(prospectId);
    if (!currentProspect || currentProspect.user_id !== userId) {
      return { ok: false, error: "Prospect not found", status: 404 };
    }
  } else {
    const { data, error } = await db
      .from("engagement_prospects")
      .select("*")
      .eq("id", prospectId)
      .eq("user_id", userId)
      .single();

    if (error || !data) return { ok: false, error: "Prospect not found", status: 404 };
    currentProspect = data;
  }

  const transitionRes = transitionProspect(currentProspect, nextStatus, meta);
  if (!transitionRes.ok) {
    return { ok: false, error: transitionRes.error, reason: transitionRes.reason, status: 400 };
  }

  const updated = transitionRes.prospect;
  const activity = { ...transitionRes.activity, user_id: userId };

  if (!db) {
    _localProspects.set(prospectId, updated);
    const actId = `act_${Date.now()}`;
    _localActivity.set(actId, { id: actId, ...activity });
    return { ok: true, prospect: updated, activity };
  }

  // Dual write prospect update and activity log
  const { error: updateError } = await db
    .from("engagement_prospects")
    .update({
      status: updated.status,
      engagement_score: updated.engagement_score,
      last_contacted_at: updated.last_contacted_at,
      updated_at: updated.updated_at,
    })
    .eq("id", prospectId)
    .eq("user_id", userId);

  if (updateError) return { ok: false, error: updateError.message };

  await db.from("engagement_activity_log").insert(activity);

  return { ok: true, prospect: updated, activity };
}

export async function deleteProspect(prospectId, userId, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);

  if (!db) {
    const p = _localProspects.get(prospectId);
    if (!p || p.user_id !== userId) return { ok: false, error: "Prospect not found", status: 404 };
    _localProspects.delete(prospectId);
    return { ok: true };
  }

  const { error } = await db
    .from("engagement_prospects")
    .delete()
    .eq("id", prospectId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── Messages ───────────────────────────────────────────────────────────────

export async function listMessages(campaignId, userId, filters = {}, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);

  if (!db) {
    let list = Array.from(_localMessages.values())
      .filter((m) => m.user_id === userId && m.campaign_id === campaignId);

    if (filters.approval_status) list = list.filter((m) => m.approval_status === filters.approval_status);
    if (filters.status) list = list.filter((m) => m.status === filters.status);
    return { ok: true, messages: list };
  }

  let query = db
    .from("engagement_messages")
    .select("*, engagement_prospects(first_name, last_name, company, email, phone)")
    .eq("user_id", userId)
    .eq("campaign_id", campaignId);

  if (filters.approval_status) query = query.eq("approval_status", filters.approval_status);
  if (filters.status) query = query.eq("status", filters.status);
  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, messages: data || [] };
}

export async function createMessages(campaignId, userId, rawMessages = [], env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return { ok: true, messages: [] };

  const now = new Date().toISOString();
  const rows = rawMessages.map((m) => ({
    user_id: userId,
    campaign_id: campaignId,
    prospect_id: m.prospect_id,
    channel: m.channel,
    variant: m.variant || "A",
    subject: m.subject || null,
    body: m.body,
    body_html: m.body_html || null,
    status: m.status || "pending_approval",
    approval_status: m.approval_status || "pending",
    rejection_reason: m.rejection_reason || null,
    guardrail_checks: m.guardrail_checks || { passed: true, violations: [] },
    created_at: now,
    updated_at: now,
  }));

  const db = serviceDb(env);

  if (!db) {
    const created = rows.map((r, i) => {
      const id = `msg_${Date.now()}_${i}`;
      const item = { id, ...r };
      _localMessages.set(id, item);
      return item;
    });
    return { ok: true, messages: created };
  }

  const { data, error } = await db
    .from("engagement_messages")
    .insert(rows)
    .select("*");

  if (error) return { ok: false, error: error.message };
  return { ok: true, messages: data || [] };
}

export async function approveMessage(messageId, userId, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);
  const now = new Date().toISOString();

  if (!db) {
    const m = _localMessages.get(messageId);
    if (!m || m.user_id !== userId) return { ok: false, error: "Message not found", status: 404 };
    m.approval_status = "approved";
    m.status = "queued";
    m.updated_at = now;
    _localMessages.set(messageId, m);
    return { ok: true, message: m };
  }

  const { data, error } = await db
    .from("engagement_messages")
    .update({ approval_status: "approved", status: "queued", updated_at: now })
    .eq("id", messageId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, message: data };
}

export async function rejectMessage(messageId, userId, reason = "User rejected", env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);
  const now = new Date().toISOString();

  if (!db) {
    const m = _localMessages.get(messageId);
    if (!m || m.user_id !== userId) return { ok: false, error: "Message not found", status: 404 };
    m.approval_status = "rejected";
    m.status = "rejected";
    m.rejection_reason = reason;
    m.updated_at = now;
    _localMessages.set(messageId, m);
    return { ok: true, message: m };
  }

  const { data, error } = await db
    .from("engagement_messages")
    .update({ approval_status: "rejected", status: "rejected", rejection_reason: reason, updated_at: now })
    .eq("id", messageId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, message: data };
}

// ── Analytics ───────────────────────────────────────────────────────────────

export async function getAnalytics(campaignId, userId, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);

  let prospects = [];
  if (!db) {
    prospects = Array.from(_localProspects.values()).filter(
      (p) => p.user_id === userId && p.campaign_id === campaignId
    );
  } else {
    const { data, error } = await db
      .from("engagement_prospects")
      .select("status, engagement_score")
      .eq("user_id", userId)
      .eq("campaign_id", campaignId);

    if (error) return { ok: false, error: error.message };
    prospects = data || [];
  }

  const counts = {};
  for (const p of prospects) {
    counts[p.status] = (counts[p.status] || 0) + 1;
  }

  const total = prospects.length;
  const sent = (counts.sent || 0) + (counts.delivered || 0) + (counts.opened || 0) + (counts.clicked || 0) + (counts.replied || 0) + (counts.converted || 0);
  const delivered = (counts.delivered || 0) + (counts.opened || 0) + (counts.clicked || 0) + (counts.replied || 0) + (counts.converted || 0);
  const opened = (counts.opened || 0) + (counts.clicked || 0) + (counts.replied || 0) + (counts.converted || 0);
  const clicked = (counts.clicked || 0) + (counts.replied || 0) + (counts.converted || 0);
  const replied = (counts.replied || 0) + (counts.converted || 0);
  const converted = counts.converted || 0;

  return {
    ok: true,
    total_prospects: total,
    counts,
    funnel: { sent, delivered, opened, clicked, replied, converted },
    rates: {
      delivery_rate: sent > 0 ? Math.round((delivered / sent) * 100) : 0,
      open_rate: delivered > 0 ? Math.round((opened / delivered) * 100) : 0,
      click_rate: opened > 0 ? Math.round((clicked / opened) * 100) : 0,
      reply_rate: delivered > 0 ? Math.round((replied / delivered) * 100) : 0,
      conversion_rate: total > 0 ? Math.round((converted / total) * 100) : 0,
    },
  };
}
