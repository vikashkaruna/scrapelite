// payment-webhook.js — Backend: handle Stripe and Razorpay webhook events.
//
// Stripe endpoint (register in Stripe Dashboard → Developers → Webhooks):
//   URL:    https://<site>/.netlify/functions/payment-webhook
//   Events: checkout.session.completed, customer.subscription.updated,
//           customer.subscription.deleted, invoice.payment_failed
//
// Razorpay endpoint (register in Razorpay Dashboard → Settings → Webhooks):
//   URL:    https://<site>/.netlify/functions/payment-webhook?provider=razorpay
//   Events: payment.captured, payment.failed, subscription.activated,
//           subscription.cancelled, subscription.charged

import { createHmac, timingSafeEqual } from "crypto";

// ── Lightweight Supabase REST client (no SDK required in Functions) ───────────
function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;

  const base = {
    apikey:          key,
    Authorization:   `Bearer ${key}`,
    "Content-Type":  "application/json",
  };

  async function req(path, method, body, extra = {}) {
    const res = await fetch(`${url}/rest/v1${path}`, {
      method,
      headers: { ...base, ...extra },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok && res.status !== 404 && res.status !== 409) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase ${method} ${path} → HTTP ${res.status}: ${text}`);
    }
    return res;
  }

  return {
    upsertSubscription: (data) =>
      req("/subscriptions", "POST", data, { Prefer: "resolution=merge-duplicates,return=minimal" }),

    patchSubscription: (sessionId, patch) =>
      req(`/subscriptions?session_id=eq.${encodeURIComponent(sessionId)}`, "PATCH", patch),

    // Idempotent: skip if an event with the same provider_event_id already exists.
    // Prevents double-logging when both the client handler and the webhook fire.
    insertPaymentEvent: async (data) => {
      if (data.provider_event_id) {
        const check = await req(
          `/payment_events?provider_event_id=eq.${encodeURIComponent(data.provider_event_id)}&select=id&limit=1`,
          "GET"
        );
        const rows = await check.json().catch(() => []);
        if (Array.isArray(rows) && rows.length > 0) return check; // already recorded
      }
      return req("/payment_events", "POST", data, { Prefer: "return=minimal" });
    },
  };
}

export const handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed." }) };
  }

  const provider = event.queryStringParameters?.provider || "stripe";
  const db       = getDb();
  const now      = new Date().toISOString();

  // ── Stripe webhook ──────────────────────────────────────────────────────────
  if (provider === "stripe") {
    const secretKey     = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secretKey) {
      return { statusCode: 501, headers, body: JSON.stringify({ error: "Stripe not configured." }) };
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

    let stripeEvent;
    try {
      if (webhookSecret) {
        stripeEvent = stripe.webhooks.constructEvent(
          event.body,
          event.headers["stripe-signature"] || "",
          webhookSecret
        );
      } else {
        console.warn("[webhook/stripe] STRIPE_WEBHOOK_SECRET not set — skipping signature check.");
        stripeEvent = JSON.parse(event.body);
      }
    } catch (e) {
      console.error("[webhook/stripe] Signature error:", e.message);
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Webhook signature error: ${e.message}` }) };
    }

    const obj = stripeEvent.data?.object || {};

    try {
      switch (stripeEvent.type) {
        case "checkout.session.completed": {
          const planId    = obj.metadata?.planId;
          const sessionId = obj.metadata?.sessionId;
          const bp        = obj.metadata?.billingPeriod || "monthly";
          console.log(`[webhook/stripe] checkout.session.completed plan=${planId} session=${sessionId}`);
          if (planId && sessionId && db) {
            await db.upsertSubscription({
              session_id:               sessionId,
              plan_id:                  planId,
              status:                   "active",
              provider:                 "stripe",
              provider_subscription_id: obj.subscription || null,
              provider_customer_id:     obj.customer     || null,
              current_period_start:     now,
              current_period_end:       null,
              updated_at:               now,
            });
            await db.insertPaymentEvent({
              session_id:        sessionId,
              event_type:        "checkout.session.completed",
              provider:          "stripe",
              provider_event_id: stripeEvent.id,
              plan_id:           planId,
              amount_cents:      obj.amount_total || null,
              currency:          obj.currency     || null,
              status:            "completed",
            });
          }
          break;
        }

        case "customer.subscription.updated": {
          console.log(`[webhook/stripe] subscription.updated status=${obj.status} sub=${obj.id}`);
          // Primary activation via /payment/success redirect; webhook is a safety net.
          break;
        }

        case "customer.subscription.deleted": {
          console.log(`[webhook/stripe] subscription.deleted sub=${obj.id}`);
          // We don't have a direct sessionId→subscriptionId mapping here; downgrade
          // is handled on next login via fetchSubscriptionFromDb.
          break;
        }

        case "invoice.payment_failed": {
          console.log(`[webhook/stripe] invoice.payment_failed amount=${obj.amount_due} customer=${obj.customer}`);
          const sid = obj.metadata?.sessionId;
          if (sid && db) {
            await db.insertPaymentEvent({
              session_id:        sid,
              event_type:        "invoice.payment_failed",
              provider:          "stripe",
              provider_event_id: stripeEvent.id,
              plan_id:           null,
              amount_cents:      obj.amount_due || null,
              currency:          obj.currency   || null,
              status:            "failed",
            });
          }
          break;
        }

        default:
          console.log(`[webhook/stripe] unhandled event: ${stripeEvent.type}`);
      }
    } catch (dbErr) {
      // Log but return 200 — Stripe will retry on non-2xx, which we want to avoid for DB errors.
      console.error("[webhook/stripe] DB write error:", dbErr.message);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
  }

  // ── Razorpay webhook ────────────────────────────────────────────────────────
  if (provider === "razorpay") {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (webhookSecret) {
      const generated = createHmac("sha256", webhookSecret).update(event.body).digest("hex");
      const received  = event.headers["x-razorpay-signature"] || "";
      let valid = false;
      try {
        const genBuf  = Buffer.from(generated, "hex");
        const recvBuf = Buffer.from(received,   "hex");
        valid = genBuf.length === recvBuf.length && timingSafeEqual(genBuf, recvBuf);
      } catch { valid = false; }

      if (!valid) {
        console.warn("[webhook/razorpay] Invalid HMAC signature — rejecting.");
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid webhook signature." }) };
      }
    } else {
      console.warn("[webhook/razorpay] RAZORPAY_WEBHOOK_SECRET not set — skipping signature check.");
    }

    let payload;
    try { payload = JSON.parse(event.body); } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON." }) };
    }

    const pmtEntity  = payload.payload?.payment?.entity;
    const subEntity  = payload.payload?.subscription?.entity;
    const entity     = pmtEntity || subEntity;
    const planId     = entity?.notes?.planId     || null;
    const sessionId  = entity?.notes?.sessionId  || null;
    const bp         = entity?.notes?.billingPeriod || "monthly";

    try {
      switch (payload.event) {
        case "payment.captured": {
          const payId  = pmtEntity?.id;
          const amount = pmtEntity?.amount;
          const cur    = pmtEntity?.currency || "INR";
          console.log(`[webhook/razorpay] payment.captured payId=${payId} plan=${planId} session=${sessionId} amount=${amount}${cur}`);
          if (db) {
            if (sessionId && planId) {
              await db.upsertSubscription({
                session_id:               sessionId,
                plan_id:                  planId,
                status:                   "active",
                provider:                 "razorpay",
                provider_subscription_id: pmtEntity?.order_id || null,
                provider_customer_id:     pmtEntity?.contact  || null,
                current_period_start:     now,
                current_period_end:       null,
                updated_at:               now,
              });
            }
            if (sessionId) {
              await db.insertPaymentEvent({
                session_id:        sessionId,
                event_type:        "payment.captured",
                provider:          "razorpay",
                provider_event_id: payId,
                plan_id:           planId,
                amount_cents:      amount,
                currency:          cur,
                status:            "completed",
              });
            }
          }
          break;
        }

        case "payment.failed": {
          const payId  = pmtEntity?.id;
          const errDesc = pmtEntity?.error_description || pmtEntity?.error_reason || "unknown";
          console.log(`[webhook/razorpay] payment.failed payId=${payId} plan=${planId} reason=${errDesc}`);
          if (db && sessionId) {
            await db.insertPaymentEvent({
              session_id:        sessionId,
              event_type:        "payment.failed",
              provider:          "razorpay",
              provider_event_id: payId,
              plan_id:           planId,
              amount_cents:      pmtEntity?.amount   || null,
              currency:          pmtEntity?.currency || "INR",
              status:            "failed",
            });
          }
          break;
        }

        case "subscription.activated": {
          const subId = subEntity?.id;
          const start = subEntity?.current_start ? new Date(subEntity.current_start * 1000).toISOString() : now;
          const end   = subEntity?.current_end   ? new Date(subEntity.current_end   * 1000).toISOString() : null;
          console.log(`[webhook/razorpay] subscription.activated sub=${subId} plan=${planId}`);
          if (db && sessionId && planId) {
            await db.upsertSubscription({
              session_id:               sessionId,
              plan_id:                  planId,
              status:                   "active",
              provider:                 "razorpay",
              provider_subscription_id: subId,
              current_period_start:     start,
              current_period_end:       end,
              updated_at:               now,
            });
          }
          break;
        }

        case "subscription.charged": {
          const payId = pmtEntity?.id;
          console.log(`[webhook/razorpay] subscription.charged plan=${planId} session=${sessionId}`);
          if (db && sessionId) {
            await db.insertPaymentEvent({
              session_id:        sessionId,
              event_type:        "subscription.charged",
              provider:          "razorpay",
              provider_event_id: payId,
              plan_id:           planId,
              amount_cents:      pmtEntity?.amount   || null,
              currency:          pmtEntity?.currency || "INR",
              status:            "completed",
            });
            await db.patchSubscription(sessionId, { status: "active", current_period_start: now, updated_at: now });
          }
          break;
        }

        case "subscription.cancelled": {
          const subId = subEntity?.id;
          console.log(`[webhook/razorpay] subscription.cancelled sub=${subId}`);
          if (db && sessionId) {
            await db.patchSubscription(sessionId, { status: "cancelled", updated_at: now });
            await db.insertPaymentEvent({
              session_id:        sessionId,
              event_type:        "subscription.cancelled",
              provider:          "razorpay",
              provider_event_id: subId,
              plan_id:           planId,
              amount_cents:      null,
              currency:          null,
              status:            "cancelled",
            });
          }
          break;
        }

        case "subscription.pending": {
          console.log(`[webhook/razorpay] subscription.pending plan=${planId}`);
          if (db && sessionId && planId) {
            await db.upsertSubscription({
              session_id:  sessionId,
              plan_id:     planId,
              status:      "pending",
              provider:    "razorpay",
              updated_at:  now,
            });
          }
          break;
        }

        default:
          console.log(`[webhook/razorpay] unhandled event: ${payload.event}`);
      }
    } catch (dbErr) {
      // Return 200 so Razorpay doesn't retry — DB errors are non-fatal for webhook delivery.
      console.error("[webhook/razorpay] DB write error:", dbErr.message);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown provider. Use ?provider=stripe or ?provider=razorpay." }) };
};
