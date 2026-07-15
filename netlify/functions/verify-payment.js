// verify-payment.js — Backend: verify Stripe session or Razorpay HMAC signature.
// GET  ?provider=stripe&session_id=...
//      → retrieves Stripe session and verifies payment status
// POST { provider:"razorpay", orderId, paymentId, signature, planId, sessionId, billingPeriod }
//      → HMAC-SHA256 verification (timing-safe)

import { createHmac, timingSafeEqual } from "crypto";
import { ALLOWED_BUNDLES, ALLOWED_PLANS } from "./lib/pricingSource.js";

const STRIPE_PRICE_BY_PLAN = {
  select: process.env.STRIPE_PRICE_SELECT || process.env.VITE_STRIPE_PRICE_SELECT || "",
  pro: process.env.STRIPE_PRICE_PRO || process.env.VITE_STRIPE_PRICE_PRO || "",
  business: process.env.STRIPE_PRICE_BUSINESS || process.env.VITE_STRIPE_PRICE_BUSINESS || "",
  agency: process.env.STRIPE_PRICE_AGENCY || process.env.VITE_STRIPE_PRICE_AGENCY || "",
  "extractions-bundle": process.env.STRIPE_PRICE_EXTRACTIONS_BUNDLE || process.env.VITE_STRIPE_PRICE_EXTRACTIONS_BUNDLE || "",
  "scheduler-addon": process.env.STRIPE_PRICE_SCHEDULER_ADDON || process.env.VITE_STRIPE_PRICE_SCHEDULER_ADDON || "",
  "hubspot-addon": process.env.STRIPE_PRICE_HUBSPOT_ADDON || process.env.VITE_STRIPE_PRICE_HUBSPOT_ADDON || "",
};

function isKnownPurchase(id) {
  return ALLOWED_PLANS.has(id) || ALLOWED_BUNDLES.has(id);
}

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
      const session  = await stripe.checkout.sessions.retrieve(session_id, { expand: ["line_items.data.price"] });
      const verified = session.payment_status === "paid" || session.status === "complete";
      const planId = session.metadata?.planId || null;
      const expectedPrice = STRIPE_PRICE_BY_PLAN[planId];
      const actualPrice = session.line_items?.data?.[0]?.price?.id || null;
      if (!verified || !isKnownPurchase(planId) || !expectedPrice || actualPrice !== expectedPrice) {
        return {
          statusCode: 400, headers,
          body: JSON.stringify({ verified: false, error: "Checkout session does not match a configured DatIQ purchase.", code: "CHECKOUT_MISMATCH" }),
        };
      }
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          verified: true,
          planId,
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
          error:    isNotFound ? "Checkout session not found. Contact support@datiq.app if you were charged." : "Unable to verify this checkout session right now. Please try again or contact support@datiq.app.",
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

    const { provider, orderId, paymentId, signature } = body;

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
    let sigValid = false;
    try {
      const genBuf  = Buffer.from(generated, "hex");
      const recvBuf = Buffer.from(signature,  "hex");
      sigValid = genBuf.length === recvBuf.length && timingSafeEqual(genBuf, recvBuf);
    } catch {
      sigValid = false;
    }

    if (!sigValid) {
      console.warn(`[verify-payment/razorpay] ✗ Signature mismatch: orderId=${orderId} paymentId=${paymentId}`);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          verified: false,
          error:    "Payment signature verification failed.",
          code:     "SIGNATURE_MISMATCH",
        }),
      };
    }

    // ── Signature is authentic. Now confirm the payment was actually CAPTURED. ──
    // HMAC proves authenticity, not that money moved. Per Razorpay guide §1.6/§3.2:
    // fetch the payment + order, confirm order match + amount match, and capture if
    // still "authorized" (otherwise Razorpay auto-refunds uncaptured payments).
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId) {
      return {
        statusCode: 501, headers,
        body: JSON.stringify({ error: "Razorpay key id is not configured on this server.", code: "NOT_CONFIGURED", verified: false }),
      };
    }

    try {
      const { default: Razorpay } = await import("razorpay");
      const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });

      const payment = await rzp.payments.fetch(paymentId);

      // 1. Payment must belong to the order we created.
      if (payment.order_id !== orderId) {
        console.warn(`[verify-payment/razorpay] ✗ order_id mismatch: payment.order_id=${payment.order_id} expected=${orderId}`);
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ verified: false, error: "Payment does not match the order.", code: "ORDER_MISMATCH" }),
        };
      }

      // 2. Amount/currency must match the server-authoritative order.
      const order = await rzp.orders.fetch(orderId);
      if (payment.amount !== order.amount || payment.currency !== order.currency) {
        console.warn(`[verify-payment/razorpay] ✗ amount mismatch: payment=${payment.amount}${payment.currency} order=${order.amount}${order.currency}`);
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ verified: false, error: "Payment amount does not match the order.", code: "AMOUNT_MISMATCH" }),
        };
      }

      // The order notes were created by create-checkout.js. Never activate a
      // client-supplied plan/session; bind the verified payment to these values.
      const serverPlanId = order.notes?.planId || "";
      const serverSessionId = order.notes?.sessionId || "";
      const serverBillingPeriod = order.notes?.billingPeriod || "monthly";
      if (!isKnownPurchase(serverPlanId)) {
        return {
          statusCode: 400, headers,
          body: JSON.stringify({ verified: false, error: "Payment order does not match a configured DatIQ purchase.", code: "ORDER_MISMATCH" }),
        };
      }

      // 3. Capture if still authorized (idempotent — re-capturing a captured payment
      //    returns the captured payment rather than erroring in most cases).
      let status = payment.status;
      if (status === "authorized") {
        try {
          const captured = await rzp.payments.capture(paymentId, order.amount, order.currency);
          status = captured.status;
        } catch (capErr) {
          // If capture fails because it's already captured, treat as captured.
          const cd = (capErr.error?.description || capErr.message || "").toLowerCase();
          if (cd.includes("already been captured") || cd.includes("already captured")) {
            status = "captured";
          } else {
            throw capErr;
          }
        }
      }

      if (status !== "captured") {
        console.warn(`[verify-payment/razorpay] payment not captured: status=${status} paymentId=${paymentId}`);
        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            verified: false,
            error:    `Payment is not captured (status: ${status}). If you were charged, contact support@datiq.app with Payment ID ${paymentId}.`,
            code:     "NOT_CAPTURED",
          }),
        };
      }

      console.log(`[verify-payment/razorpay] ✓ Verified & captured: orderId=${orderId} paymentId=${paymentId} amount=${order.amount}${order.currency} planId=${planId}`);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          verified:      true,
          planId:        serverPlanId,
          sessionId:     serverSessionId,
          paymentId:     paymentId,
          orderId:       orderId,
          amount:        order.amount,
          currency:      order.currency,
          billingPeriod: serverBillingPeriod,
        }),
      };
    } catch (apiErr) {
      // The signature was valid (payment is genuine) but we couldn't confirm capture.
      // Do NOT fail silently for a user who paid — surface a recoverable message.
      console.error("[verify-payment/razorpay] capture/fetch error:", apiErr.error?.description || apiErr.message);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          verified: false,
          error:    `Your payment was received but confirmation is pending. Please contact support@datiq.app with Payment ID ${paymentId}.`,
          code:     "CONFIRMATION_PENDING",
          paymentId,
        }),
      };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed." }) };
};
