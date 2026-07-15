import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAYMENT_STAGE,
  clearPendingPayment,
  confirmStripeSession,
  initiateCheckout,
  readPendingPayment,
  savePendingPayment,
} from "./paymentService.js";

/**
 * U-59..62 — paymentService is the orchestration layer for Stripe and
 * Razorpay. Tests cover the demo-mode path (no keys) and the
 * pending-payment TTL. The full Razorpay flow is exercised in M2/M5
 * with a live function.
 */

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("initiateCheckout — demo mode (U-59)", () => {
  it("returns {status:'demo_mode'} when no payment keys are configured", async () => {
    // config.js returns hasPayment=false when VITE_* keys are empty.
    // The env defaults in the test runner are empty, so this should fire.
    const r = await initiateCheckout({ planId: "pro", currency: "USD" });
    expect(r.status).toBe("demo_mode");
  });
});

describe("readPendingPayment / savePendingPayment / clearPendingPayment (U-61)", () => {
  it("round-trips a payment record", () => {
    savePendingPayment({ planId: "pro", provider: "stripe" });
    const r = readPendingPayment();
    expect(r.planId).toBe("pro");
    expect(r.provider).toBe("stripe");
    expect(typeof r.savedAt).toBe("number");
  });

  it("returns null after the 30-min TTL", () => {
    const longAgo = Date.now() - (31 * 60 * 1000);
    localStorage.setItem(
      "datiq.pendingPayment",
      JSON.stringify({ planId: "pro", provider: "stripe", savedAt: longAgo }),
    );
    expect(readPendingPayment()).toBeNull();
  });

  it("clearPendingPayment removes the record", () => {
    savePendingPayment({ planId: "pro" });
    expect(readPendingPayment()).toBeTruthy();
    clearPendingPayment();
    expect(readPendingPayment()).toBeNull();
  });
});

describe("confirmStripeSession (U-62)", () => {
  it("returns null on non-OK responses", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("not found", { status: 404 }),
    );
    const r = await confirmStripeSession("cs_test_123");
    expect(r).toBeNull();
  });

  it("returns the parsed JSON on 200", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ verified: true }), { status: 200 }),
    );
    const r = await confirmStripeSession("cs_test_123");
    expect(r.verified).toBe(true);
  });
});

describe("PAYMENT_STAGE constants (U-60)", () => {
  it("exports the canonical stage names used by BillingProvider + the modal", () => {
    expect(PAYMENT_STAGE.PREPARING).toBe("preparing");
    expect(PAYMENT_STAGE.PORTAL_OPEN).toBe("portal_open");
    expect(PAYMENT_STAGE.VERIFYING).toBe("verifying");
    expect(PAYMENT_STAGE.ACTIVATING).toBe("activating");
    expect(PAYMENT_STAGE.CANCELLED).toBe("cancelled");
    expect(PAYMENT_STAGE.ERROR).toBe("error");
  });
});
