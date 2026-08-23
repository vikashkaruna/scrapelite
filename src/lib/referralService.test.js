// src/lib/referralService.test.js
//
// The referral loop, client half. What is worth pinning here is mostly what
// this module REFUSES to do: it must never mint a code, decide eligibility, or
// invent a bonus. Every one of those was previously done locally, and every
// one of them was wrong — see the header of referralService.js.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeCode,
  buildReferralUrl,
  setPendingReferral,
  getPendingReferral,
  clearPendingReferral,
  fetchReferralStatus,
  redeemReferralCode,
  REFERRAL_BONUS,
} from "./referralService.js";

vi.mock("./apiClient.js", () => ({
  apiClient: { getReferral: vi.fn(), redeemReferral: vi.fn() },
}));
const { apiClient } = await import("./apiClient.js");

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("the module mints nothing", () => {
  it("exports no code generator", async () => {
    // The old getMyReferralCode() derived a code from the session id with an
    // LCG that overflowed MAX_SAFE_INTEGER, so `% 32` was always 0 and every
    // user got "AAAAAAAA". Codes are the server's job now; a client-side
    // generator reappearing here is the regression to catch.
    const mod = await import("./referralService.js");
    expect(mod.getMyReferralCode).toBeUndefined();
    expect(mod.generateCode).toBeUndefined();
    expect(mod.hashSessionId).toBeUndefined();
    expect(mod.addReferralBonus).toBeUndefined();
  });
});

describe("normalizeCode", () => {
  it("upper-cases and trims what a user typed", () => {
    expect(normalizeCode("  q7bkm2xr ")).toBe("Q7BKM2XR");
  });

  it("rejects anything that isn't code-shaped", () => {
    for (const bad of ["", null, undefined, 42, "abc", "way-too-long-for-a-code", "AB CD12", "AB!DEF"]) {
      expect(normalizeCode(bad)).toBe("");
    }
  });
});

describe("pending referral stash", () => {
  it("keeps a code across the sign-up round trip", () => {
    // A guest lands on ?ref=CODE. Redemption needs an account, so the code
    // waits rather than being spent by someone who has no identity yet.
    expect(setPendingReferral("q7bkm2xr")).toBe(true);
    expect(getPendingReferral()).toBe("Q7BKM2XR");
  });

  it("refuses to stash junk", () => {
    expect(setPendingReferral("nope!")).toBe(false);
    expect(getPendingReferral()).toBe("");
  });

  it("clears once spent", () => {
    setPendingReferral("Q7BKM2XR");
    clearPendingReferral();
    expect(getPendingReferral()).toBe("");
  });
});

describe("fetchReferralStatus", () => {
  it("reports the server's code and standing", async () => {
    apiClient.getReferral.mockResolvedValue({ code: "Q7BKM2XR", referrals: 3, bonus: 75 });
    expect(await fetchReferralStatus()).toEqual({
      code: "Q7BKM2XR", referrals: 3, bonus: 75, degraded: false,
    });
  });

  it("returns NO code when the request fails, rather than inventing one", async () => {
    // The bug this replaces shipped a fabricated code to every user. A null
    // here makes the banner render nothing, which is the honest outcome.
    apiClient.getReferral.mockRejectedValue(new Error("401"));
    const s = await fetchReferralStatus();
    expect(s.code).toBeNull();
    expect(s.degraded).toBe(true);
  });
});

describe("redeemReferralCode", () => {
  it("sends the normalised code and reports the granted bonus", async () => {
    apiClient.redeemReferral.mockResolvedValue({ ok: true, bonus: 25 });
    const r = await redeemReferralCode(" q7bkm2xr ");
    expect(apiClient.redeemReferral).toHaveBeenCalledWith("Q7BKM2XR");
    expect(r).toEqual({ ok: true, bonus: 25 });
  });

  it("does not call the API for a malformed code", async () => {
    const r = await redeemReferralCode("nope");
    expect(apiClient.redeemReferral).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid");
  });

  it("surfaces the server's reason and wording", async () => {
    // The server owns the copy for each verdict so the two cannot drift.
    const err = new Error("You've already used an invite code on this account.");
    err.reason = "already";
    err.status = 409;
    apiClient.redeemReferral.mockRejectedValue(err);
    const r = await redeemReferralCode("Q7BKM2XR");
    expect(r).toEqual({ ok: false, reason: "already", error: err.message });
  });

  it("marks an unauthenticated attempt as needing sign-in", async () => {
    const err = new Error("Authentication required");
    err.status = 401;
    apiClient.redeemReferral.mockRejectedValue(err);
    expect((await redeemReferralCode("Q7BKM2XR")).reason).toBe("signin");
  });

  it("never throws, whatever the transport does", async () => {
    apiClient.redeemReferral.mockRejectedValue(new Error("Failed to fetch"));
    await expect(redeemReferralCode("Q7BKM2XR")).resolves.toMatchObject({ ok: false });
  });
});

describe("buildReferralUrl", () => {
  it("builds a shareable link", () => {
    expect(buildReferralUrl("Q7BKM2XR", "https://datiq.app")).toBe("https://datiq.app/?ref=Q7BKM2XR");
  });

  it("encodes the code", () => {
    expect(buildReferralUrl("A B", "https://datiq.app")).toBe("https://datiq.app/?ref=A%20B");
  });
});

describe("REFERRAL_BONUS", () => {
  it("matches the server constant it mirrors", () => {
    expect(REFERRAL_BONUS).toBe(25);
  });
});
