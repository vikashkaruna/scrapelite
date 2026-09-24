// netlify/functions/engagement-engine.js — Prospect Engagement Engine API
//
// GET  ?action=
//   access                         beta status, live channels, sender domains
//   list_campaigns | get_campaign  (campaign_id)
//   list_prospects                 (campaign_id, status?, search?)
//   list_messages                  (campaign_id, approval_status?, status?)
//   list_activity                  (prospect_id)
//   list_suppressions              (prospect_id?)  — per-channel opt-outs
//   get_analytics                  (campaign_id)
// POST { action, … }
//   create_campaign | update_campaign | delete_campaign
//   add_prospects | update_prospect | update_prospect_status | delete_prospect
//   generate_messages              (campaign_id, prospect_ids?, channel?)
//   approve_message | reject_message | retry_message
//   send_messages                  (campaign_id, message_ids?)
//   opt_out                        (prospect_id, channels[], note?)
//   lift_suppression               (suppression_id)
//   check_stale_prospects          (campaign_id?)
//
// Every action: a signed-in user (Supabase JWT) AND the beta gate
// (ENGAGEMENT_ENABLED + ENGAGEMENT_ALLOWLIST). There is no API-key path: the
// n8n workflows that tried one could never authenticate (review F-16) and
// were retired in favour of the engagement-dispatcher cron.

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import * as store from "./lib/engagement/engagementStore.js";
import { processQueue } from "./lib/engagement/dispatcher.js";
import { applyOptOut } from "./lib/engagement/optOut.js";
import { engagementAccess, allowedSenderDomains } from "./lib/engagement/engagementGuards.js";
import { mockSendingEnabled } from "./lib/engagement/emailSender.js";
import { createDeadline } from "./lib/audit/deadline.js";
import { generatePersonalizedVariants, assignVariant } from "../../src/lib/engagement/aiMessageGenerator.js";
import { resolveChannelForProspect } from "../../src/lib/engagement/channelRouter.js";
import { PROSPECT_STATUSES, detectStaleProspects } from "../../src/lib/engagement/stateMachine.js";
import {
  LIVE_CHANNELS, SUPPRESSION_CHANNELS, SUPPRESSION_REASONS, addressFor,
  indexSuppressions, findSuppression, canLiftSuppression,
} from "../../src/lib/engagement/suppressionModel.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (status, body) => ({
  statusCode: status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

/** Store results carry their own HTTP status; strip nothing else. */
const reply = (res) => json(res.ok ? 200 : res.status || 400, res);

/** Time the dashboard's "Send" may spend before handing the rest to the cron. */
const SEND_BUDGET_MS = Number(process.env.ENGAGEMENT_SEND_BUDGET_MS) || 7_000;

/** Status moves a person may make by hand on the board. Opt-out has its own action. */
const MANUAL_STATUSES = [
  PROSPECT_STATUSES.NEW, PROSPECT_STATUSES.QUEUED, PROSPECT_STATUSES.REPLIED,
  PROSPECT_STATUSES.FOLLOWUP_DUE, PROSPECT_STATUSES.CONVERTED, PROSPECT_STATUSES.UNRESPONSIVE,
];

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const auth = await authenticateBearer(event, { label: "engagement-engine" });
    if (!auth.ok) return json(auth.status, auth.body);
    const userId = auth.user.id;

    const access = engagementAccess(userId);
    const q = event.queryStringParameters || {};
    if (event.httpMethod === "GET" && q.action === "access") {
      return json(200, {
        ok: true,
        enabled: access.ok,
        code: access.ok ? null : access.code,
        message: access.ok ? null : access.error,
        live_channels: LIVE_CHANNELS,
        sender_domains: access.ok ? allowedSenderDomains() : [],
        mock_sending: access.ok ? mockSendingEnabled() : false,
        // The technical "how to turn test mode off" line is for operators on
        // test environments only; production copy never names settings or providers.
        ops_hint: access.ok && mockSendingEnabled() && process.env.CONTEXT !== "production",
      });
    }
    if (!access.ok) return json(access.status, { ok: false, code: access.code, error: access.error });

    return event.httpMethod === "GET" ? await handleGet(q, userId) : await handlePost(event, userId);
  } catch (err) {
    // Logged in full, returned as a code: a raw error message can carry table
    // names, constraint names or a provider's response (review F-26).
    console.error("[engagement-engine] Unhandled error:", err);
    return json(500, { ok: false, code: "internal_error", error: "Something went wrong. Please try again." });
  }
};

