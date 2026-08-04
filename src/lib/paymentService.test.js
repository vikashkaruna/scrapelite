import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAYMENT_STAGE,
  clearPendingPayment,
  confirmStripeSession,
  initiateCheckout,
  loadRazorpay,
  preloadRazorpay,
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
    // Force the demo path: Vite's .env loader pulls in real VITE_RAZORPAY_KEY_ID
    // from the local .env, so hasPayment is true in the test runner. We stub
    // the relevant env vars and reset the module cache so paymentConfig.js
    // re-evaluates with the empty values.
    vi.stubEnv("VITE_RAZORPAY_KEY_ID", "");
    vi.stubEnv("VITE_STRIPE_PUBLISHABLE_KEY", "");
    vi.resetModules();
    const { initiateCheckout: freshInitiate } = await import("./paymentService.js");
    const r = await freshInitiate({ planId: "pro", currency: "USD" });
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

// U-63..U-66 — Razorpay SDK loader (v4: same-origin proxy + CDN fallback).
// The previous loaders all relied on the browser loading
// checkout.razorpay.com directly, which fails in real production environments
// (ad blockers, corporate firewalls, CSP, Netlify edge). v4 routes the SDK
// through /.netlify/functions/razorpay-sdk (same-origin, immutable 24h cache)
// and falls back to the direct CDN if the proxy 404s or 502s. These tests
// verify the contract: pre-load, dedup, fallback chain, fast path.
describe("Razorpay SDK loader (U-63..U-66)", () => {
  beforeEach(() => {
    // Reset the loader's state between tests by clearing any cached tags.
    document.querySelectorAll("script[data-rzp-state]").forEach((n) => n.remove());
    document.querySelectorAll('script[src*="razorpay-sdk"],script[src*="checkout.razorpay.com"]')
      .forEach((n) => n.remove());
    delete window.Razorpay;
  });

  it("preloadRazorpay() does not throw when every source fails (fire-and-forget, error swallowed)", async () => {
    // Stub createElement so every appended <script> immediately errors.
    const origCreate = document.createElement.bind(document);
    const ceSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === "script") {
        queueMicrotask(() => el.dispatchEvent(new Event("error")));
      }
      return el;
    });
    try {
      // preloadRazorpay is fire-and-forget — must not throw, must swallow.
      expect(() => preloadRazorpay()).not.toThrow();
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      ceSpy.mockRestore();
    }
  });

  it("loadRazorpay() does not append a <script> when window.Razorpay is already loaded (fast path)", async () => {
    window.Razorpay = function () {}; // SDK already present
    const appendSpy = vi.spyOn(document.head, "appendChild");
    try {
      // Re-import fresh to clear module-level rzpLoaded state
      vi.resetModules();
      const { loadRazorpay: freshLoad } = await import("./paymentService.js");
      await freshLoad();
      expect(appendSpy).not.toHaveBeenCalled();
    } finally {
      appendSpy.mockRestore();
      delete window.Razorpay;
    }
  });

  it("loadRazorpay() falls back to the CDN when the local proxy source errors", async () => {
    // Capture which scripts get appended in order
    const appended = [];
    const origAppend = document.head.appendChild.bind(document.head);
    const appendSpy = vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      appended.push(node.src || node.tagName);
      return origAppend(node);
    });
    // First script (proxy) errors; second script (CDN) loads successfully and
    // sets window.Razorpay (simulating the real SDK body executing).
    let callCount = 0;
    const origCreate = document.createElement.bind(document);
    const ceSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === "script") {
        const idx = callCount++;
        queueMicrotask(() => {
          if (idx === 0) {
            el.dispatchEvent(new Event("error"));
          } else {
            window.Razorpay = function () {};
            el.dispatchEvent(new Event("load"));
          }
        });
      }
      return el;
    });
    try {
      // Reset module state so the loader tries fresh
      vi.resetModules();
      const { loadRazorpay: freshLoad } = await import("./paymentService.js");
      await freshLoad();
      // Proxy tried first, then CDN
      expect(appended[0]).toMatch(/razorpay-sdk/);
      expect(appended[1]).toMatch(/checkout\.razorpay\.com/);
      expect(window.Razorpay).toBeDefined();
    } finally {
      appendSpy.mockRestore();
      ceSpy.mockRestore();
      delete window.Razorpay;
    }
  });
});
