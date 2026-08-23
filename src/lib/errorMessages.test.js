import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  classifyError,
  isComplianceError,
  COMPLIANCE_ERROR,
} from "./errorMessages.js";

/**
 * U-73 — errorMessages maps raw error patterns to user-facing categories.
 * The tests assert the documented regexes resolve to the right title +
 * message and the fallback is sensible for unknown inputs.
 */

describe("classifyError — every documented category (U-73)", () => {
  for (const c of CATEGORIES) {
    it(`matches ${c.title}`, () => {
      // Build a synthetic error string guaranteed to hit the regex.
      const synthetic = c.test.source.replace(/^\//, "").replace(/\/i?$/, "");
      const r = classifyError(new Error(synthetic));
      expect(r.title).toBe(c.title);
    });
  }

  it("returns the fallback for an unknown error", () => {
    const r = classifyError(new Error("something nobody has seen before"));
    // The fallback category is the last entry — its title is "Something went wrong"
    // or similar. We only assert the shape, not the exact title.
    expect(typeof r.title).toBe("string");
    expect(typeof r.message).toBe("string");
  });
});

/**
 * A robots.txt refusal is DatIQ working as designed — the server declined
 * before contacting any provider. It used to match none of the regexes (the
 * "403" that would have caught it lives on `err.status`, not in the prose), so
 * it fell through to the generic default and every LinkedIn URL was reported to
 * the user as "Something went wrong. An unexpected error occurred." with a
 * minified stack trace attached.
 */
describe("classifyError — compliance refusals are not faults", () => {
  const ROBOTS = "robots.txt disallows scraping for DatIQBot/1.0 (path=/company/anthropic)";

  it("does NOT fall through to the generic default", () => {
    const r = classifyError(new Error(ROBOTS));
    expect(r.title).not.toMatch(/something went wrong/i);
    expect(r.message).not.toMatch(/unexpected error/i);
  });

  it("names the refusal for what it is", () => {
    expect(classifyError(new Error(ROBOTS)).title).toBe(COMPLIANCE_ERROR.title);
  });

  it("says nothing went wrong on the user's side", () => {
    expect(classifyError(new Error(ROBOTS)).message).toMatch(/nothing went wrong/i);
  });

  it("classifies the operator-allowlist rejection the same way", () => {
    const r = classifyError(new Error("Host x.com is not on the operator-configured permitted-hosts list"));
    expect(r.title).toBe(COMPLIANCE_ERROR.title);
  });

  it("classifies from the structured code even when the prose is opaque", () => {
    const e = new Error("Request failed");
    e.code = "robots_disallowed";
    expect(classifyError(e).title).toBe(COMPLIANCE_ERROR.title);
  });

  it("falls back to the HTTP status when the body carries no digits", () => {
    // Servers say what they happen to say; status is what they mean.
    const e = new Error("Nope, not for you");
    e.status = 403;
    expect(classifyError(e).title).toBe("Access forbidden");
  });
});

describe("isComplianceError", () => {
  it("recognises the server flag", () => {
    const e = new Error("anything");
    e.complianceBlocked = true;
    expect(isComplianceError(e)).toBe(true);
  });

  it("recognises both compliance codes", () => {
    for (const code of ["robots_disallowed", "host_not_permitted"]) {
      const e = new Error("x");
      e.code = code;
      expect(isComplianceError(e)).toBe(true);
    }
  });

  it("recognises the message alone, for a server that predates the code field", () => {
    expect(isComplianceError(new Error("robots.txt disallows scraping for DatIQBot/1.0 (path=/x)"))).toBe(true);
  });

  it("does not misread an ordinary failure as a refusal", () => {
    // This is the boundary that decides whether a user gets a "Try again"
    // button, so a false positive here silently removes recovery from a real
    // outage.
    expect(isComplianceError(new Error("Failed to fetch"))).toBe(false);
    const e = new Error("Server error");
    e.status = 500;
    expect(isComplianceError(e)).toBe(false);
    expect(isComplianceError(null)).toBe(false);
  });
});
