// netlify/functions/payment-webhook.test.js
// C-20..22 — Idempotent on provider_event_id (insertPaymentEvent skips dupes);
// DB write failure still returns 200 (no gateway retry). payment.failed never
// activates a plan. Stripe signature bypass (no signature header / bad signature
// when secret is set) returns 400 — never 200.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

let fetchMock;
let handler;

// ── Mocked Stripe SDK (constructEvent + standard methods) ─────────────────────
const { stripeConstructEvent } = vi.hoisted(() => ({ stripeConstructEvent: vi.fn() }));
class StripeMock {
  constructor() {
    this.webhooks = { constructEvent: stripeConstructEvent };
  }
}
vi.mock("stripe", () => ({ default: StripeMock }));

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  vi.resetModules();
  stripeConstructEvent.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("./payment-webhook.js");
  return mod.handler;
}

// ── Helper: Supabase mock returning the requested shape ───────────────────────
function makeDb(opts = {}) {
  // Track calls so we can assert idempotency / activation behavior.
  const calls = { upsertSub: [], patchSub: [], insertEvents: [], checkEvent: [] };
  fetchMock.mockImplementation(async (url, init = {}) => {
    const u = String(url);
    const m = (init.method || "GET").toUpperCase();
    if (u.includes("/rest/v1/payment_events") && m === "GET") {
      const sid = decodeURIComponent(u.split("provider_event_id=eq.")[1]?.split("&")[0] || "");
      calls.checkEvent.push(sid);
      if (opts.seenEventIds && opts.seenEventIds.has(sid)) {
        return new Response(JSON.stringify([{ id: "evt_dup" }]), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    }
    if (u.includes("/rest/v1/payment_events") && m === "POST") {
      const body = JSON.parse(init.body);
      calls.insertEvents.push(body);
      return new Response("{}", { status: 201 });
    }
    if (u.includes("/rest/v1/subscriptions") && m === "POST") {
      const body = JSON.parse(init.body);
      calls.upsertSub.push(body);
      if (opts.upsertThrows) throw new Error("upsert failure");
      return new Response("{}", { status: 201 });
    }
    if (u.includes("/rest/v1/subscriptions?session_id=eq.") && m === "PATCH") {
      const body = JSON.parse(init.body);
      calls.patchSub.push(body);
      if (opts.patchThrows) throw new Error("patch failure");
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  return calls;
}

// ── C-20: idempotent on provider_event_id; DB error → 200 ─────────────────────
describe("payment-webhook (C-20) — idempotency + non-fatal DB errors", () => {
  it("duplicate event id (seenEventIds contains it) → insertPaymentEvent SKIPS the POST", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.RAZORPAY_WEBHOOK_SECRET = "rzp_whsec";
    const calls = makeDb({ seenEventIds: new Set(["pay_evt_1"]) });
    const payload = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: {
        id: "pay_evt_1", amount: 1000, currency: "INR",
        order_id: "order_1", contact: "user@x.com",
        notes: { planId: "pro", sessionId: "sess_abc" },
      } } },
    });
    const sig = createHmac("sha256", "rzp_whsec").update(payload).digest("hex");
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST", body: payload, queryStringParameters: { provider: "razorpay" },
      headers: { "x-razorpay-signature": sig },
    });
    expect(r.statusCode).toBe(200);
    // No insert attempted (idempotency check returns existing row)
    expect(calls.insertEvents).toHaveLength(0);
  });

  it("new event id → insertPaymentEvent IS called", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.RAZORPAY_WEBHOOK_SECRET = "rzp_whsec";
    const calls = makeDb();
    const payload = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: {
        id: "pay_evt_NEW", amount: 2000, currency: "INR",
        notes: { planId: "pro", sessionId: "sess_abc" },
      } } },
    });
    const sig = createHmac("sha256", "rzp_whsec").update(payload).digest("hex");
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST", body: payload, queryStringParameters: { provider: "razorpay" },
      headers: { "x-razorpay-signature": sig },
    });
    expect(r.statusCode).toBe(200);
    expect(calls.insertEvents).toHaveLength(1);
    expect(calls.insertEvents[0].provider_event_id).toBe("pay_evt_NEW");
  });

  it("DB write failure → 200 (no gateway retry)", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.RAZORPAY_WEBHOOK_SECRET = "rzp_whsec";
    makeDb({ upsertThrows: true });
    const payload = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: {
        id: "pay_evt_err", amount: 100, currency: "INR",
        notes: { planId: "pro", sessionId: "sess_err" },
      } } },
    });
    const sig = createHmac("sha256", "rzp_whsec").update(payload).digest("hex");
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST", body: payload, queryStringParameters: { provider: "razorpay" },
      headers: { "x-razorpay-signature": sig },
    });
    expect(r.statusCode).toBe(200);
  });
});

