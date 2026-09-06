// netlify/functions/engagement-webhook.js — Inbound Engagement Webhook Receiver
//
// Receives and processes delivery and engagement signals:
//   1. Resend webhooks (email.delivered, email.opened, email.clicked, email.bounced)
//   2. Twilio webhooks (WhatsApp/SMS status callbacks & inbound replies)
//   3. Telegram Bot updates (inbound messages & replies)
//
// Automatically advances the prospect state machine:
//   Delivered ➔ Opened ➔ Clicked ➔ Replied
//   Inbound "STOP" / "Unsubscribe" keywords immediately trigger the OPTED_OUT state for strict compliance.

import { PROSPECT_STATUSES, transitionProspect } from "../../src/lib/engagement/stateMachine.js";
import { serviceDb } from "./lib/engagement/engagementStore.js";
import crypto from "crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status, body) => ({
  statusCode: status,
  headers: { ...CORS, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  // Webhook signature verification
  const webhookSecret = process.env.ENGAGEMENT_WEBHOOK_SECRET;
  if (webhookSecret) {
    const providedSecret = event.headers["x-engagement-secret"] || "";
    try {
      const expected = Buffer.from(webhookSecret, "utf8");
      const provided = Buffer.from(providedSecret, "utf8");
      if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
        console.warn("[engagement-webhook] Signature verification failed");
        return json(401, { error: "Invalid webhook signature" });
      }
    } catch {
      console.warn("[engagement-webhook] Signature verification error");
      return json(401, { error: "Invalid webhook signature" });
    }
  }

  try {
    let payload = {};
    const rawBody = event.body || "";

    // Handle both JSON (Resend, Telegram) and URL-encoded form bodies (Twilio)
    if (event.headers["content-type"]?.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawBody);
      payload = Object.fromEntries(params.entries());
    } else {
      try {
        payload = JSON.parse(rawBody || "{}");
      } catch {
        payload = { raw: rawBody };
      }
    }

    const provider = detectProvider(event, payload);
    const parsedEvent = parseWebhookEvent(provider, payload);

    if (!parsedEvent || !parsedEvent.eventType) {
      return json(200, { ok: true, status: "ignored_unrecognized_event" });
    }

    const db = serviceDb(process.env);
    if (!db) {
      // Mock environment acknowledgement
      return json(200, { ok: true, mock: true, parsed: parsedEvent });
    }

    // Lookup matching prospect by email or phone
    let prospect = null;
    if (parsedEvent.email) {
      const { data } = await db
        .from("engagement_prospects")
        .select("*")
        .eq("email", parsedEvent.email.toLowerCase().trim())
        .limit(1);
      if (data && data.length > 0) prospect = data[0];
    } else if (parsedEvent.phone) {
      const cleanPhone = parsedEvent.phone.replace(/[^\d+]/g, "");
      const { data } = await db
        .from("engagement_prospects")
        .select("*")
        .ilike("phone", `%${cleanPhone.slice(-8)}%`)
        .limit(1);
      if (data && data.length > 0) prospect = data[0];
    }

    if (!prospect) {
      return json(200, { ok: true, status: "prospect_not_found_logged" });
    }

    // Determine target status
    let targetStatus = null;
    if (parsedEvent.isOptOut) {
      targetStatus = PROSPECT_STATUSES.OPTED_OUT;
    } else if (parsedEvent.eventType === "reply") {
      targetStatus = PROSPECT_STATUSES.REPLIED;
    } else if (parsedEvent.eventType === "click") {
      targetStatus = PROSPECT_STATUSES.CLICKED;
    } else if (parsedEvent.eventType === "open") {
      targetStatus = PROSPECT_STATUSES.OPENED;
    } else if (parsedEvent.eventType === "delivered") {
      targetStatus = PROSPECT_STATUSES.DELIVERED;
    } else if (parsedEvent.eventType === "bounce" || parsedEvent.eventType === "failed") {
      targetStatus = PROSPECT_STATUSES.UNRESPONSIVE;
    }

    if (!targetStatus) {
      return json(200, { ok: true, status: "no_status_change_needed" });
    }

    // Execute state transition
    const transitionRes = transitionProspect(prospect, targetStatus, {
      channel: parsedEvent.channel,
      eventType: `webhook_${parsedEvent.eventType}`,
      details: {
        provider,
        raw_message: parsedEvent.text || null,
        timestamp: new Date().toISOString(),
      },
    });

    if (!transitionRes.ok) {
      return json(200, { ok: true, skipped_transition: transitionRes.reason });
    }

    // Update database
    await db
      .from("engagement_prospects")
      .update({
        status: transitionRes.prospect.status,
        engagement_score: transitionRes.prospect.engagement_score,
        updated_at: new Date().toISOString(),
      })
      .eq("id", prospect.id);

    // Log activity
    await db.from("engagement_activity_log").insert({
      ...transitionRes.activity,
      user_id: prospect.user_id,
    });

    return json(200, {
      ok: true,
      status: "transitioned",
      from: prospect.status,
      to: targetStatus,
      prospect_id: prospect.id,
    });
  } catch (err) {
    console.error("[engagement-webhook] Handler error:", err);
    return json(500, { error: err.message });
  }
};

export function detectProvider(event, payload) {
  if (event.queryStringParameters?.provider) return event.queryStringParameters.provider;
  if (payload.type?.startsWith("email.")) return "resend";
  if (payload.MessageSid || payload.SmsSid || payload.AccountSid) return "twilio";
  if (payload.update_id || payload.message?.chat) return "telegram";
  return "generic";
}

export function parseWebhookEvent(provider, payload) {
  if (provider === "resend") {
    const type = payload.type || "";
    const email = payload.data?.to?.[0] || null;
    let eventType = null;
    if (type.includes("delivered")) eventType = "delivered";
    else if (type.includes("opened")) eventType = "open";
    else if (type.includes("clicked")) eventType = "click";
    else if (type.includes("bounced")) eventType = "bounce";

    return {
      channel: "email",
      eventType,
      email,
      isOptOut: false,
    };
  }

  if (provider === "twilio") {
    const isWhatsApp = payload.From?.startsWith("whatsapp:") || payload.To?.startsWith("whatsapp:");
    const channel = isWhatsApp ? "whatsapp" : "sms";
    const phone = (payload.From || "").replace("whatsapp:", "");
    const bodyText = (payload.Body || "").trim();

    // Check for inbound reply vs delivery status callback
    if (bodyText) {
      const isStop = /^\s*(stop|unsubscribe|cancel|quit|optout)\b/i.test(bodyText);
      return {
        channel,
        eventType: "reply",
        phone,
        text: bodyText,
        isOptOut: isStop,
      };
    }

    const messageStatus = payload.MessageStatus || "";
    let eventType = null;
    if (messageStatus === "delivered") eventType = "delivered";
    else if (messageStatus === "failed" || messageStatus === "undelivered") eventType = "failed";

    return {
      channel,
      eventType,
      phone: (payload.To || "").replace("whatsapp:", ""),
      isOptOut: false,
    };
  }

  if (provider === "telegram") {
    const msg = payload.message || {};
    const text = msg.text || "";
    const isStop = /^\s*(\/stop|stop|unsubscribe)\b/i.test(text);

    return {
      channel: "telegram",
      eventType: "reply",
      phone: msg.from?.username || String(msg.chat?.id || ""),
      text,
      isOptOut: isStop,
    };
  }

  return null;
}