async function handleGet(q, userId) {
  const action = q.action || "list_campaigns";
  const campaignId = q.campaign_id || q.campaignId;
  const need = () => json(400, { ok: false, code: "campaign_required", error: "Missing campaign_id." });

  switch (action) {
    case "list_campaigns": return reply(await store.listCampaigns(userId));
    case "get_campaign": return campaignId ? reply(await store.getCampaign(campaignId, userId)) : need();
    case "list_prospects":
      return campaignId ? reply(await store.listProspects(campaignId, userId, { status: q.status, search: q.search })) : need();
    case "list_messages":
      return campaignId ? reply(await store.listMessages(campaignId, userId, { approval_status: q.approval_status, status: q.status })) : need();
    case "get_analytics": return campaignId ? reply(await store.getAnalytics(campaignId, userId)) : need();
    case "list_activity": {
      const pid = q.prospect_id;
      if (!pid) return json(400, { ok: false, code: "prospect_required", error: "Missing prospect_id." });
      return reply(await store.listActivity(pid, userId));
    }
    case "list_suppressions": {
      if (q.prospect_id) {
        const pr = await store.getProspect(q.prospect_id, userId);
        if (!pr.ok) return reply(pr);
        const addresses = [...new Set(SUPPRESSION_CHANNELS.map((c) => addressFor(pr.prospect, c)).filter(Boolean))];
        const res = await store.listSuppressions(userId, { addresses });
        if (!res.ok) return reply(res);
        return json(200, { ok: true, suppressions: withLiftable(res.suppressions) });
      }
      const res = await store.listSuppressions(userId, { channel: q.channel });
      return res.ok ? json(200, { ok: true, suppressions: withLiftable(res.suppressions) }) : reply(res);
    }
    default:
      return json(400, { ok: false, code: "unknown_action", error: "Unknown action." });
  }
}

const withLiftable = (rows) => rows.map((s) => ({ ...s, liftable: canLiftSuppression(s) }));

function ids(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string").slice(0, 500) : null;
}

