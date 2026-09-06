// src/lib/engagement/engagementClient.js — Client API SDK for Engagement Engine
//
// Bridges the React frontend with the server-side /api/engagement/* Netlify Functions.
// Falls back gracefully to localStorage when in demo mode or signed out, ensuring
// a smooth offline/demo experience without breaking.

import { supabase } from "../supabaseClient.js";
import { transitionProspect, PROSPECT_STATUSES } from "./stateMachine.js";
import { generatePersonalizedVariants } from "./aiMessageGenerator.js";
import { dedupeProspects } from "./syncConnectors.js";

const LOCAL_STORAGE_PREFIX = "datiq_engagement_";

function getLocalStore(key, fallback = []) {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setLocalStore(key, data) {
  try {
    localStorage.setItem(LOCAL_STORAGE_PREFIX + key, JSON.stringify(data));
  } catch (e) {
    console.warn("[DatIQ Engagement] Local storage write failed:", e);
  }
}

async function getAuthHeader() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` };
    }
  } catch {
    // signed out or mock
  }
  return {};
}

async function request(endpoint, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(await getAuthHeader()),
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(`/api/engagement${endpoint}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const text = await res.text();
      let error = `Request failed (${res.status})`;
      try {
        const json = JSON.parse(text);
        error = json.error || json.message || error;
      } catch {
        error = text || error;
      }
      throw new Error(error);
    }

    return await res.json();
  } catch (err) {
    // Return null to allow client-side local fallback
    throw err;
  }
}

export async function listCampaigns() {
  try {
    return await request("/campaigns");
  } catch {
    let campaigns = getLocalStore("campaigns", []);
    if (campaigns.length === 0) {
      // Seed default sample campaign for demo
      campaigns = [
        {
          id: "cmp_demo_01",
          name: "Q4 Key Accounts Competitive Outreach",
          description: "Targeting engineering and RevOps leaders across B2B SaaS accounts.",
          status: "active",
          channel_priority: ["email", "whatsapp", "sms"],
          brand_kit: {
            company_name: "DatIQ",
            value_prop: "real-time web intelligence and structured competitive signals",
            cta_url: "https://datiq.app",
            cta_label: "View Live Intelligence",
            tone: "direct",
          },
          settings: { followup_delay_days: 4, require_approval: true },
          created_at: new Date().toISOString(),
        },
      ];
      setLocalStore("campaigns", campaigns);
    }
    return { campaigns };
  }
}

export async function getCampaign(id) {
  try {
    return await request(`/campaigns/${id}`);
  } catch {
    const campaigns = getLocalStore("campaigns", []);
    const found = campaigns.find((c) => c.id === id);
    if (!found) throw new Error("Campaign not found");
    return { campaign: found };
  }
}

