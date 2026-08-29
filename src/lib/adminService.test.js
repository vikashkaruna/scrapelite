import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminLogin,
  adminLogout,
  isAdminAuthed,
  validateCoupon,
  buildCouponsSyncPayload,
} from "./adminService.js";

/**
 * U-63..65 — adminService is the client-side admin auth + coupon
 * validator. The spec's invariants:
 *   - Legacy boolean admin tokens ("true", "1") are rejected.
 *   - Expired tokens trigger adminLogout.
 *   - Coupons with planId="manual" return a specific error
 *     (FR-Z-04 / R18).
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isAdminAuthed (U-63)", () => {
  it("rejects a legacy boolean token 'true'", () => {
    localStorage.setItem("scrapelite.adminAuth", "true");
    localStorage.setItem("scrapelite.adminAuthExp", String(Date.now() + 1_000_000));
    expect(isAdminAuthed()).toBe(false);
  });

  it("rejects a legacy boolean token '1'", () => {
    localStorage.setItem("scrapelite.adminAuth", "1");
    localStorage.setItem("scrapelite.adminAuthExp", String(Date.now() + 1_000_000));
    expect(isAdminAuthed()).toBe(false);
  });

  it("accepts a valid token + future expiry", () => {
    localStorage.setItem("scrapelite.adminAuth", "valid.token");
    localStorage.setItem("scrapelite.adminAuthExp", String(Date.now() + 1_000_000));
    expect(isAdminAuthed()).toBe(true);
  });
});

describe("isAdminAuthed — expired token (U-64)", () => {
  it("expired token triggers adminLogout and returns false", () => {
    localStorage.setItem("scrapelite.adminAuth", "valid.token");
    localStorage.setItem("scrapelite.adminAuthExp", String(Date.now() - 1));
    expect(isAdminAuthed()).toBe(false);
    // After adminLogout, the token is cleared
    expect(localStorage.getItem("scrapelite.adminAuth")).toBeNull();
  });
});

describe("validateCoupon (U-65)", () => {
  beforeEach(() => {
    // Seed a known coupon set
    const coupons = [
      { code: "LAUNCH20", active: true, value: 20, planId: null },
      { code: "PROONLY",  active: true, value: 10, planId: "pro" },
      { code: "MANUAL1",  active: true, value: 50, planId: "manual" },
      { code: "EXPIRED",  active: true, value: 10, planId: null, expiresAt: "2020-01-01T00:00:00.000Z" },
    ];
    localStorage.setItem("datiq.coupons", JSON.stringify(coupons));
  });

  it("returns the specific reason for planId='manual' (FR-Z-04)", () => {
    const r = validateCoupon("MANUAL1", "free");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/admin assignment only/);
  });

  it("rejects an unknown code", () => {
    const r = validateCoupon("NOPE", "free");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/not found/);
  });

  it("rejects an expired coupon", () => {
    const r = validateCoupon("EXPIRED", "free");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/expired/);
  });

  it("rejects a plan-restricted coupon used on the wrong plan", () => {
    const r = validateCoupon("PROONLY", "select");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/Pro plan/);
  });

  it("accepts a valid coupon on the matching plan", () => {
    const r = validateCoupon("PROONLY", "pro");
    expect(r.valid).toBe(true);
  });
});

describe("adminLogin — dev fallback", () => {
  it("server unreachable + demo PIN → ok + demo:true", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Network unreachable");
    });
    const r = await adminLogin("ADMIN123");
    expect(r.ok).toBe(true);
    expect(r.demo).toBe(true);
  });

  it("server unreachable + wrong PIN → ok:false", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Network unreachable");
    });
    const r = await adminLogin("nope");
    expect(r.ok).toBe(false);
  });
});

describe("adminLogout", () => {
  it("clears the admin token and expiry", () => {
    localStorage.setItem("scrapelite.adminAuth", "valid.token");
    localStorage.setItem("scrapelite.adminAuthExp", String(Date.now() + 1_000_000));
    adminLogout();
    expect(isAdminAuthed()).toBe(false);
  });
});

describe("buildCouponsSyncPayload — the checkout-facing subset of local coupons", () => {
  it("keeps only percent-type coupons, keyed by uppercase code", () => {
    const out = buildCouponsSyncPayload([
      { code: "save20", type: "percent", value: 20, planId: null, expiresAt: null, active: true, maxUses: 0 },
    ]);
    expect(out).toEqual({
      SAVE20: { value: 20, planId: null, expiresAt: null, active: true, maxUses: 0 },
    });
  });

  it("drops extraction-bonus coupons — they never touch checkout", () => {
    const out = buildCouponsSyncPayload([
      { code: "BONUS50", type: "extractions", value: 50, active: true },
    ]);
    expect(out).toEqual({});
  });

  it("drops planId:'manual' coupons — admin-assign only, not checkout-redeemable", () => {
    const out = buildCouponsSyncPayload([
      { code: "ASSIGNED", type: "percent", value: 30, planId: "manual", active: true },
    ]);
    expect(out).toEqual({});
  });

  it("an empty local list produces an empty payload (clears the server side too)", () => {
    expect(buildCouponsSyncPayload([])).toEqual({});
  });
});
