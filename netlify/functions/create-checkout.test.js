// netlify/functions/create-checkout.test.js
// C-12..16 — Plan/currency/billingPeriod resolution; server-authoritative amount
// (client amount ignored); INR adds 18% GST; max(coupon,global) discount;
// distinct error codes for unknown plan, missing gateway keys, etc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocked Stripe + Razorpay SDKs (dynamic-imported inside the handler) ─────────
// Use vi.hoisted() to define the mock class + shared mock fns so the vi.mock
// factory can reference them. The class uses `this.orders = ...` so that
// `new Razorpay()` actually assigns to the constructed instance (returning an
// object literal from a constructor in some mock-fn implementations is unreliable
// across Vitest versions).
const { stripeSessionsCreate, rzpOrdersCreate, RazorpayMock, StripeMock } = vi.hoisted(() => {
  const stripeSessionsCreate = vi.fn();
  const rzpOrdersCreate = vi.fn();
  class RazorpayMock {
    constructor() {
      this.orders = { create: rzpOrdersCreate };
    }
  }
  class StripeMock {
    constructor() {
      this.checkout = { sessions: { create: stripeSessionsCreate } };
      this.coupons = { create: vi.fn().mockResolvedValue({ id: "coupon_test" }) };
    }
  }
  return { stripeSessionsCreate, rzpOrdersCreate, RazorpayMock, StripeMock };
});

vi.mock("stripe", () => ({ default: StripeMock }));
vi.mock("razorpay", () => ({ default: RazorpayMock }));

let fetchMock;
let handler;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  vi.resetModules();
  stripeSessionsCreate.mockReset();
  rzpOrdersCreate.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("./create-checkout.js");
  return mod.handler;
}

// ── Helper: return empty pricing_config from Supabase so static tables are used ─
function mockEmptySupabase() {
  fetchMock.mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes("/rest/v1/pricing_config")) {
      return new Response("[]", { status: 200 });
    }
    if (u.includes("/rest/v1/rpc/redeem_coupon")) {
      return new Response(JSON.stringify("ok"), { status: 200 });
    }
    return new Response("not-found", { status: 404 });
  });
}

// Static table (mirror of src/lib/pricingConfig.js):
//   pro:      { usd: 29,  usd_annual: 23,  inr: 2899, inr_annual: 1499 }
//   select:   { usd: 19,  usd_annual: 15,  inr: 1899, inr_annual: 999 }
//   agency:   { usd: 299, usd_annual: 239, inr: 29899, inr_annual: 14999 }
//   business: { usd: 79,  usd_annual: 63,  inr: 7899, inr_annual: 3999 }
// Monthly INR uses p.inr; annual uses p.inr_annual × 12.
// GST_RATE = 0.18.

// ── C-12: plan + currency + billingPeriod resolution ───────────────────────────
describe("create-checkout Razorpay (C-12) — plan/currency/billingPeriod", () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
  });

  it("INR monthly Pro plan → 2899 × 1.18 × 100 = 342,082 paise", async () => {
    mockEmptySupabase();
    rzpOrdersCreate.mockResolvedValueOnce({
      id: "order_1", amount: 342082, currency: "INR", receipt: "r_1",
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", planId: "pro", currency: "INR",
        billingPeriod: "monthly", sessionId: "sess_abc",
      }),
    });
    expect(r.statusCode).toBe(200);
    expect(rzpOrdersCreate).toHaveBeenCalledTimes(1);
    const order = rzpOrdersCreate.mock.calls[0][0];
    expect(order.currency).toBe("INR");
    expect(order.amount).toBe(Math.round(2899 * 1.18 * 100));
  });

  it("INR annual Select plan → 999 × 12 × 1.18 × 100 = 1,415,064 paise", async () => {
    mockEmptySupabase();
    rzpOrdersCreate.mockResolvedValueOnce({
      id: "order_2", amount: 1415064, currency: "INR", receipt: "r_2",
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", planId: "select", currency: "INR",
        billingPeriod: "annual", sessionId: "sess_abc",
      }),
    });
    expect(r.statusCode).toBe(200);
    const order = rzpOrdersCreate.mock.calls[0][0];
    expect(order.amount).toBe(Math.round(999 * 12 * 1.18 * 100));
  });

  it("INR annual Agency plan → 14999 × 12 × 1.18 × 100 = 21,241,764 paise", async () => {
    mockEmptySupabase();
    rzpOrdersCreate.mockResolvedValueOnce({
      id: "order_3", amount: 21241764, currency: "INR", receipt: "r_3",
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", planId: "agency", currency: "INR",
        billingPeriod: "annual", sessionId: "sess_abc",
      }),
    });
    expect(r.statusCode).toBe(200);
    const order = rzpOrdersCreate.mock.calls[0][0];
    expect(order.amount).toBe(Math.round(14999 * 12 * 1.18 * 100));
  });
});