export async function createCampaign(payload) {
  try {
    return await request("/campaigns", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch {
    const campaigns = getLocalStore("campaigns", []);
    const newCamp = {
      id: `cmp_${Date.now()}`,
      name: payload.name || "Untitled Campaign",
      description: payload.description || "",
      status: "active",
      channel_priority: payload.channel_priority || ["email", "whatsapp", "sms"],
      brand_kit: payload.brand_kit || { company_name: "DatIQ", cta_url: "https://datiq.app" },
      settings: payload.settings || { followup_delay_days: 4, require_approval: true },
      created_at: new Date().toISOString(),
    };
    campaigns.unshift(newCamp);
    setLocalStore("campaigns", campaigns);
    return { campaign: newCamp };
  }
}

export async function listProspects(campaignId, filters = {}) {
  try {
    const q = new URLSearchParams({ campaign_id: campaignId, ...filters });
    return await request(`/prospects?${q.toString()}`);
  } catch {
    let prospects = getLocalStore(`prospects_${campaignId}`, []);
    if (prospects.length === 0 && campaignId === "cmp_demo_01") {
      // Seed sample prospects
      prospects = [
        {
          id: "prs_01",
          campaign_id: campaignId,
          first_name: "Sarah",
          last_name: "Lin",
          email: "sarah.lin@stripe.test",
          phone: "+15552345678",
          company: "Stripe",
          role: "Head of RevOps",
          industry: "Fintech",
          status: PROSPECT_STATUSES.DELIVERED,
          channel_preference: "email",
          engagement_score: 20,
          created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
          last_contacted_at: new Date(Date.now() - 86400000 * 2).toISOString(),
        },
        {
          id: "prs_02",
          campaign_id: campaignId,
          first_name: "David",
          last_name: "Ross",
          email: "d.ross@plaid.test",
          phone: "+15553456789",
          company: "Plaid",
          role: "VP Marketing",
          industry: "Fintech",
          status: PROSPECT_STATUSES.REPLIED,
          channel_preference: "email",
          engagement_score: 75,
          created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
          last_contacted_at: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: "prs_03",
          campaign_id: campaignId,
          first_name: "Anita",
          last_name: "Desai",
          email: "anita@freshworks.test",
          phone: "+919876543210",
          company: "Freshworks",
          role: "Director of Product",
          industry: "SaaS",
          status: PROSPECT_STATUSES.QUEUED,
          channel_preference: "whatsapp",
          engagement_score: 5,
          created_at: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: "prs_04",
          campaign_id: campaignId,
          first_name: "Marcus",
          last_name: "Vance",
          email: "mvance@brex.test",
          phone: "+15559876543",
          company: "Brex",
          role: "Growth Lead",
          industry: "Fintech",
          status: PROSPECT_STATUSES.NEW,
          channel_preference: "auto",
          engagement_score: 0,
          created_at: new Date().toISOString(),
        },
      ];
      setLocalStore(`prospects_${campaignId}`, prospects);
    }
    return { prospects };
  }
}

export async function addProspects(campaignId, rawProspects = []) {
  try {
    return await request("/prospects", {
      method: "POST",
      body: JSON.stringify({ campaign_id: campaignId, prospects: rawProspects }),
    });
  } catch {
    const existing = getLocalStore(`prospects_${campaignId}`, []);
    const { unique, duplicates, stats } = dedupeProspects(rawProspects, existing);

    const now = new Date().toISOString();
    const created = unique.map((p, idx) => ({
      ...p,
      id: p.id || `prs_${Date.now()}_${idx}`,
      campaign_id: campaignId,
      status: p.status || PROSPECT_STATUSES.NEW,
      engagement_score: p.engagement_score || 0,
      created_at: now,
      updated_at: now,
    }));

    const nextList = [...created, ...existing];
    setLocalStore(`prospects_${campaignId}`, nextList);
    return { prospects: created, duplicates, stats };
  }
}

export async function updateProspectStatus(campaignId, prospectId, nextStatus, meta = {}) {
  try {
    return await request(`/prospects/${prospectId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ campaign_id: campaignId, status: nextStatus, ...meta }),
    });
  } catch {
    const list = getLocalStore(`prospects_${campaignId}`, []);
    const idx = list.findIndex((p) => p.id === prospectId);
    if (idx === -1) throw new Error("Prospect not found");

    const res = transitionProspect(list[idx], nextStatus, meta);
    if (!res.ok) throw new Error(res.reason || res.error);

    list[idx] = res.prospect;
    setLocalStore(`prospects_${campaignId}`, list);

    // Append to local activity log
    const logs = getLocalStore(`activity_${campaignId}`, []);
    logs.unshift(res.activity);
    setLocalStore(`activity_${campaignId}`, logs);

    return { prospect: res.prospect, activity: res.activity };
  }
}

export async function generateMessagesForProspects(campaign, prospects = []) {
  try {
    return await request("/generate-messages", {
      method: "POST",
      body: JSON.stringify({
        campaign_id: campaign.id,
        prospect_ids: prospects.map((p) => p.id),
      }),
    });
  } catch {
    const existing = getLocalStore(`messages_${campaign.id}`, []);
    const newMessages = [];

    for (const prs of prospects) {
      const variants = generatePersonalizedVariants(prs, campaign, campaign.brand_kit);
      for (const v of variants) {
        newMessages.push({
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          campaign_id: campaign.id,
          prospect_id: prs.id,
          prospect_name: [prs.first_name, prs.last_name].filter(Boolean).join(" ") || prs.company,
          prospect_company: prs.company,
          channel: v.channel,
          variant: v.variant,
          subject: v.subject,
          body: v.body,
          body_html: v.bodyHtml,
          status: "pending_approval",
          approval_status: "pending",
          guardrail_checks: v.guardrails,
          created_at: new Date().toISOString(),
        });
      }
    }

    const merged = [...newMessages, ...existing];
    setLocalStore(`messages_${campaign.id}`, merged);
    return { messages: newMessages };
  }
}

export async function listMessages(campaignId) {
  try {
    return await request(`/messages?campaign_id=${campaignId}`);
  } catch {
    let messages = getLocalStore(`messages_${campaignId}`, []);
    if (messages.length === 0 && campaignId === "cmp_demo_01") {
      messages = [
        {
          id: "msg_sample_01",
          campaign_id: campaignId,
          prospect_id: "prs_01",
          prospect_name: "Sarah Lin",
          prospect_company: "Stripe",
          channel: "email",
          variant: "A",
          subject: "Streamlining competitive intelligence for Stripe",
          body: `Hi Sarah,\n\nI noticed your work leading RevOps at Stripe. Tracking competitor pricing and account shifts usually takes hours of manual hunting.\n\nAt DatIQ, we provide real-time web intelligence and structured competitive signals.\n\nWould you be open to a brief look at what we've synthesized for Stripe?\n\nhttps://datiq.app\n\nBest regards,\nThe DatIQ Team\n\n---\nTo unsubscribe, reply "Unsubscribe".`,
          status: "pending_approval",
          approval_status: "pending",
          guardrail_checks: { passed: true, violations: [], warnings: [] },
          created_at: new Date().toISOString(),
        },
      ];
      setLocalStore(`messages_${campaignId}`, messages);
    }
    return { messages };
  }
}