async function handlePost(event, userId) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, code: "invalid_json", error: "Invalid JSON body." }); }
  if (!body || typeof body !== "object") return json(400, { ok: false, code: "invalid_json", error: "Invalid JSON body." });

  const action = body.action;
  const campaignId = body.campaign_id || body.campaignId;
  const prospectId = body.prospect_id || body.prospectId;
  const messageId = body.message_id || body.messageId;

  switch (action) {
    // ── Campaigns ────────────────────────────────────────────────────────────
    case "create_campaign": return reply(await store.createCampaign(userId, body));
    case "update_campaign": {
      if (!campaignId) return json(400, { ok: false, code: "campaign_required", error: "Missing campaign_id." });
      const updates = body.updates || {};
      const res = await store.updateCampaign(campaignId, userId, updates);
      // A new brand kit rewrites the drafts that have not left yet (owner
      // request 2026-09-24); the response says what changed.
      if (res.ok && updates && typeof updates === "object" && "brand_kit" in updates) {
        const refresh = await store.refreshUnsentMessages(campaignId, userId);
        return reply({ ...res, refresh: refresh.ok ? { refreshed: refresh.refreshed, backToReview: refresh.backToReview, keptEdited: refresh.keptEdited } : null });
      }
      return reply(res);
    }
    case "delete_campaign":
      if (!campaignId) return json(400, { ok: false, code: "campaign_required", error: "Missing campaign_id." });
      return reply(await store.deleteCampaign(campaignId, userId));

    // ── Prospects ────────────────────────────────────────────────────────────
    case "add_prospects":
      if (!campaignId) return json(400, { ok: false, code: "campaign_required", error: "Missing campaign_id." });
      return reply(await store.addProspects(campaignId, userId, body.prospects || []));

    case "update_prospect_status": {
      if (!prospectId || !campaignId || !body.status) {
        return json(400, { ok: false, code: "missing_fields", error: "prospect_id, campaign_id and status are required." });
      }
      if (body.status === PROSPECT_STATUSES.OPTED_OUT) {
        return json(400, { ok: false, code: "use_opt_out", error: "Use opt-out to stop contacting someone, so it is recorded per channel." });
      }
      if (!MANUAL_STATUSES.includes(body.status)) {
        return json(400, { ok: false, code: "status_not_manual", error: "That status is set by delivery events, not by hand." });
      }
      // `meta` is built HERE. The request's own meta is never forwarded — it
      // used to carry `adminOverride`, a client-settable "un-opt-out" (F-3).
      return reply(await store.updateProspectStatus(prospectId, campaignId, userId, body.status, {
        eventType: "manual_status_change",
        details: body.note ? { note: String(body.note).slice(0, 500) } : {},
      }));
    }

    case "add_note": {
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
      if (!prospectId || !note) return json(400, { ok: false, code: "note_required", error: "A prospect and a note are required." });
      const pr = await store.getProspect(prospectId, userId);
      if (!pr.ok) return reply(pr);
      const { error } = await store.serviceDb().from("engagement_activity_log").insert({
        user_id: userId, campaign_id: pr.prospect.campaign_id, prospect_id: pr.prospect.id,
        event_type: "note", details: { note },
      });
      if (error) {
        console.error("[engagement-engine] note write failed:", error.message);
        return json(500, { ok: false, code: "store_error", error: "Could not save the note." });
      }
      return json(200, { ok: true });
    }

    case "update_prospect":
      if (!prospectId) return json(400, { ok: false, code: "prospect_required", error: "Missing prospect_id." });
      return reply(await store.updateProspect(prospectId, userId, body.updates || {}));

    case "delete_prospect":
      if (!prospectId) return json(400, { ok: false, code: "prospect_required", error: "Missing prospect_id." });
      return reply(await store.deleteProspect(prospectId, userId));

    // ── Messages ─────────────────────────────────────────────────────────────
    case "generate_messages": return generateMessages(userId, campaignId, ids(body.prospect_ids || body.prospectIds), body.channel);

    case "approve_message":
      if (!messageId) return json(400, { ok: false, code: "message_required", error: "Missing message_id." });
      return reply(await store.approveMessage(messageId, userId, process.env, body.edits || null));
    case "reject_message":
      if (!messageId) return json(400, { ok: false, code: "message_required", error: "Missing message_id." });
      return reply(await store.rejectMessage(messageId, userId, body.reason));
    case "retry_message":
      if (!messageId) return json(400, { ok: false, code: "message_required", error: "Missing message_id." });
      return reply(await store.retryMessage(messageId, userId));

    case "send_messages": {
      if (!campaignId) return json(400, { ok: false, code: "campaign_required", error: "Missing campaign_id." });
      const camp = await store.getCampaign(campaignId, userId);
      if (!camp.ok) return reply(camp);
      const res = await processQueue({
        userId, campaignId, messageIds: ids(body.message_ids || body.messageIds),
        deadline: createDeadline(SEND_BUDGET_MS),
      });
      // Results carry codes only — never provider response text.
      return json(res.ok ? 200 : res.status || 500, res);
    }

    // ── Consent ──────────────────────────────────────────────────────────────
    case "opt_out": {
      if (!prospectId) return json(400, { ok: false, code: "prospect_required", error: "Missing prospect_id." });
      const channels = Array.isArray(body.channels) ? body.channels.filter((c) => SUPPRESSION_CHANNELS.includes(c)) : [];
      if (!channels.length) return json(400, { ok: false, code: "channels_required", error: "Choose at least one channel." });
      const pr = await store.getProspect(prospectId, userId);
      if (!pr.ok) return reply(pr);
      return reply(await applyOptOut({
        userId, prospect: pr.prospect, channels,
        reason: SUPPRESSION_REASONS.MANUAL, source: "dashboard",
        note: body.note ? String(body.note).slice(0, 500) : null,
      }));
    }

    case "lift_suppression": {
      const sid = body.suppression_id;
      if (!sid) return json(400, { ok: false, code: "suppression_required", error: "Missing suppression_id." });
      const s = await store.getSuppression(sid, userId);
      if (!s.ok) return reply(s);
      if (!canLiftSuppression(s.suppression)) {
        return json(403, { ok: false, code: "not_liftable", error: "This opt-out was made by the recipient and cannot be removed from the dashboard." });
      }
      const del = await store.deleteSuppression(sid, userId);
      if (del.ok && s.suppression.prospect_id) {
        const pr = await store.getProspect(s.suppression.prospect_id, userId);
        if (pr.ok) {
          const db = store.serviceDb();
          await db.from("engagement_activity_log").insert({
            user_id: userId, campaign_id: pr.prospect.campaign_id, prospect_id: pr.prospect.id,
            event_type: "channel_opt_out_lifted", channel: s.suppression.channel,
            details: { previous_reason: s.suppression.reason },
          });
        }
      }
      return reply(del);
    }

    case "check_stale_prospects": return checkStale(userId, campaignId);

    default:
      return json(400, { ok: false, code: "unknown_action", error: "Unknown action." });
  }
}

