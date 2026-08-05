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

// U-63..U-66 — Razorpay SDK loader (v5: direct CDN, no proxy).
// v4 routed the SDK through /.netlify/functions/razorpay-sdk to bypass ad
// blockers and CSP, but Razorpay's SDK does its own integrity check via
// document.currentScript.src and refuses to initialise when the script is
// served from any non-Razorpay origin (the SDK throws "Invalid script
// source" and blocks payment). v5 reverts to loading the official Razorpay
// CDN directly; the new CSP (script-src includes https://checkout.razorpay.com)
// keeps the browser happy. The error path is now a single source — CDN fails
// almost always means an ad blocker / content blocker, so the error message
// is rewritten to name that explicitly.
describe("Razorpay SDK loader (U-63..U-66)", () => {
  beforeEach(() => {
    // Reset the loader's state between tests by clearing any cached tags.
    document.querySelectorAll("script[data-rzp-state]").forEach((n) => n.remove());
    document.querySelectorAll('script[src*="razorpay-sdk"],script[src*="checkout.razorpay.com"]')
      .forEach((n) => n.remove());
    delete window.Razorpay;
  });

  it("preloadRazorpay() does not throw when the CDN source fails (fire-and-forget, error swallowed)", async () => {
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

  it("loadRazorpay() loads from the official Razorpay CDN and exposes window.Razorpay", async () => {
    // Capture which scripts get appended in order
    const appended = [];
    const origAppend = document.head.appendChild.bind(document.head);
    const appendSpy = vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      appended.push(node.src || node.tagName);
      return origAppend(node);
    });
    // Single-source load: the appended <script> loads successfully and sets
    // window.Razorpay (simulating the real SDK body executing).
    const origCreate = document.createElement.bind(document);
    const ceSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === "script") {
        queueMicrotask(() => {
          window.Razorpay = function () {};
          el.dispatchEvent(new Event("load"));
        });
      }
      return el;
    });
    try {
      // Reset module state so the loader tries fresh
      vi.resetModules();
      const { loadRazorpay: freshLoad } = await import("./paymentService.js");
      await freshLoad();
      // Only the CDN source is tried (no proxy fallback in v5 — the proxy
      // breaks Razorpay's integrity check, see comment block above)
      expect(appended).toHaveLength(1);
      expect(appended[0]).toMatch(/checkout\.razorpay\.com\/v1\/checkout\.js/);
      expect(window.Razorpay).toBeDefined();
    } finally {
      appendSpy.mockRestore();
      ceSpy.mockRestore();
      delete window.Razorpay;
    }
  });

  it("loadRazorpay() surfaces a clear error when the CDN source fails (ad blocker / firewall / CSP)", async () => {
    // Every appended <script> immediately errors (simulates an ad blocker or
    // a strict CSP blocking the Razorpay CDN).
    const origCreate = document.createElement.bind(document);
    const ceSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === "script") {
        queueMicrotask(() => el.dispatchEvent(new Event("error")));
      }
      return el;
    });
    try {
      vi.resetModules();
      const { loadRazorpay: freshLoad } = await import("./paymentService.js");
      await expect(freshLoad()).rejects.toThrow(/checkout\.razorpay\.com/);
    } finally {
      ceSpy.mockRestore();
    }
  });
});