// ── C-21: payment.failed does NOT activate plan ──────────────────────────────
describe("payment-webhook (C-21) — payment.failed", () => {
  it("payment.failed → NO subscription upsert, only event log", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.RAZORPAY_WEBHOOK_SECRET = "rzp_whsec";
    const calls = makeDb();
    const payload = JSON.stringify({
      event: "payment.failed",
      payload: { payment: { entity: {
        id: "pay_failed_1", amount: 5000, currency: "INR",
        error_description: "card_declined",
        notes: { planId: "pro", sessionId: "sess_failed" },
      } } },
    });
    const sig = createHmac("sha256", "rzp_whsec").update(payload).digest("hex");
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST", body: payload, queryStringParameters: { provider: "razorpay" },
      headers: { "x-razorpay-signature": sig },
    });
    expect(r.statusCode).toBe(200);
    // Event logged
    expect(calls.insertEvents).toHaveLength(1);
    expect(calls.insertEvents[0].event_type).toBe("payment.failed");
    expect(calls.insertEvents[0].status).toBe("failed");
    // NO subscription upsert
    expect(calls.upsertSub).toHaveLength(0);
  });
});

// ── C-22: Stripe webhook signature bypass rejected ───────────────────────────
describe("payment-webhook Stripe (C-22) — signature bypass rejected", () => {
  it("STRIPE_WEBHOOK_SECRET set + no signature header → 400 (constructEvent throws)", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    stripeConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload.");
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ id: "evt_1", type: "checkout.session.completed" }),
      headers: {}, // no stripe-signature
    });
    expect(r.statusCode).toBe(400);
  });

  it("STRIPE_WEBHOOK_SECRET set + bad signature → 400", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    stripeConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload.");
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ id: "evt_2", type: "checkout.session.completed" }),
      headers: { "stripe-signature": "t=1,v1=badbadbad" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("valid signature + checkout.session.completed → 200 + subscription upsert", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    stripeConstructEvent.mockReturnValueOnce({
      id: "evt_3",
      type: "checkout.session.completed",
      data: { object: {
        metadata: { planId: "pro", sessionId: "sess_abc", billingPeriod: "monthly" },
        amount_total: 2900, currency: "usd",
        subscription: "sub_1", customer: "cus_1",
      } },
    });
    const calls = makeDb();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({}),
      headers: { "stripe-signature": "t=1,v1=good" },
    });
    expect(r.statusCode).toBe(200);
    expect(calls.upsertSub).toHaveLength(1);
    expect(calls.upsertSub[0].plan_id).toBe("pro");
    expect(calls.upsertSub[0].status).toBe("active");
    expect(calls.insertEvents).toHaveLength(1);
  });

  it("STRIPE_WEBHOOK_SECRET not set → signature check skipped (warns), still 200", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.STRIPE_SECRET_KEY = "sk_test";
    // intentionally NO STRIPE_WEBHOOK_SECRET
    const calls = makeDb();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        id: "evt_4",
        type: "checkout.session.completed",
        data: { object: {
          metadata: { planId: "select", sessionId: "sess_x" },
          amount_total: 1900, currency: "usd",
        } },
      }),
      headers: {},
    });
    expect(r.statusCode).toBe(200);
    // Stripe was NOT used for signature check (constructEvent never called)
    expect(stripeConstructEvent).not.toHaveBeenCalled();
    // But subscription was still upserted (we parsed the body as JSON)
    expect(calls.upsertSub).toHaveLength(1);
    expect(calls.upsertSub[0].plan_id).toBe("select");
  });
});

// ── Razorpay signature check ──────────────────────────────────────────────────
describe("payment-webhook Razorpay — signature", () => {
  it("RAZORPAY_WEBHOOK_SECRET set + bad signature → 400", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "rzp_whsec";
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ event: "payment.captured" }),
      queryStringParameters: { provider: "razorpay" },
      headers: { "x-razorpay-signature": "deadbeef".repeat(8) },
    });
    expect(r.statusCode).toBe(400);
  });

  it("RAZORPAY_WEBHOOK_SECRET not set → signature check skipped, still 200", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    const calls = makeDb();
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ event: "unhandled.event" }),
      queryStringParameters: { provider: "razorpay" },
      headers: {},
    });
    expect(r.statusCode).toBe(200);
  });
});

// ── method / provider handling ────────────────────────────────────────────────
describe("payment-webhook — method / provider", () => {
  it("non-POST method → 405", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    expect(r.statusCode).toBe(405);
  });

  it("unknown provider → 400", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST", body: "{}",
      queryStringParameters: { provider: "paypal" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("Stripe path with no STRIPE_SECRET_KEY → 501", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: "{}", queryStringParameters: { provider: "stripe" } });
    expect(r.statusCode).toBe(501);
  });
});
