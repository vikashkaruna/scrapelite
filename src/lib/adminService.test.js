import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminLogin,
  adminLogout,
  isAdminAuthed,
  validateCoupon,
  buildCouponsSyncPayload,
  buildCouponCatalogPayload,
  mergeServerCoupons,
  getCoupons,
  isAdminApiRequest,
  installAdminSessionGuard,
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

  it("syncs bonus coupons as credit coupons — POST /api/credits reads `credits` off this map, so omitting them made every bonus code 'invalid'", () => {
    const out = buildCouponsSyncPayload([
      { code: "BONUS50", type: "extractions", value: 50, active: true },
    ]);
    expect(out).toEqual({
      BONUS50: { value: 0, credits: 50, planId: null, expiresAt: null, active: true, maxUses: 0 },
    });
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

describe("Admin Grants (testing mode & local persistence)", () => {
  it("saves, retrieves by userId and email, and redeems a local admin grant", async () => {
    const { saveAdminGrant, getAdminGrantForUser, redeemLocalAdminGrant } = await import("./adminService.js");

    const grant = saveAdminGrant({
      userId: "u123",
      userEmail: "test@example.com",
      couponCode: "TEST-PRO-1M",
      planId: "pro",
      validityMonths: 1,
      reason: "tester goodwill",
    });

    expect(grant.code).toBe("TEST-PRO-1M");
    expect(grant.status).toBe("assigned");

    const byId = getAdminGrantForUser("u123", null);
    expect(byId).toBeTruthy();
    expect(byId.code).toBe("TEST-PRO-1M");

    const byEmail = getAdminGrantForUser(null, "TEST@example.com");
    expect(byEmail).toBeTruthy();
    expect(byEmail.code).toBe("TEST-PRO-1M");

    const redeemRes = redeemLocalAdminGrant("u123", "TEST-PRO-1M");
    expect(redeemRes.ok).toBe(true);
    expect(redeemRes.plan_id).toBe("pro");
    expect(redeemRes.period_start).toBeTruthy();
    expect(redeemRes.period_end).toBeTruthy();

    const afterRedeem = getAdminGrantForUser("u123", null);
    expect(afterRedeem.status).toBe("redeemed");
    expect(afterRedeem.redeemedAt).toBeTruthy();

    // Idempotent / already redeemed check
    const replayRes = redeemLocalAdminGrant("u123", "TEST-PRO-1M");
    expect(replayRes.ok).toBe(true);
    expect(replayRes.plan_id).toBe("pro");
    expect(replayRes.alreadyRedeemed).toBe(true);
  });
});


describe("coupon catalog — durable, server-side copy of the admin's list", () => {
  it("buildCouponCatalogPayload keeps EVERY type, manual-assign included", () => {
    const out = buildCouponCatalogPayload([
      { id: "a", code: "p", type: "percent", value: 10 },
      { id: "b", code: "b", type: "extractions", value: 25 },
      { id: "c", code: "m", type: "percent", value: 15, planId: "manual" },
    ]);
    expect(out.map((c) => c.code)).toEqual(["P", "B", "M"]);
    expect(out[2].planId).toBe("manual");
  });

  it("mergeServerCoupons: server wins on fields, uses is the highest seen, local-only coupons are kept and reported", () => {
    localStorage.setItem("datiq.coupons", JSON.stringify([
      { id: "c1", code: "SAVE", type: "percent", value: 10, uses: 2, active: true },
      { id: "c9", code: "LEGACY", type: "percent", value: 5, uses: 0, active: true },
    ]));
    const { merged, localOnly } = mergeServerCoupons({
      catalog: [
        { id: "s1", code: "SAVE", type: "percent", value: 25, uses: 1, active: false },
        { id: "s2", code: "BONUS", type: "extractions", value: 50, uses: 0, active: true },
        { id: "s3", code: "MANUALX", type: "percent", value: 15, planId: "manual", active: true },
      ],
      uses: { SAVE: 7 },
    });
    const by = Object.fromEntries(merged.map((c) => [c.code, c]));
    expect(by.SAVE.value).toBe(25);          // server wins
    expect(by.SAVE.active).toBe(false);
    expect(by.SAVE.uses).toBe(7);            // real counter beats local 2 and catalog 1
    expect(by.SAVE.id).toBe("c1");           // local id preserved
    expect(by.BONUS.type).toBe("extractions");
    expect(by.MANUALX.planId).toBe("manual"); // manual coupons arrive too
    expect(by.LEGACY).toBeTruthy();           // never dropped
    expect(localOnly).toEqual(["LEGACY"]);    // …and flagged for upload
    expect(getCoupons().map((c) => c.code).sort()).toEqual(["BONUS", "LEGACY", "MANUALX", "SAVE"]);
  });

  it("mergeServerCoupons lifts checkout-map entries that have no catalog row (synced before the catalog existed)", () => {
    localStorage.setItem("datiq.coupons", JSON.stringify([]));
    const { merged } = mergeServerCoupons({
      catalog: null,
      checkoutMap: { OLD20: { value: 20, planId: null, active: true, maxUses: 5 }, B10: { value: 0, credits: 10, active: true } },
    });
    const by = Object.fromEntries(merged.map((c) => [c.code, c]));
    expect(by.OLD20).toMatchObject({ type: "percent", value: 20, maxUses: 5 });
    expect(by.B10).toMatchObject({ type: "extractions", value: 10 });
  });
});

describe("admin session-invalid guard — a 401 must not leave a silent empty admin", () => {
  it("only authenticated /api/admin* calls count (not admin-auth, not unauthenticated reads)", () => {
    const bearer = { headers: { Authorization: "Bearer abc" } };
    expect(isAdminApiRequest("/api/admin-users", bearer)).toBe(true);
    expect(isAdminApiRequest("/api/admin-monitoring?x=1", bearer)).toBe(true);
    expect(isAdminApiRequest("/api/admin-auth", bearer)).toBe(false);   // a wrong PIN is not an invalid session
    expect(isAdminApiRequest("/api/admin-general-config", {})).toBe(false); // public read, no token
    expect(isAdminApiRequest("/api/extract", bearer)).toBe(false);
  });

  it("a 401 clears the token and fires onInvalid; other statuses do not", async () => {
    localStorage.setItem("scrapelite.adminAuth", "tok.sig");
    localStorage.setItem("scrapelite.adminAuthExp", String(Date.now() + 1_000_000));
    const statuses = [200, 500, 401];
    const orig = vi.fn(async () => ({ status: statuses.shift() }));
    vi.stubGlobal("fetch", orig);
    window.fetch = orig;
    const onInvalid = vi.fn();
    const uninstall = installAdminSessionGuard(onInvalid);
    const init = { headers: { Authorization: "Bearer tok.sig" } };

    await window.fetch("/api/admin-users", init);
    await window.fetch("/api/admin-users", init);
    expect(onInvalid).not.toHaveBeenCalled();
    expect(isAdminAuthed()).toBe(true);

    await window.fetch("/api/admin-users", init);
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(isAdminAuthed()).toBe(false);

    uninstall();
    expect(window.fetch).toBe(orig);
    vi.unstubAllGlobals();
  });
});