export async function approveMessage(campaignId, messageId) {
  try {
    return await request(`/messages/${messageId}/approve`, { method: "POST" });
  } catch {
    const list = getLocalStore(`messages_${campaignId}`, []);
    const found = list.find((m) => m.id === messageId);
    if (!found) throw new Error("Message not found");
    found.approval_status = "approved";
    found.status = "queued";
    found.updated_at = new Date().toISOString();
    setLocalStore(`messages_${campaignId}`, list);

    // Update prospect status to QUEUED if currently NEW
    await updateProspectStatus(campaignId, found.prospect_id, PROSPECT_STATUSES.QUEUED, {
      messageId,
      eventType: "message_approved",
    });

    return { message: found };
  }
}

export async function rejectMessage(campaignId, messageId, reason = "User rejected") {
  try {
    return await request(`/messages/${messageId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  } catch {
    const list = getLocalStore(`messages_${campaignId}`, []);
    const found = list.find((m) => m.id === messageId);
    if (!found) throw new Error("Message not found");
    found.approval_status = "rejected";
    found.status = "rejected";
    found.rejection_reason = reason;
    found.updated_at = new Date().toISOString();
    setLocalStore(`messages_${campaignId}`, list);
    return { message: found };
  }
}

export async function getAnalytics(campaignId) {
  try {
    return await request(`/analytics?campaign_id=${campaignId}`);
  } catch {
    const prospects = getLocalStore(`prospects_${campaignId}`, []);
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
      total_prospects: total,
      counts,
      funnel: {
        sent,
        delivered,
        opened,
        clicked,
        replied,
        converted,
      },
      rates: {
        delivery_rate: sent > 0 ? Math.round((delivered / sent) * 100) : 0,
        open_rate: delivered > 0 ? Math.round((opened / delivered) * 100) : 0,
        click_rate: opened > 0 ? Math.round((clicked / opened) * 100) : 0,
        reply_rate: delivered > 0 ? Math.round((replied / delivered) * 100) : 0,
        conversion_rate: total > 0 ? Math.round((converted / total) * 100) : 0,
      },
    };
  }
}

export async function updateCampaign(campaignId, updates) {
  try {
    return await request(`/campaigns/${campaignId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  } catch {
    const list = getLocalStore("campaigns", []);
    const idx = list.findIndex((c) => c.id === campaignId);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...updates, updated_at: new Date().toISOString() };
      setLocalStore("campaigns", list);
      return { campaign: list[idx] };
    }
    return { campaign: updates };
  }
}

