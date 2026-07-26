// verify-payment.js — Backend: verify Stripe session or Razorpay HMAC signature.
// GET  ?provider=stripe&session_id=...
//      → retrieves Stripe session and verifies payment status
// POST { provider:"razorpay", orderId, paymentId, signature, planId, sessionId, billingPeriod }
//      → HMAC-SHA256 verification (timing-safe)

import { createHmac, timingSafeEqual } from "crypto";
import { activateFromInvoice, finalizeInvoice } from "./lib/invoiceService.js";
import { sendInvoiceEmail } from "./lib/invoiceEmail.js";

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
          error:    isNotFound ? "Checkout session not found. Contact hello@datiq.app if you were charged." : e.message,
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
            error:    `Payment is not captured (status: ${status}). If you were charged, contact hello@datiq.app with Payment ID ${paymentId}.`,
            code:     "NOT_CAPTURED",
          }),
        };
      }

      // ── Issue the invoice, and take the AUTHORITATIVE plan from it ───────────
      //
      // SECURITY: this function used to read `planId` and `billingPeriod`
      // straight out of the request body and echo them back, with nothing ever
      // cross-checking them against the order. BillingProvider then activated
      // whatever came back. While entitlements were client-side that was merely
      // untidy; now that the server grants access it is a free-upgrade path
      // (pay for Select, claim Agency). The draft — written server-side at
      // order creation and keyed by the order id — is the only trustworthy
      // source, so the response is now built from the ISSUED INVOICE.
      //
      // finalizeInvoice is idempotent: if the webhook already issued this
      // invoice we get the same row back with created:false and no second
      // number, no second email.
      const { invoice, created, reason } = await finalizeInvoice({
        orderId,
        paymentId,
        provider: "razorpay",
        order,
      });

      if (invoice) {
        await activateFromInvoice(invoice);
        if (created) {
          // Fire-and-forget: a mail failure must never make a paid customer
          // think their payment failed. The invoice exists and is downloadable
          // either way, and invoice_emails guards against a duplicate send.
          sendInvoiceEmail(invoice).catch((e) =>
            console.error("[verify-payment] invoice email failed:", e?.message),
          );
        }
      } else {
        console.error(
          `[verify-payment] no invoice issued for order ${orderId} (${reason}) — payment IS captured`,
        );
      }

      const resolvedPlanId = invoice?.plan_id ?? planId;
      const resolvedPeriod = invoice?.billing_period ?? billingPeriod ?? "monthly";
      if (invoice && planId && invoice.plan_id !== planId) {
        console.warn(
          `[verify-payment] client claimed planId='${planId}' but the order was for '${invoice.plan_id}' — using the order`,
        );
      }

      console.log(`[verify-payment/razorpay] ✓ Verified & captured: orderId=${orderId} paymentId=${paymentId} amount=${order.amount}${order.currency} planId=${resolvedPlanId}`);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          verified:      true,
          planId:        resolvedPlanId,
          sessionId:     sessionId,
          paymentId:     paymentId,
          orderId:       orderId,
          amount:        order.amount,
          currency:      order.currency,
          billingPeriod: resolvedPeriod,
          invoiceId:     invoice?.id ?? null,
          invoiceNo:     invoice?.invoice_no ?? null,
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
          error:    `Your payment was received but confirmation is pending. Please contact hello@datiq.app with Payment ID ${paymentId}.`,
          code:     "CONFIRMATION_PENDING",
          paymentId,
        }),
      };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed." }) };
};
