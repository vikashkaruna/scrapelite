// netlify/functions/verify-payment.test.js
// C-17..19 — Razorpay HMAC verified with timingSafeEqual; bad sig → SIGNATURE_MISMATCH.
// Authorized payments are captured; captured ones return verified:true. Order/amount
// mismatches are rejected. Stripe path: signature verified, success path returns
// verified:true, missing session_id → 400.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

// ── Mocked Stripe + Razorpay SDKs (dynamic-imported) ──────────────────────────
const { stripeRetrieve, rzpPaymentsFetch, rzpOrdersFetch, rzpPaymentsCapture } = vi.hoisted(() => {
  return {
    stripeRetrieve:   vi.fn(),
    rzpPaymentsFetch: vi.fn(),
    rzpOrdersFetch:   vi.fn(),
    rzpPaymentsCapture: vi.fn(),
  };
});

class StripeMock {
  constructor() {
    this.checkout = { sessions: { retrieve: stripeRetrieve } };
  }
}
class RazorpayMock {
  constructor() {
    this.payments = { fetch: rzpPaymentsFetch, capture: rzpPaymentsCapture };
    this.orders   = { fetch: rzpOrdersFetch };
  }
}

vi.mock("stripe",     () => ({ default: StripeMock }));
vi.mock("razorpay",   () => ({ default: RazorpayMock }));

let handler;

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  vi.resetModules();
  stripeRetrieve.mockReset();
  rzpPaymentsFetch.mockReset();
  rzpOrdersFetch.mockReset();
  rzpPaymentsCapture.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/verify-payment.js");
  return mod.handler;
}

// Helper: produce a valid Razorpay HMAC for the given orderId/paymentId/secret.
function rzpSig(orderId, paymentId, secret) {
  return createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

// ── C-17: Razorpay HMAC + timingSafeEqual ─────────────────────────────────────
describe("verify-payment Razorpay (C-17) — HMAC", () => {
  it("valid HMAC + captured payment → verified:true", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    const orderId = "order_1", paymentId = "pay_1";
    rzpPaymentsFetch.mockResolvedValueOnce({
      id: paymentId, order_id: orderId, amount: 10000, currency: "INR", status: "captured",
    });
    rzpOrdersFetch.mockResolvedValueOnce({
      id: orderId, amount: 10000, currency: "INR",
    });
    // No capture() call because payment is already captured
    const sig = rzpSig(orderId, paymentId, "rzp_secret");
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", orderId, paymentId, signature: sig,
        planId: "pro", sessionId: "sess_abc", billingPeriod: "monthly",
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.verified).toBe(true);
    expect(body.planId).toBe("pro");
    expect(body.paymentId).toBe(paymentId);
    expect(body.orderId).toBe(orderId);
    expect(body.amount).toBe(10000);
    expect(body.currency).toBe("INR");
  });

  it("bad HMAC → 200 verified:false SIGNATURE_MISMATCH (no API calls)", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay",
        orderId: "order_x", paymentId: "pay_x",
        signature: "deadbeef".repeat(8), // 64 hex chars but wrong HMAC
        planId: "pro", sessionId: "sess_abc",
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.verified).toBe(false);
    expect(body.code).toBe("SIGNATURE_MISMATCH");
    // rzp.payments.fetch was NEVER called (HMAC failed first)
    expect(rzpPaymentsFetch).not.toHaveBeenCalled();
  });

  it("short / malformed signature → 200 SIGNATURE_MISMATCH (timingSafeEqual throws)", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay",
        orderId: "order_x", paymentId: "pay_x",
        signature: "abc", // not even 64 chars
        planId: "pro", sessionId: "sess_abc",
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.verified).toBe(false);
    expect(body.code).toBe("SIGNATURE_MISMATCH");
  });

  it("missing orderId/paymentId/signature → 400 MISSING_FIELDS", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ provider: "razorpay", planId: "pro" }),
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("MISSING_FIELDS");
  });

  it("no RAZORPAY_KEY_SECRET → 501 NOT_CONFIGURED", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", orderId: "o", paymentId: "p", signature: "s",
      }),
    });
    expect(r.statusCode).toBe(501);
    expect(JSON.parse(r.body).code).toBe("NOT_CONFIGURED");
  });

  it("provider != 'razorpay' on POST → 400 INVALID_PROVIDER", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "stripe", orderId: "o", paymentId: "p", signature: "s",
      }),
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("INVALID_PROVIDER");
  });
});

