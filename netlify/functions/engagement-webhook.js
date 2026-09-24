// netlify/functions/engagement-webhook.js — delivery and engagement events.
//
// Register the provider with its OWN URL:
//   https://<site>/api/engagement-webhook?provider=resend
//
// ── WHAT CHANGED, AND WHY (review F-5, F-6) ─────────────────────────────────
//
// 1. AUTHENTICATION IS THE PROVIDER'S OWN SIGNATURE. 0081 compared a static
//    `x-engagement-secret` header that Resend, Twilio and Telegram never send,
//    and accepted EVERYTHING when that secret was unset. Resend is verified
//    with Svix (engagementGuards.verifyResendSignature); an unset secret is a
//    503, never an open door — the payment-webhook.js rule.
//
// 2. EVENTS CORRELATE BY PROVIDER MESSAGE ID, NEVER BY ADDRESS. 0081 looked up
//    `engagement_prospects` by email across EVERY tenant with limit(1), so one
//    customer's bounce or opt-out landed on another customer's row. The id
//    Resend returned when we sent is stored on the message (unique per
//    provider); an event for an id we never sent is acknowledged and ignored.
//
// 3. THE PROVIDER IS NAMED BY THE URL, NOT GUESSED FROM THE BODY. A body can
//    say anything; the URL is what the operator registered.
//
// Twilio (WhatsApp/SMS) arrives in Phase 3 with X-Twilio-Signature
// verification. Until then those providers get a 404 — a channel we do not
// send on has no events to receive.

import { serviceDb, updateProspectStatus } from "./lib/engagement/engagementStore.js";
import { verifyResendSignature } from "./lib/engagement/engagementGuards.js";
import { applyOptOut } from "./lib/engagement/optOut.js";
import { PROSPECT_STATUSES } from "../../src/lib/engagement/stateMachine.js";
import { SUPPRESSION_REASONS } from "../../src/lib/engagement/suppressionModel.js";

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

/** Resend event type → what it means here. */
const RESEND_EVENTS = {
  "email.delivered": { prospect: PROSPECT_STATUSES.DELIVERED, stamp: "delivered_at", message: "delivered" },
  "email.opened": { prospect: PROSPECT_STATUSES.OPENED, stamp: "opened_at", message: "opened" },
  "email.clicked": { prospect: PROSPECT_STATUSES.CLICKED, stamp: "clicked_at", message: "clicked" },
  "email.bounced": { prospect: PROSPECT_STATUSES.UNRESPONSIVE, suppress: SUPPRESSION_REASONS.BOUNCE, message: "failed" },
  "email.complained": { prospect: PROSPECT_STATUSES.OPTED_OUT, suppress: SUPPRESSION_REASONS.COMPLAINT },
};

/** Message statuses may only move forward; a late "delivered" never overwrites "opened". */
const MESSAGE_RANK = { sent: 1, delivered: 2, opened: 3, clicked: 4, replied: 5 };

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const provider = event.queryStringParameters?.provider;
  if (provider !== "resend") return json(404, { ok: false, code: "provider_not_enabled" });

  const secret = process.env.ENGAGEMENT_RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[engagement-webhook] ENGAGEMENT_RESEND_WEBHOOK_SECRET is not set — refusing all events.");
    return json(503, { ok: false, code: "not_configured" });
  }

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
  const verified = verifyResendSignature({ headers: event.headers, rawBody, secret });
  if (!verified.ok) {
    console.warn("[engagement-webhook] rejected:", verified.code);
    return json(401, { ok: false, code: "invalid_signature" });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json(400, { ok: false, code: "invalid_json" }); }

  try {
    return json(200, await handleResendEvent(payload));
  } catch (err) {
    // A 500 makes Resend retry, which is what we want for a transient failure.
    console.error("[engagement-webhook] handler error:", err);
    return json(500, { ok: false, code: "internal_error" });
  }
};

export async function handleResendEvent(payload, env = process.env) {
  const rule = RESEND_EVENTS[payload?.type];
  if (!rule) return { ok: true, status: "ignored_event_type" };

  const emailId = payload?.data?.email_id;
  if (!emailId) return { ok: true, status: "ignored_no_email_id" };

  const db = serviceDb(env);
  if (!db) throw new Error("store_unconfigured");

  const { data: msg, error } = await db.from("engagement_messages").select("*")
    .eq("provider", "resend").eq("external_message_id", String(emailId)).maybeSingle();
  if (error) throw new Error(error.message);
  // Not ours: transactional mail on the same account, or a message deleted
  // since. Acknowledge so Resend stops retrying.
  if (!msg) return { ok: true, status: "unknown_message" };

  const { data: prospect } = await db.from("engagement_prospects").select("*")
    .eq("id", msg.prospect_id).eq("user_id", msg.user_id).maybeSingle();

  // ── message row ──
  const patch = {};
  if (rule.stamp && !msg[rule.stamp]) patch[rule.stamp] = payload.created_at || new Date().toISOString();
  if (rule.message === "failed") {
    patch.status = "failed";
    patch.failure_code = "bounced";
  } else if (rule.message && (MESSAGE_RANK[rule.message] || 0) > (MESSAGE_RANK[msg.status] || 0)) {
    patch.status = rule.message;
  }
  if (Object.keys(patch).length) {
    await db.from("engagement_messages").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", msg.id);
  }

  // ── consent ──
  if (rule.suppress && prospect) {
    // Only a PERMANENT bounce means the address does not exist. A transient
    // one (mailbox full, greylisting) is not a reason to stop for ever.
    const bounceType = payload?.data?.bounce?.type;
    const permanent = rule.suppress !== SUPPRESSION_REASONS.BOUNCE || !bounceType || /permanent|hard/i.test(bounceType);
    if (permanent) {
      await applyOptOut({
        userId: msg.user_id, prospect, channels: [msg.channel],
        reason: rule.suppress, source: "resend_webhook",
      }, env);
    }
  }

  // ── prospect funnel ──
  if (prospect && rule.prospect && rule.prospect !== PROSPECT_STATUSES.OPTED_OUT) {
    const t = await updateProspectStatus(prospect.id, msg.campaign_id, msg.user_id, rule.prospect, {
      channel: msg.channel, messageId: msg.id, eventType: `webhook_${payload.type.replace("email.", "")}`,
      details: { provider: "resend" },
    }, env);
    // An out-of-order event (a "delivered" arriving after "opened") is a legal
    // no-op, not an error.
    return { ok: true, status: t.ok ? "transitioned" : "no_transition", message_id: msg.id };
  }
  return { ok: true, status: "recorded", message_id: msg.id };
}
