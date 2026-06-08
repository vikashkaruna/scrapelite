// payment-webhook.js — Backend: handle Stripe and Razorpay webhook events.
// Register in Stripe Dashboard → Developers → Webhooks → Add endpoint:
//   https://your-site.netlify.app/.netlify/functions/payment-webhook
//   Events: checkout.session.completed, customer.subscription.updated,
//           customer.subscription.deleted, invoice.payment_failed

export const handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const provider = event.queryStringParameters?.provider || "stripe";

  // ── Stripe webhook ──────────────────────────────────────────────────────────
  if (provider === "stripe" || !event.queryStringParameters?.provider) {
    const secretKey    = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secretKey) {
      return { statusCode: 501, headers, body: JSON.stringify({ error: "Stripe not configured" }) };
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

    let stripeEvent;
    try {
      if (webhookSecret) {
        stripeEvent = stripe.webhooks.constructEvent(
          event.body,
          event.headers["stripe-signature"],
          webhookSecret
        );
      } else {
        stripeEvent = JSON.parse(event.body);
      }
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Webhook signature error: ${e.message}` }) };
    }

    const session = stripeEvent.data?.object;

    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const planId    = session.metadata?.planId;
        const sessionId = session.metadata?.sessionId;
        if (planId && sessionId) {
          // Future: call Supabase from here to update subscriptions table
          // For now, the frontend handles activation on redirect back to /payment/success
          console.log(`[webhook] checkout.session.completed planId=${planId} sessionId=${sessionId}`);
        }
        break;
      }
      case "customer.subscription.updated": {
        const status = session.status; // active, past_due, canceled, etc.
        console.log(`[webhook] subscription.updated status=${status}`);
        break;
      }
      case "customer.subscription.deleted": {
        console.log(`[webhook] subscription.deleted`);
        break;
      }
      case "invoice.payment_failed": {
        console.log(`[webhook] invoice.payment_failed`);
        break;
      }
      default:
        console.log(`[webhook] unhandled event type: ${stripeEvent.type}`);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
  }

  // ── Razorpay webhook ────────────────────────────────────────────────────────
  if (provider === "razorpay") {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (webhookSecret) {
      const { createHmac } = await import("crypto");
      const generated = createHmac("sha256", webhookSecret).update(event.body).digest("hex");
      const received  = event.headers["x-razorpay-signature"];
      if (generated !== received) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid webhook signature" }) };
      }
    }

    let payload;
    try { payload = JSON.parse(event.body); } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
    }

    const entity   = payload.payload?.payment?.entity || payload.payload?.subscription?.entity;
    const planId   = entity?.notes?.planId;
    const sessionId = entity?.notes?.sessionId;

    switch (payload.event) {
      case "payment.captured":
        console.log(`[webhook/razorpay] payment.captured planId=${planId} sessionId=${sessionId}`);
        break;
      case "subscription.activated":
        console.log(`[webhook/razorpay] subscription.activated planId=${planId}`);
        break;
      case "subscription.cancelled":
        console.log(`[webhook/razorpay] subscription.cancelled`);
        break;
      default:
        console.log(`[webhook/razorpay] unhandled event: ${payload.event}`);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown provider" }) };
};
