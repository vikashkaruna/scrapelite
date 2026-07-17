// src/lib/referralService.test.js — FA2 (referral credits loop).

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getMyReferralCode,
  _resetMyReferralCode,
  getReferralBonus,
  addReferralBonus,
  getRedeemedCodes,
  hasRedeemedCode,
  buildReferralUrl,
  redeemReferralCode,
  _resetReferralsForTests,
  REFERRAL_BONUS,
} from "./referralService.js";

vi.mock("./usageRepo.js", () => ({
  getSessionId: () => "test-session-id-abc123",
}));

describe("referralService (FA2)", () => {
  beforeEach(() => {
    _resetReferralsForTests();
  });

  describe("getMyReferralCode", () => {
    it("returns an 8-char uppercase code", () => {
      const c = getMyReferralCode();
      expect(c).toMatch(/^[A-Z0-9]{8}$/);
    });

    it("is stable across calls (same session → same code)", () => {
      const c1 = getMyReferralCode();
      const c2 = getMyReferralCode();
      expect(c1).toBe(c2);
    });

    it("regenerates if explicitly reset", () => {
      const c1 = getMyReferralCode();
      _resetMyReferralCode();
      const c2 = getMyReferralCode();
      // Session-id-derived code is stable, so reset clears the cache but
      // the next get should return the same session-derived value.
      expect(c2).toBe(c1);
    });

    it("does not include ambiguous chars 0/O/1/I", () => {
      // 1000 trials — none should contain 0, O, 1, or I.
      for (let i = 0; i < 1000; i++) {
        _resetMyReferralCode();
        const c = getMyReferralCode();
        expect(c).not.toMatch(/[0O1I]/);
      }
    });
  });

  describe("bonus + redemption", () => {
    it("starts at 0", () => {
      expect(getReferralBonus()).toBe(0);
    });

    it("addReferralBonus accumulates", () => {
      addReferralBonus(25);
      expect(getReferralBonus()).toBe(25);
      addReferralBonus(10);
      expect(getReferralBonus()).toBe(35);
    });

    it("redeems a valid code and adds the bonus", () => {
      // Set a different invite code so we're not redeeming our own.
      try { localStorage.setItem("datiq.referralCode", "AAAAAAAA"); } catch {}
      const r = redeemReferralCode("BBBBBBBB");
      expect(r.ok).toBe(true);
      expect(r.bonus).toBe(REFERRAL_BONUS);
      expect(getReferralBonus()).toBe(REFERRAL_BONUS);
    });

    it("rejects a self-redeem with reason='self'", () => {
      const c = getMyReferralCode();
      const r = redeemReferralCode(c);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("self");
    });

    it("rejects a double-redeem with reason='already'", () => {
      try { localStorage.setItem("datiq.referralCode", "AAAAAAAA"); } catch {}
      const r1 = redeemReferralCode("BBBBBBBB");
      expect(r1.ok).toBe(true);
      const r2 = redeemReferralCode("BBBBBBBB");
      expect(r2.ok).toBe(false);
      expect(r2.reason).toBe("already");
      // Still only one bonus granted
      expect(getReferralBonus()).toBe(REFERRAL_BONUS);
    });

    it("rejects an invalid-shape code with reason='invalid'", () => {
      const r1 = redeemReferralCode("");
      expect(r1.ok).toBe(false);
      expect(r1.reason).toBe("invalid");
      const r2 = redeemReferralCode("abc"); // too short
      expect(r2.ok).toBe(false);
      expect(r2.reason).toBe("invalid");
      const r3 = redeemReferralCode("ABCDEFGHIJKLMNOP"); // too long
      expect(r3.ok).toBe(false);
      expect(r3.reason).toBe("invalid");
    });

    it("case-normalises the code before checking", () => {
      try { localStorage.setItem("datiq.referralCode", "AAAAAAAA"); } catch {}
      const r = redeemReferralCode("bbbbbbbb");
      expect(r.ok).toBe(true);
    });

    it("records the redeemed code in datiq.referralRedemptions", () => {
      try { localStorage.setItem("datiq.referralCode", "AAAAAAAA"); } catch {}
      redeemReferralCode("BBBBBBBB");
      expect(hasRedeemedCode("BBBBBBBB")).toBe(true);
      expect(getRedeemedCodes()).toContain("BBBBBBBB");
    });
  });

  describe("buildReferralUrl", () => {
    it("returns a URL with ?ref=CODE", () => {
      const url = buildReferralUrl("ABCD1234", "https://datiq.app");
      expect(url).toBe("https://datiq.app/?ref=ABCD1234");
    });

    it("URL-encodes the code", () => {
      const url = buildReferralUrl("AB CD12", "https://datiq.app");
      expect(url).toBe("https://datiq.app/?ref=AB%20CD12");
    });
  });

  describe("REFERRAL_BONUS constant", () => {
    it("is 25 (give 25 / get 25 per council spec)", () => {
      expect(REFERRAL_BONUS).toBe(25);
    });
  });
});