// ── C-13: client `amount` and client `discountPercent` are IGNORED ─────────────
describe("create-checkout (C-13) — server ignores client amount/discount", () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
  });

  it("client tries to override amount → server uses price table amount", async () => {
    mockEmptySupabase();
    rzpOrdersCreate.mockResolvedValueOnce({
      id: "order_4", amount: 0, currency: "INR", receipt: "r_4",
    });
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", planId: "pro", currency: "INR",
        billingPeriod: "monthly", sessionId: "sess_abc",
        amount: 100, // client tries ₹1 — IGNORED
        discountPercent: 99, // client tries 99% off — IGNORED
      }),
    });
    expect(r.statusCode).toBe(200);
    const order = rzpOrdersCreate.mock.calls[0][0];
    // Server-computed amount (2899 × 1.18 × 100) wins
    expect(order.amount).toBe(Math.round(2899 * 1.18 * 100));
  });
});

// ── C-14: INR adds 18% GST; USD does not ──────────────────────────────────────
describe("create-checkout (C-14) — GST 18% on INR only", () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
  });

  it("INR amount = base × 1.18", async () => {
    mockEmptySupabase();
    rzpOrdersCreate.mockResolvedValueOnce({ id: "o", amount: 0, currency: "INR", receipt: "r" });
    const h = await loadHandler();
    await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", planId: "pro", currency: "INR",
        billingPeriod: "monthly", sessionId: "sess_abc",
      }),
    });
    const base = 2899;
    const expected = Math.round(base * 1.18 * 100);
    const order = rzpOrdersCreate.mock.calls[0][0];
    expect(order.amount).toBe(expected);
    // Sanity: amount > base*100 (i.e. 18% uplift is real)
    expect(order.amount).toBeGreaterThan(base * 100);
  });

  it("USD amount = base × 100 (no GST)", async () => {
    mockEmptySupabase();
    rzpOrdersCreate.mockResolvedValueOnce({ id: "o", amount: 0, currency: "USD", receipt: "r" });
    const h = await loadHandler();
    await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", planId: "pro", currency: "USD",
        billingPeriod: "monthly", sessionId: "sess_abc",
      }),
    });
    const order = rzpOrdersCreate.mock.calls[0][0];
    // 29 USD × 100 cents, no GST
    expect(order.amount).toBe(29 * 100);
  });
});

// ── C-15: max(coupon, global) discount; cap_reached / already_redeemed drop coupon ─
describe("create-checkout (C-15) — discount precedence", () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
  });

  it("LAUNCH20 (20% coupon, no global) → amount = base × 0.80 × 1.18", async () => {
    mockEmptySupabase();
    rzpOrdersCreate.mockResolvedValueOnce({ id: "o", amount: 0, currency: "INR", receipt: "r" });
    const h = await loadHandler();
    await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", planId: "pro", currency: "INR",
        billingPeriod: "monthly", sessionId: "sess_abc",
        couponCode: "LAUNCH20",
      }),
    });
    const order = rzpOrdersCreate.mock.calls[0][0];
    const base = 2899;
    const expected = Math.round(base * 0.80 * 1.18 * 100);
    expect(order.amount).toBe(expected);
  });

  it("already_redeemed → coupon dropped, full price charged", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/rest/v1/pricing_config")) return new Response("[]", { status: 200 });
      if (u.includes("/rest/v1/rpc/redeem_coupon")) return new Response(JSON.stringify("already_redeemed"), { status: 200 });
      return new Response("nf", { status: 404 });
    });
    rzpOrdersCreate.mockResolvedValueOnce({ id: "o", amount: 0, currency: "INR", receipt: "r" });
    const h = await loadHandler();
    await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", planId: "pro", currency: "INR",
        billingPeriod: "monthly", sessionId: "sess_abc",
        couponCode: "LAUNCH20",
      }),
    });
    const order = rzpOrdersCreate.mock.calls[0][0];
    expect(order.amount).toBe(Math.round(2899 * 1.18 * 100));
  });

  it("cap_reached → coupon dropped, full price charged", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/rest/v1/pricing_config")) return new Response("[]", { status: 200 });
      if (u.includes("/rest/v1/rpc/redeem_coupon")) return new Response(JSON.stringify("cap_reached"), { status: 200 });
      return new Response("nf", { status: 404 });
    });
    rzpOrdersCreate.mockResolvedValueOnce({ id: "o", amount: 0, currency: "INR", receipt: "r" });
    const h = await loadHandler();
    await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", planId: "pro", currency: "INR",
        billingPeriod: "monthly", sessionId: "sess_abc",
        couponCode: "LAUNCH20",
      }),
    });
    const order = rzpOrdersCreate.mock.calls[0][0];
    expect(order.amount).toBe(Math.round(2899 * 1.18 * 100));
  });

  it("expired coupon → 0 discount", async () => {
    mockEmptySupabase();
    rzpOrdersCreate.mockResolvedValueOnce({ id: "o", amount: 0, currency: "INR", receipt: "r" });
    const h = await loadHandler();
    await h({
      httpMethod: "POST",
      body: JSON.stringify({
        provider: "razorpay", planId: "pro", currency: "INR",
        billingPeriod: "monthly", sessionId: "sess_abc",
        couponCode: "EARLYBIRD", // expired in static table
      }),
    });
    const order = rzpOrdersCreate.mock.calls[0][0];
    expect(order.amount).toBe(Math.round(2899 * 1.18 * 100));
  });
});

