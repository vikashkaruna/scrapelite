import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DISPOSABLE_DOMAINS, MAX_FREE_GRANTS_PER_IP, FREE_GRANT,
  emailDomain, isDisposable, freeGrantEligibility,
} from "./freeTierPolicy.js";

describe("emailDomain", () => {
  it("reads the domain, lower-cased", () => {
    expect(emailDomain("Alice@Example.COM")).toBe("example.com");
  });

  it("returns null for anything that is not an address", () => {
    for (const bad of ["", null, undefined, "nope", "@nope.com", "a@"]) {
      expect(emailDomain(bad)).toBeNull();
    }
  });

  // A plus-address is a normal address; the domain is what matters.
  it("is unaffected by plus-addressing", () => {
    expect(emailDomain("a+throwaway@acme.com")).toBe("acme.com");
  });
});

describe("isDisposable", () => {
  it("catches the listed providers", () => {
    expect(isDisposable("x@mailinator.com")).toBe(true);
    expect(isDisposable("x@yopmail.com")).toBe(true);
  });

  // 🔴 Matching the exact string only is how a one-character bypass works.
  it("catches SUBDOMAINS of a listed provider", () => {
    expect(isDisposable("x@foo.mailinator.com")).toBe(true);
    expect(isDisposable("x@a.b.guerrillamail.com")).toBe(true);
  });

  it("does not catch a domain that merely ends in similar letters", () => {
    expect(isDisposable("x@notmailinator.com")).toBe(false);
    expect(isDisposable("x@mailinator.com.acme.co")).toBe(false);
  });

  it("leaves ordinary addresses alone", () => {
    for (const ok of ["x@acme.com", "x@gmail.com", "x@datiq.app"]) {
      expect(isDisposable(ok)).toBe(false);
    }
  });
});

describe("freeGrantEligibility", () => {
  it("allows a verified address on a real domain", () => {
    expect(freeGrantEligibility({ email: "a@acme.com", emailVerified: true, ipGrants: 0 }).ok).toBe(true);
  });

  it("withholds the grant until the address is confirmed", () => {
    const r = freeGrantEligibility({ email: "a@acme.com", emailVerified: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(FREE_GRANT.UNVERIFIED);
    // The message has to say what to DO.
    expect(r.message).toMatch(/confirm your email/i);
  });

  it("withholds it from a disposable address", () => {
    const r = freeGrantEligibility({ email: "a@mailinator.com", emailVerified: true });
    expect(r.reason).toBe(FREE_GRANT.DISPOSABLE);
    // ⚠️ Refused the GRANT, not the account — the copy must not read as a ban.
    expect(r.message).toMatch(/choose a plan/i);
  });

  it("withholds it once a network has had its share", () => {
    expect(freeGrantEligibility({
      email: "a@acme.com", emailVerified: true, ipGrants: MAX_FREE_GRANTS_PER_IP,
    }).reason).toBe(FREE_GRANT.IP_LIMIT);
    expect(freeGrantEligibility({
      email: "a@acme.com", emailVerified: true, ipGrants: MAX_FREE_GRANTS_PER_IP - 1,
    }).ok).toBe(true);
  });

  // ── 🔴 EVERY UNKNOWN READS AS ELIGIBLE ────────────────────────────────────
  // Refusing somebody their first 100 credits because a lookup failed is the
  // worst possible first impression, and it is indistinguishable to them from
  // the product simply not working.
  it("reads through when verification state is unknown", () => {
    expect(freeGrantEligibility({ email: "a@acme.com", emailVerified: null }).ok).toBe(true);
    expect(freeGrantEligibility({ email: "a@acme.com" }).ok).toBe(true);
  });

  it("reads through when the IP count is unavailable", () => {
    for (const unknown of [null, undefined, NaN]) {
      expect(freeGrantEligibility({ email: "a@acme.com", emailVerified: true, ipGrants: unknown }).ok).toBe(true);
    }
  });

  it("reads through when there is no email at all", () => {
    expect(freeGrantEligibility({ emailVerified: true }).ok).toBe(true);
  });

  // Unverified is checked FIRST: it is the one the user can fix themselves,
  // and telling a throwaway-address user to confirm their email is better
  // advice than telling them their domain is banned.
  it("reports the actionable refusal first", () => {
    expect(freeGrantEligibility({
      email: "a@mailinator.com", emailVerified: false, ipGrants: 99,
    }).reason).toBe(FREE_GRANT.UNVERIFIED);
  });
});

describe("the policy itself", () => {
  it("keeps the blocklist short enough to stay honest", () => {
    // A long list goes stale and gets trusted anyway. The goal is to raise the
    // cost of farming a hundred pools, not to win an arms race.
    expect(DISPOSABLE_DOMAINS.size).toBeLessThan(60);
    expect(DISPOSABLE_DOMAINS.size).toBeGreaterThan(5);
  });

  it("allows a household or office to sign up a few accounts", () => {
    expect(MAX_FREE_GRANTS_PER_IP).toBeGreaterThanOrEqual(3);
  });

  // 🔴 Explicitly out of scope, and the kind of thing that arrives by
  // accident once somebody wants a "better" signal. Read from disk because
  // the point is what the SOURCE contains, not what it exports.
  it("contains no device fingerprinting", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/credits/freeTierPolicy.js"), "utf8");
    for (const api of ["navigator.userAgent", "createElement(\"canvas\")", "getContext(", "webgl", "screen.width", "AudioContext"]) {
      expect(src, api).not.toContain(api);
    }
  });
});
