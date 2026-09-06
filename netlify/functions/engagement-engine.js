// netlify/functions/engagement-engine.js — Prospect Engagement Engine API
//
// Endpoints and actions:
//   Campaigns:
//     - action: "list_campaigns"
//     - action: "get_campaign", campaignId
//     - action: "create_campaign", name, description, channel_priority, brand_kit, settings
//     - action: "update_campaign", campaignId, updates
//     - action: "delete_campaign", campaignId
//   Prospects:
//     - action: "list_prospects", campaignId, filters
//     - action: "add_prospects", campaignId, prospects
//     - action: "update_prospect_status", campaignId, prospectId, status, meta
//     - action: "delete_prospect", prospectId
//   Messages & AI Generation:
//     - action: "generate_messages", campaignId, prospect_ids
//     - action: "list_messages", campaignId, filters
//     - action: "approve_message", messageId
//     - action: "reject_message", messageId, reason
//     - action: "dispatch_messages", campaignId, message_ids
//   Analytics & Performance:
//     - action: "get_analytics", campaignId
//
// All operations require an authenticated session (Bearer token).

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import * as store from "./lib/engagement/engagementStore.js";
import { generatePersonalizedVariants } from "../../src/lib/engagement/aiMessageGenerator.js";
import { dispatchMessage, resolveChannelForProspect } from "../../src/lib/engagement/channelRouter.js";
import { PROSPECT_STATUSES } from "../../src/lib/engagement/stateMachine.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const json = (status, body) => ({
  statusCode: status,
  headers: { ...CORS, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try {
    const auth = await authenticateBearer(event, { label: "engagement-engine" });
    if (!auth.ok) {
      return json(auth.status, auth.body);
    }
    const userId = auth.user.id;

    if (event.httpMethod === "GET") {
      return await handleGet(event, userId);
    } else if (event.httpMethod === "POST" || event.httpMethod === "PATCH" || event.httpMethod === "DELETE") {
      return await handlePost(event, userId);
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[engagement-engine] Unhandled error:", err);
    return json(500, { error: err.message || "Engagement engine error" });
  }
};

async function handleGet(event, userId) {
  const q = event.queryStringParameters || {};
  const action = q.action || "list_campaigns";

  if (action === "list_campaigns") {
    const res = await store.listCampaigns(userId);
    return json(res.ok ? 200 : res.status || 400, res);
  }

  if (action === "get_campaign") {
    const res = await store.getCampaign(q.campaign_id || q.campaignId, userId);
    return json(res.ok ? 200 : res.status || 400, res);
  }

  if (action === "list_prospects") {
    const res = await store.listProspects(q.campaign_id || q.campaignId, userId, {
      status: q.status,
      search: q.search,
    });
    return json(res.ok ? 200 : res.status || 400, res);
  }

  if (action === "list_messages") {
    const res = await store.listMessages(q.campaign_id || q.campaignId, userId, {
      approval_status: q.approval_status,
      status: q.status,
    });
    return json(res.ok ? 200 : res.status || 400, res);
  }

  if (action === "get_analytics") {
    const res = await store.getAnalytics(q.campaign_id || q.campaignId, userId);
    return json(res.ok ? 200 : res.status || 400, res);
  }

  return json(400, { error: `Unknown GET action: ${action}` });
}

async function handlePost(event, userId) {
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const action = body.action || event.queryStringParameters?.action;

  // ── Campaigns ─────────────────────────────────────────────────────────────
  if (action === "create_campaign") {
    const res = await store.createCampaign(userId, body);
    return json(res.ok ? 200 : res.status || 400, res);
  }

  if (action === "update_campaign") {
    const res = await store.updateCampaign(body.campaign_id || body.campaignId, userId, body.updates || {});
    return json(res.ok ? 200 : res.status || 400, res);
  }

  if (action === "delete_campaign") {
    const res = await store.deleteCampaign(body.campaign_id || body.campaignId, userId);
    return json(res.ok ? 200 : res.status || 400, res);
  }

  // ── Prospects ─────────────────────────────────────────────────────────────
  if (action === "add_prospects") {
    const res = await store.addProspects(body.campaign_id || body.campaignId, userId, body.prospects || []);
    return json(res.ok ? 200 : res.status || 400, res);
  }

  if (action === "update_prospect_status") {
    const res = await store.updateProspectStatus(
      body.prospect_id || body.prospectId,
      body.campaign_id || body.campaignId,
      userId,
      body.status,
      body.meta || {}
    );
    return json(res.ok ? 200 : res.status || 400, res);
  }

  if (action === "delete_prospect") {
    const res = await store.deleteProspect(body.prospect_id || body.prospectId, userId);
    return json(res.ok ? 200 : res.status || 400, res);
  }

  // ── Messages & AI Generation ──────────────────────────────────────────────
  if (action === "generate_messages") {
    const campaignId = body.campaign_id || body.campaignId;
    const campRes = await store.getCampaign(campaignId, userId);
    if (!campRes.ok) return json(campRes.status || 404, campRes);

    const campaign = campRes.campaign;
    const prospectIds = body.prospect_ids || body.prospectIds;

    const prsRes = await store.listProspects(campaignId, userId);
    let targetProspects = prsRes.prospects || [];
    if (Array.isArray(prospectIds) && prospectIds.length > 0) {
      targetProspects = targetProspects.filter((p) => prospectIds.includes(p.id));
    }

    const messagesToCreate = [];
    for (const p of targetProspects) {
      const variants = generatePersonalizedVariants(p, campaign, campaign.brand_kit);
      for (const v of variants) {
        messagesToCreate.push({
          prospect_id: p.id,
          channel: v.channel,
          variant: v.variant,
          subject: v.subject,
          body: v.body,
          body_html: v.bodyHtml,
          status: "pending_approval",
          approval_status: "pending",
          guardrail_checks: v.guardrails,
        });
      }
    }

    const res = await store.createMessages(campaignId, userId, messagesToCreate);
    return json(res.ok ? 200 : res.status || 400, res);
  }

  if (action === "approve_message") {
    const res = await store.approveMessage(body.message_id || body.messageId, userId);
    return json(res.ok ? 200 : res.status || 400, res);
  }

  if (action === "reject_message") {
    const res = await store.rejectMessage(body.message_id || body.messageId, userId, body.reason);
    return json(res.ok ? 200 : res.status || 400, res);
  }

  if (action === "dispatch_messages") {
    const campaignId = body.campaign_id || body.campaignId;
    const messageIds = body.message_ids || body.messageIds;

    const campRes = await store.getCampaign(campaignId, userId);
    if (!campRes.ok) return json(campRes.status || 404, campRes);

    const msgRes = await store.listMessages(campaignId, userId, { approval_status: "approved" });
    let approvedMessages = msgRes.messages || [];
    if (Array.isArray(messageIds) && messageIds.length > 0) {
      approvedMessages = approvedMessages.filter((m) => messageIds.includes(m.id));
    }

    const prsRes = await store.listProspects(campaignId, userId);
    const prospectMap = new Map((prsRes.prospects || []).map((p) => [p.id, p]));

    const dispatchResults = [];
    for (const msg of approvedMessages) {
      const prospect = prospectMap.get(msg.prospect_id);
      if (!prospect) continue;

      const result = await dispatchMessage(msg, prospect, {
        resend_key: process.env.RESEND_API_KEY,
        twilio_sid: process.env.TWILIO_ACCOUNT_SID,
        twilio_token: process.env.TWILIO_AUTH_TOKEN,
        twilio_phone: process.env.TWILIO_PHONE_NUMBER,
        telegram_token: process.env.TELEGRAM_BOT_TOKEN,
      });

      if (result.ok) {
        // Transition prospect to SENT
        await store.updateProspectStatus(prospect.id, campaignId, userId, PROSPECT_STATUSES.SENT, {
          channel: result.channel,
          messageId: msg.id,
          eventType: "message_dispatched",
          details: { external_message_id: result.external_message_id },
        });
      }

      dispatchResults.push({
        message_id: msg.id,
        prospect_id: prospect.id,
        ...result,
      });
    }

    return json(200, { ok: true, dispatches: dispatchResults });
  }

  return json(400, { error: `Unknown action: ${action}` });
}