/**
 * One draft per prospect, on one channel, with the prospect's assigned A/B
 * variant (review F-2). Prospects who are suppressed on that channel, opted
 * out, unreachable on it, or already have an open message there are skipped
 * and reported — never silently dropped.
 */
async function generateMessages(userId, campaignId, prospectIds, requestedChannel) {
  if (!campaignId) return json(400, { ok: false, code: "campaign_required", error: "Missing campaign_id." });
  const camp = await store.getCampaign(campaignId, userId);
  if (!camp.ok) return reply(camp);
  const campaign = camp.campaign;

  if (requestedChannel && !LIVE_CHANNELS.includes(requestedChannel)) {
    return json(400, { ok: false, code: "channel_not_enabled", error: `${requestedChannel} is not available yet. Email is the only live channel.` });
  }

  const prs = await store.listProspects(campaignId, userId);
  if (!prs.ok) return reply(prs);
  let targets = prs.prospects;
  if (prospectIds) targets = targets.filter((p) => prospectIds.includes(p.id));

  const skipped = [];
  const plan = [];
  for (const p of targets) {
    const channel = requestedChannel || resolveChannelForProspect(p, campaign.channel_priority, { liveOnly: true });
    if (!channel) { skipped.push({ prospect_id: p.id, code: "no_live_channel" }); continue; }
    if (!addressFor(p, channel)) { skipped.push({ prospect_id: p.id, code: "no_address" }); continue; }
    if (p.status === PROSPECT_STATUSES.OPTED_OUT) { skipped.push({ prospect_id: p.id, code: "opted_out" }); continue; }
    plan.push({ p, channel });
  }

  // Suppressions and open messages, per channel, in two queries rather than N.
  const byChannel = new Map();
  for (const x of plan) byChannel.set(x.channel, [...(byChannel.get(x.channel) || []), x]);
  const rows = [];
  for (const [channel, list] of byChannel) {
    const sup = await store.listSuppressions(userId, { channel, addresses: list.map((x) => addressFor(x.p, channel)) });
    if (!sup.ok) return reply(sup);
    const index = indexSuppressions(sup.suppressions);
    const open = await store.openMessagesFor(list.map((x) => x.p.id), channel, userId);
    if (!open.ok) return reply(open);
    const hasOpen = new Set(open.messages.map((m) => m.prospect_id));

    for (const { p } of list) {
      const s = findSuppression(index, p, channel);
      if (s) { skipped.push({ prospect_id: p.id, code: `suppressed_${s.reason}` }); continue; }
      if (hasOpen.has(p.id)) { skipped.push({ prospect_id: p.id, code: "already_drafted" }); continue; }
      const [v] = generatePersonalizedVariants(p, campaign, campaign.brand_kit, {
        channels: [channel], variants: [assignVariant(p.id)],
      });
      if (!v) { skipped.push({ prospect_id: p.id, code: "no_template" }); continue; }
      rows.push({
        prospect_id: p.id, channel, variant: v.variant, subject: v.subject,
        body: v.body, body_html: v.bodyHtml, guardrail_checks: v.guardrails,
      });
    }
  }

  const res = await store.createMessages(campaignId, userId, rows);
  if (!res.ok) return reply(res);
  return json(200, { ok: true, messages: res.messages, skipped });
}

async function checkStale(userId, campaignId) {
  const camps = campaignId
    ? [await store.getCampaign(campaignId, userId)]
    : [await store.listCampaigns(userId)];
  const list = campaignId
    ? (camps[0].ok ? [camps[0].campaign] : [])
    : (camps[0].ok ? camps[0].campaigns : []);
  if (campaignId && !camps[0].ok) return reply(camps[0]);

  const updated = [];
  for (const c of list) {
    const delay = Number(c.settings?.followup_delay_days) || 4;
    const prs = await store.listProspects(c.id, userId);
    for (const p of detectStaleProspects(prs.prospects || [], delay)) {
      const up = await store.updateProspectStatus(p.id, c.id, userId, PROSPECT_STATUSES.FOLLOWUP_DUE, {
        eventType: "stale_sla_exceeded", details: { followup_delay_days: delay },
      });
      if (up.ok) updated.push(p.id);
    }
  }
  return json(200, { ok: true, stale_count: updated.length, updated });
}
