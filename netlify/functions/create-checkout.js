// create-checkout.js — Backend: create a Stripe Checkout session or Razorpay order.
// POST body: { provider, planId, priceId?, currency, amount?, discountPercent?,
//              sessionId, email?, successUrl, cancelUrl }

const PLAN_PRICES_USD = { free: 0, select: 19, pro: 29, business: 79, agency: 199 };
const BUNDLE_PRICES_USD = {
  "extractions-bundle": 9,
  "scheduler-addon": 5,
  "hubspot-addon": 12,
};

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { provider, planId, priceId, currency, amount, discountPercent, sessionId, email, successUrl, cancelUrl } = body;

  // ── Stripe ──────────────────────────────────────────────────────────────────
  if (provider === "stripe") {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return { statusCode: 501, headers, body: JSON.stringify({ error: "Stripe not configured on this server." }) };
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

    // Decide if this is a subscription or one-time payment
    const isBundleId = Boolean(BUNDLE_PRICES_USD[planId]);
    const mode = isBundleId ? "payment" : "subscription";

    try {
      const lineItems = [{ price: priceId, quantity: 1 }];
      const params = {
        mode,
        line_items: lineItems,
        success_url: successUrl,
        cancel_url:  cancelUrl,
        metadata:    { sessionId: sessionId || "", planId: planId || "" },
        ...(email ? { customer_email: email } : {}),
      };

      // Apply discount coupon if provided — tries to look it up in Stripe
      if (discountPercent > 0) {
        try {
          // Create an ephemeral Stripe coupon for this discount
          const coupon = await stripe.coupons.create({
            percent_off: Math.min(100, Math.round(discountPercent)),
            duration: "once",
            name: "DatIQ discount",
          });
          params.discounts = [{ coupon: coupon.id }];
        } catch { /* skip coupon if creation fails */ }
      }

      const session = await stripe.checkout.sessions.create(params);
      return { statusCode: 200, headers, body: JSON.stringify({ url: session.url, checkoutSessionId: session.id }) };
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── Razorpay ─────────────────────────────────────────────────────────────────
  if (provider === "razorpay") {
    const keyId     = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      return { statusCode: 501, headers, body: JSON.stringify({ error: "Razorpay not configured on this server." }) };
    }

    const { default: Razorpay } = await import("razorpay");
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });

    try {
      const order = await rzp.orders.create({
        amount:   amount,
        currency: currency || "INR",
        notes:    { sessionId: sessionId || "", planId: planId || "" },
        receipt:  `rcpt_${sessionId?.slice(-8) || Date.now()}`,
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ orderId: order.id, amount: order.amount, currency: order.currency }),
      };
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown provider. Use 'stripe' or 'razorpay'." }) };
};
