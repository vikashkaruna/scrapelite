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
// ⚠️ NO CREDENTIAL IS NEEDED HERE AND NEVER WAS. `stripe` is mocked at the
// module boundary and the key below is the literal string "sk_test"; the old
// "skipped until payment keys are wired" TODO was simply wrong. Stripe remains
// DISABLED in the product — this restores the contract coverage that
// docs/STRIPE-DEFERRAL.md already claims exists, so the deferred path cannot
// rot unnoticed before v2.0 turns it back on.
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

// ── C-20: the paid-upgrade write path (JWT stamping + activation + ledger) ──
// These tests give the function a configured Supabase and prove the exact
// server-side writes a SIGNED-IN buyer's verify must perform — the writes the
// client cannot make itself (subscriptions is RLS-revoked, entitlements is
// service-key-only). Auth is mocked at the supabase-js boundary (repo
// convention, see supabaseServerClient.test.js); the REST/RPC layer runs
// against a routing fetch stub.
const mockGetUser = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

describe("verify-payment Razorpay (C-20) — signed-in activation path", () => {
  const calls = [];
  let fetchRouter;

  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    calls.length = 0;
    mockGetUser.mockReset();
    fetchRouter = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      const method = (opts.method || "GET").toUpperCase();
      calls.push({ u, method, opts });
      const json = (obj, status = 200) =>
        ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
      if (u.includes("/rest/v1/invoice_drafts")) {
        // Draft read: user_id reflects whether the stamp PATCH has landed yet.
        if (method === "GET") {
          const stamped = calls.some((c) => c.method === "PATCH" && c.u.includes("invoice_drafts") && JSON.parse(c.opts.body)?.user_id);
          return json([{ order_id: "order_1", user_id: stamped ? "user-1" : null }]);
        }
        return json({}, 204);
      }
      if (u.includes("/rest/v1/rpc/issue_invoice")) {
        const stamped = calls.some((c) => c.method === "PATCH" && c.u.includes("invoice_drafts") && JSON.parse(c.opts.body)?.user_id);
        return json({
          invoice: { id: "inv-1", order_id: "order_1", user_id: stamped ? "user-1" : null, plan_id: "pro", billing_period: "monthly", email: null },
          created: true,
        });
      }
      if (u.includes("/rest/v1/entitlements")) return json([]);
      if (u.includes("/rest/v1/scheduled_tasks")) return json({}, 204);
      if (u.includes("/rest/v1/subscriptions")) return json({}, 201);
      if (u.includes("/rest/v1/payment_events")) return json([]);
      throw new Error(`unexpected fetch ${method} ${u}`);
    });
    vi.stubGlobal("fetch", fetchRouter);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
  });

  it("a signed-in verify stamps the draft, activates entitlements and writes the ledger", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    const orderId = "order_1", paymentId = "pay_1";
    rzpPaymentsFetch.mockResolvedValueOnce({ id: paymentId, order_id: orderId, amount: 10000, currency: "INR", status: "captured" });
    rzpOrdersFetch.mockResolvedValueOnce({ id: orderId, amount: 10000, currency: "INR" });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      headers: { Authorization: "Bearer good.jwt" },
      body: JSON.stringify({
        provider: "razorpay", orderId, paymentId, signature: rzpSig(orderId, paymentId, "rzp_secret"),
        planId: "pro", sessionId: "sess_abc", billingPeriod: "monthly",
      }),
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).verified).toBe(true);

    // 1. the draft got the user stamped from the JWT (before finalize)
    const stamp = calls.find((c) => c.method === "PATCH" && c.u.includes("invoice_drafts") && JSON.parse(c.opts.body)?.user_id);
    expect(stamp).toBeTruthy();
    expect(JSON.parse(stamp.opts.body)).toEqual({ user_id: "user-1" });
    // 2. entitlements were activated server-side (POST, not just a GET)
    const entPost = calls.find((c) => c.method === "POST" && c.u.includes("/rest/v1/entitlements"));
    expect(entPost).toBeTruthy();
    expect(JSON.parse(entPost.opts.body).plan_id).toBe("pro");
    // 3. subscriptions + payment event written with the service key (webhook parity)
    const subPost = calls.find((c) => c.method === "POST" && c.u.includes("/rest/v1/subscriptions"));
    expect(subPost).toBeTruthy();
    expect(JSON.parse(subPost.opts.body)).toMatchObject({ session_id: "sess_abc", plan_id: "pro", provider: "razorpay" });
    const evPost = calls.find((c) => c.method === "POST" && c.u.includes("/rest/v1/payment_events"));
    expect(evPost).toBeTruthy();
    expect(JSON.parse(evPost.opts.body)).toMatchObject({ provider_event_id: paymentId, event_type: "payment.captured" });
  });

  it("a guest verify (no valid JWT) writes the ledger but never touches entitlements", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid session" } });
    const orderId = "order_1", paymentId = "pay_1";
    rzpPaymentsFetch.mockResolvedValueOnce({ id: paymentId, order_id: orderId, amount: 10000, currency: "INR", status: "captured" });
    rzpOrdersFetch.mockResolvedValueOnce({ id: orderId, amount: 10000, currency: "INR" });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", orderId, paymentId, signature: rzpSig(orderId, paymentId, "rzp_secret"),
        planId: "pro", sessionId: "sess_abc", billingPeriod: "monthly",
      }),
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).verified).toBe(true);
    // No draft user-stamp (no valid JWT), no entitlements write — activation happens on claim.
    expect(calls.some((c) => c.method === "PATCH" && c.u.includes("invoice_drafts") && JSON.parse(c.opts.body)?.user_id)).toBe(false);
    expect(calls.some((c) => c.method === "POST" && c.u.includes("/rest/v1/entitlements"))).toBe(false);
    // The subscriptions row still lands so the sign-in claim path can merge it.
    expect(calls.some((c) => c.method === "POST" && c.u.includes("/rest/v1/subscriptions"))).toBe(true);
  });
});