// ── C-18: authorized → captured; order_id mismatch → reject ──────────────────
describe("verify-payment Razorpay (C-18) — capture + order match", () => {
  it("authorized → capture() is called → verified:true", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    const orderId = "order_2", paymentId = "pay_2";
    rzpPaymentsFetch.mockResolvedValueOnce({
      id: paymentId, order_id: orderId, amount: 50000, currency: "INR", status: "authorized",
    });
    rzpOrdersFetch.mockResolvedValueOnce({
      id: orderId, amount: 50000, currency: "INR",
    });
    rzpPaymentsCapture.mockResolvedValueOnce({
      id: paymentId, status: "captured",
    });
    const sig = rzpSig(orderId, paymentId, "rzp_secret");
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", orderId, paymentId, signature: sig,
        planId: "agency", sessionId: "sess_abc",
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.verified).toBe(true);
    expect(rzpPaymentsCapture).toHaveBeenCalledWith(paymentId, 50000, "INR");
  });

  it("payment.order_id !== body.orderId → 200 ORDER_MISMATCH", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    const orderId = "order_3", paymentId = "pay_3";
    rzpPaymentsFetch.mockResolvedValueOnce({
      id: paymentId,
      order_id: "DIFFERENT_ORDER", // <-- mismatch
      amount: 10000, currency: "INR", status: "captured",
    });
    const sig = rzpSig(orderId, paymentId, "rzp_secret");
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", orderId, paymentId, signature: sig,
        planId: "pro", sessionId: "sess_abc",
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.verified).toBe(false);
    expect(body.code).toBe("ORDER_MISMATCH");
    // No capture attempted
    expect(rzpPaymentsCapture).not.toHaveBeenCalled();
  });

  it("amount/currency mismatch → 200 AMOUNT_MISMATCH", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    const orderId = "order_4", paymentId = "pay_4";
    rzpPaymentsFetch.mockResolvedValueOnce({
      id: paymentId, order_id: orderId, amount: 10000, currency: "INR", status: "captured",
    });
    rzpOrdersFetch.mockResolvedValueOnce({
      id: orderId, amount: 99999, currency: "USD", // <-- mismatch
    });
    const sig = rzpSig(orderId, paymentId, "rzp_secret");
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", orderId, paymentId, signature: sig,
        planId: "pro", sessionId: "sess_abc",
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.verified).toBe(false);
    expect(body.code).toBe("AMOUNT_MISMATCH");
  });

  it("payment status not captured (e.g. failed) → 200 NOT_CAPTURED", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    const orderId = "order_5", paymentId = "pay_5";
    rzpPaymentsFetch.mockResolvedValueOnce({
      id: paymentId, order_id: orderId, amount: 10000, currency: "INR", status: "failed",
    });
    rzpOrdersFetch.mockResolvedValueOnce({
      id: orderId, amount: 10000, currency: "INR",
    });
    const sig = rzpSig(orderId, paymentId, "rzp_secret");
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", orderId, paymentId, signature: sig,
        planId: "pro", sessionId: "sess_abc",
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.verified).toBe(false);
    expect(body.code).toBe("NOT_CAPTURED");
  });
});

// ── C-19: Stripe path ────────────────────────────────────────────────────────
describe("verify-payment Stripe (C-19)", () => {
  it("missing session_id → 400 MISSING_PARAMS", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", queryStringParameters: { provider: "stripe" } });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("MISSING_PARAMS");
  });

  it("no STRIPE_SECRET_KEY → 501 NOT_CONFIGURED", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", queryStringParameters: { provider: "stripe", session_id: "cs_test_1" } });
    expect(r.statusCode).toBe(501);
    expect(JSON.parse(r.body).code).toBe("NOT_CONFIGURED");
  });

  it("paid session → verified:true with metadata passthrough", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    stripeRetrieve.mockResolvedValueOnce({
      id: "cs_test_1",
      payment_status: "paid",
      status: "complete",
      metadata: { planId: "pro", sessionId: "sess_abc", billingPeriod: "annual" },
      customer: "cus_1",
      subscription: "sub_1",
      amount_total: 29900,
      currency: "usd",
    });
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", queryStringParameters: { provider: "stripe", session_id: "cs_test_1" } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.verified).toBe(true);
    expect(body.planId).toBe("pro");
    expect(body.sessionId).toBe("sess_abc");
    expect(body.billingPeriod).toBe("annual");
    expect(body.customerId).toBe("cus_1");
    expect(body.subscriptionId).toBe("sub_1");
    expect(body.amountTotal).toBe(29900);
    expect(body.currency).toBe("usd");
  });

  it("unpaid session → verified:false (no throw)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    stripeRetrieve.mockResolvedValueOnce({
      id: "cs_test_2",
      payment_status: "unpaid",
      status: "open",
      metadata: {},
    });
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", queryStringParameters: { provider: "stripe", session_id: "cs_test_2" } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.verified).toBe(false);
  });

  it("session not found (resource_missing) → 404", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    stripeRetrieve.mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "resource_missing", statusCode: 404 }));
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET", queryStringParameters: { provider: "stripe", session_id: "cs_missing" } });
    expect(r.statusCode).toBe(404);
    expect(JSON.parse(r.body).verified).toBe(false);
  });

  it("invalid JSON body on POST → 400 INVALID_JSON", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: "not json" });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("INVALID_JSON");
  });

  it("method not allowed → 405", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "PUT" });
    expect(r.statusCode).toBe(405);
  });
});