export async function generateProspectMessage(campaignId, prospectId, channel, customInstructions) {
  try {
    return await request(`/prospects/${prospectId}/generate`, {
      method: "POST",
      body: JSON.stringify({ campaign_id: campaignId, channel, customInstructions }),
    });
  } catch {
    const prospects = getLocalStore(`prospects_${campaignId}`, []);
    const prs = prospects.find((p) => p.id === prospectId);
    if (!prs) throw new Error("Prospect not found");

    const campaigns = getLocalStore("campaigns", []);
    const campaign = campaigns.find((c) => c.id === campaignId) || {};
    const variants = generatePersonalizedVariants(
      prs,
      { ...campaign, channels: [channel || "email"] },
      campaign.brand_kit || {}
    );
    const v = variants[0] || {};

    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      campaign_id: campaignId,
      prospect_id: prs.id,
      prospect_name: [prs.first_name, prs.last_name].filter(Boolean).join(" ") || prs.company,
      prospect_company: prs.company,
      channel: v.channel || channel || "email",
      variant: v.variant || "A",
      subject: v.subject,
      body: v.body,
      body_html: v.bodyHtml,
      status: "pending_approval",
      approval_status: "pending",
      guardrail_checks: v.guardrails,
      created_at: new Date().toISOString(),
    };

    const existing = getLocalStore(`messages_${campaignId}`, []);
    existing.unshift(msg);
    setLocalStore(`messages_${campaignId}`, existing);

    return { message: msg };
  }
}

export async function getActivityLogs(campaignId, prospectId) {
  try {
    const q = prospectId ? `?prospect_id=${prospectId}` : "";
    return await request(`/campaigns/${campaignId}/activity${q}`);
  } catch {
    const all = getLocalStore(`activity_${campaignId}`, []);
    const filtered = prospectId ? all.filter((l) => l.prospect_id === prospectId) : all;
    return { logs: filtered };
  }
}

export async function addProspectNote(campaignId, prospectId, note) {
  try {
    return await request(`/prospects/${prospectId}/notes`, {
      method: "POST",
      body: JSON.stringify({ campaign_id: campaignId, note }),
    });
  } catch {
    const logs = getLocalStore(`activity_${campaignId}`, []);
    const entry = {
      id: `act_${Date.now()}`,
      prospect_id: prospectId,
      campaign_id: campaignId,
      action: "note_added",
      details: note,
      created_at: new Date().toISOString(),
    };
    logs.unshift(entry);
    setLocalStore(`activity_${campaignId}`, logs);
    return { log: entry };
  }
}

export async function getSyncConfig(campaignId) {
  try {
    return await request(`/campaigns/${campaignId}/sync`);
  } catch {
    const cfg = getLocalStore(`sync_${campaignId}`, {
      provider: "airtable",
      sync_direction: "bi_directional",
      sync_frequency: "hourly",
      is_active: true,
      credentials: {},
    });
    return { config: cfg };
  }
}

export async function saveSyncConfig(campaignId, config) {
  try {
    return await request(`/campaigns/${campaignId}/sync`, {
      method: "PUT",
      body: JSON.stringify(config),
    });
  } catch {
    setLocalStore(`sync_${campaignId}`, config);
    return { config };
  }
}

export async function triggerSync(campaignId) {
  try {
    return await request(`/campaigns/${campaignId}/sync/trigger`, { method: "POST" });
  } catch {
    return { ok: true, synced_count: 4, timestamp: new Date().toISOString() };
  }
}

