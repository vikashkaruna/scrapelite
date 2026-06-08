// verify-payment.js — Backend: verify Stripe session or Razorpay HMAC signature.
// GET  ?provider=stripe&session_id=... → retrieve Stripe session & verify payment
// POST {provider:"razorpay", orderId, paymentId, signature, planId, sessionId}

import { createHmac } from "crypto";

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // ── Stripe session GET ────────────────────────────────────────────────────
  if (event.httpMethod === "GET") {
    const { provider, session_id } = event.queryStringParameters || {};
    if (provider !== "stripe" || !session_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing provider or session_id" }) };
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return { statusCode: 501, headers, body: JSON.stringify({ error: "Stripe not configured" }) };
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      const verified = session.payment_status === "paid" || session.status === "complete";
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          verified,
          planId:         session.metadata?.planId || null,
          sessionId:      session.metadata?.sessionId || null,
          customerId:     session.customer || null,
          subscriptionId: session.subscription || null,
          amountTotal:    session.amount_total || null,
          currency:       session.currency || null,
        }),
      };
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: e.message, verified: false }) };
    }
  }

  // ── Razorpay HMAC verification POST ──────────────────────────────────────
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

    const { provider, orderId, paymentId, signature, planId, sessionId } = body;
    if (provider !== "razorpay") {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown provider for POST verify" }) };
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return { statusCode: 501, headers, body: JSON.stringify({ error: "Razorpay not configured" }) };
    }

    // Razorpay HMAC-SHA256: generated_signature = HMAC(orderId + "|" + paymentId, keySecret)
    const generated = createHmac("sha256", keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const verified = generated === signature;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        verified,
        planId:    verified ? planId    : null,
        sessionId: verified ? sessionId : null,
        paymentId: verified ? paymentId : null,
        orderId:   verified ? orderId   : null,
      }),
    };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
};
