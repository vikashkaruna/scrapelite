// verify-payment.js — Backend: verify Stripe session or Razorpay HMAC signature.
// GET  ?provider=stripe&session_id=...
//      → retrieves Stripe session and verifies payment status
// POST { provider:"razorpay", orderId, paymentId, signature, planId, sessionId, billingPeriod }
//      → HMAC-SHA256 verification (timing-safe)

import { createHmac, timingSafeEqual } from "crypto";

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  // ── Stripe session verification (GET) ─────────────────────────────────────
  if (event.httpMethod === "GET") {
    const { provider, session_id } = event.queryStringParameters || {};

    if (provider !== "stripe" || !session_id) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: "Missing 'provider' or 'session_id' parameter.", code: "MISSING_PARAMS", verified: false }),
      };
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return {
        statusCode: 501, headers,
        body: JSON.stringify({ error: "Stripe is not configured on this server.", code: "NOT_CONFIGURED", verified: false }),
      };
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

    try {
      const session  = await stripe.checkout.sessions.retrieve(session_id);
      const verified = session.payment_status === "paid" || session.status === "complete";
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          verified,
          planId:         session.metadata?.planId        || null,
          sessionId:      session.metadata?.sessionId     || null,
          billingPeriod:  session.metadata?.billingPeriod || "monthly",
          customerId:     session.customer                || null,
          subscriptionId: session.subscription            || null,
          amountTotal:    session.amount_total            || null,
          currency:       session.currency                || null,
        }),
      };
    } catch (e) {
      const isNotFound = e.code === "resource_missing" || e.statusCode === 404;
      return {
        statusCode: isNotFound ? 404 : 400, headers,
        body: JSON.stringify({
          error:    isNotFound ? "Checkout session not found. Contact support@datiq.app if you were charged." : e.message,
          code:     e.code || "STRIPE_ERROR",
          verified: false,
        }),
      };
    }
  }

  // ── Razorpay HMAC-SHA256 verification (POST) ───────────────────────────────
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body); } catch {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: "Invalid JSON in request body.", code: "INVALID_JSON", verified: false }),
      };
    }

    const { provider, orderId, paymentId, signature, planId, sessionId, billingPeriod } = body;

    if (provider !== "razorpay") {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: "Unknown provider for POST verify. Expected 'razorpay'.", code: "INVALID_PROVIDER", verified: false }),
      };
    }

    if (!orderId || !paymentId || !signature) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({
          error:    "Missing required fields: orderId, paymentId, signature.",
          code:     "MISSING_FIELDS",
          verified: false,
        }),
      };
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return {
        statusCode: 501, headers,
        body: JSON.stringify({ error: "Razorpay is not configured on this server.", code: "NOT_CONFIGURED", verified: false }),
      };
    }

    // Razorpay HMAC: HMAC-SHA256(orderId + "|" + paymentId, RAZORPAY_KEY_SECRET)
    const generated = createHmac("sha256", keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    // Timing-safe comparison prevents timing side-channel attacks
    let verified = false;
    try {
      const genBuf  = Buffer.from(generated, "hex");
      const recvBuf = Buffer.from(signature,  "hex");
      verified = genBuf.length === recvBuf.length && timingSafeEqual(genBuf, recvBuf);
    } catch {
      verified = false;
    }

    if (verified) {
      console.log(`[verify-payment/razorpay] ✓ Verified: orderId=${orderId} paymentId=${paymentId} planId=${planId}`);
    } else {
      console.warn(`[verify-payment/razorpay] ✗ Mismatch: orderId=${orderId} paymentId=${paymentId}`);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        verified,
        planId:        verified ? planId        : null,
        sessionId:     verified ? sessionId     : null,
        paymentId:     verified ? paymentId     : null,
        orderId:       verified ? orderId       : null,
        billingPeriod: verified ? (billingPeriod || "monthly") : null,
      }),
    };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed." }) };
};