// ── C-16: error codes ─────────────────────────────────────────────────────────
describe("create-checkout (C-16) — error codes", () => {
  it("missing provider → 400 INVALID_PROVIDER", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({ planId: "pro", currency: "INR", sessionId: "s" }) });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("INVALID_PROVIDER");
  });

  it("unknown provider → 400 INVALID_PROVIDER", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({ provider: "paypal", planId: "pro", currency: "INR", sessionId: "s" }) });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("INVALID_PROVIDER");
  });

  it("missing planId → 400 MISSING_PLAN_ID", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({ provider: "razorpay", currency: "INR", sessionId: "s" }) });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("MISSING_PLAN_ID");
  });

  it("unknown planId → 400 UNKNOWN_PLAN", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({ provider: "razorpay", planId: "diamond", currency: "INR", sessionId: "s" }) });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("UNKNOWN_PLAN");
  });

  it("razorpay with no key env vars → 501 RAZORPAY_NOT_CONFIGURED", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({ provider: "razorpay", planId: "pro", currency: "INR", sessionId: "s" }) });
    expect(r.statusCode).toBe(501);
    expect(JSON.parse(r.body).code).toBe("RAZORPAY_NOT_CONFIGURED");
  });

  it("stripe with no STRIPE_SECRET_KEY → 501 STRIPE_NOT_CONFIGURED", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({ provider: "stripe", planId: "pro", currency: "USD", priceId: "price_1", successUrl: "https://x/s", cancelUrl: "https://x/c", sessionId: "s" }) });
    expect(r.statusCode).toBe(501);
    expect(JSON.parse(r.body).code).toBe("STRIPE_NOT_CONFIGURED");
  });

  it("stripe with no priceId → 400 MISSING_PRICE_ID", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({ provider: "stripe", planId: "pro", currency: "USD", successUrl: "https://x/s", cancelUrl: "https://x/c", sessionId: "s" }) });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("MISSING_PRICE_ID");
  });

  it("invalid currency → 400 INVALID_CURRENCY", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({ provider: "razorpay", planId: "pro", currency: "EUR", sessionId: "s" }) });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("INVALID_CURRENCY");
  });

  it("invalid JSON body → 400 INVALID_JSON", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: "not json" });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("INVALID_JSON");
  });

  it("method not allowed → 405 METHOD_NOT_ALLOWED", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    expect(r.statusCode).toBe(405);
    expect(JSON.parse(r.body).code).toBe("METHOD_NOT_ALLOWED");
  });

  it("amount below minimum (free plan) → 400 AMOUNT_TOO_SMALL", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    mockEmptySupabase();
    // Free plan = 0 INR — falls below ₹1 (100 paise) minimum
    rzpOrdersCreate.mockResolvedValueOnce({ id: "o", amount: 0, currency: "INR", receipt: "r" });
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({ provider: "razorpay", planId: "free", currency: "INR", billingPeriod: "monthly", sessionId: "s" }) });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("AMOUNT_TOO_SMALL");
  });
});
