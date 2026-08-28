import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  classifyError,
  isComplianceError,
  isAccountBlockedError,
  accountBlockedTitle,
  formatDetail,
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

/**
 * A frozen / deletion-pending / suspended account is a deliberate account
 * block, not a fault — same shape as the compliance refusal above, and it hit
 * the exact same bug: reported live as "Something went wrong. An unexpected
 * error occurred." with the real, already-actionable server message ("This
 * account is scheduled for deletion...") buried under three lines of
 * minified stack in "technical details".
 */
describe("classifyError — account blocks are not faults", () => {
  const deletionErr = () => {
    const e = new Error(
      "This account is scheduled for deletion. You can still read and export your data. " +
      "Cancel the deletion in Account to start working again.",
    );
    e.code = "DELETION_PENDING";
    e.status = 402;
    return e;
  };

  it("does NOT fall through to the generic default", () => {
    const r = classifyError(deletionErr());
    expect(r.title).not.toMatch(/something went wrong/i);
    expect(r.message).not.toMatch(/unexpected error/i);
  });

  it("uses the server's own message verbatim, not a canned string", () => {
    const e = deletionErr();
    expect(classifyError(e).message).toBe(e.message);
  });

  it("names the block for what it is, per code", () => {
    expect(classifyError(deletionErr()).title).toBe("This account is scheduled for deletion");
    const frozen = new Error("This account is frozen.");
    frozen.code = "FROZEN";
    expect(classifyError(frozen).title).toBe("This account is frozen");
    const paused = new Error("Your seat in this workspace is paused.");
    paused.code = "MEMBER_PAUSED";
    expect(classifyError(paused).title).toBe("Your seat is paused");
  });

  it("takes priority over a coincidental status-based match (402 isn't in CATEGORIES, but proves precedence)", () => {
    const e = deletionErr();
    const r = classifyError(e);
    expect(r.title).toBe(accountBlockedTitle("DELETION_PENDING"));
  });

  it("formatDetail drops the stack — a policy decision is not a crash", () => {
    const e = deletionErr();
    e.stack = "Error: x\n    at r (apiClient.js:1:1)\n    at async hl (index.js:1:1)";
    const detail = formatDetail(e);
    expect(detail).not.toContain("at r (");
    expect(detail).toBe(e.message);
  });
});

describe("isAccountBlockedError", () => {
  it("recognises every account-blocked code", () => {
    for (const code of ["FROZEN", "DELETION_PENDING", "MEMBER_PAUSED", "SUSPENDED", "DEACTIVATED", "GRANT_EXPIRED", "PURGED"]) {
      const e = new Error("x");
      e.code = code;
      expect(isAccountBlockedError(e)).toBe(true);
    }
  });

  it("does not misclassify a plan/quota denial", () => {
    const e = new Error("You've used all 10 extractions this month.");
    e.code = "QUOTA_EXCEEDED";
    expect(isAccountBlockedError(e)).toBe(false);
    expect(classifyError(e).title).not.toBe(accountBlockedTitle("QUOTA_EXCEEDED"));
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

describe("formatDetail — a refusal is not a crash report", () => {
  function complianceErr() {
    const e = new Error("robots.txt disallows scraping for DatIQBot/1.0 (path=/)");
    e.code = "robots_disallowed";
    e.stack = "Error: x\n    at n (apiClient-CGmcN3Hq.js:1:558)\n    at async al (index-Bngwiq7f.js:21:2158)";
    return e;
  }

  it("shows the reason and NOTHING else for a compliance refusal", () => {
    // The stack here belongs to apiClient's fetch wrapper — nothing crashed in
    // it. Printing a minified trace under a deliberate policy decision is what
    // made users read the refusal as a crash in the first place; fixing the
    // title and message while still showing a stack only half-solved it.
    const detail = formatDetail(complianceErr());
    expect(detail).toBe("robots.txt disallows scraping for DatIQBot/1.0 (path=/)");
    expect(detail).not.toMatch(/at /);
    expect(detail).not.toMatch(/apiClient|index-/);
  });

  it("still shows a stack for a genuine failure", () => {
    // Narrowing the rule to refusals must not remove the diagnostics that make
    // a real fault debuggable.
    const e = new Error("Failed to fetch");
    e.stack = "Error: y\n    at fetch (chunk.js:1:1)";
    expect(formatDetail(e)).toMatch(/at fetch/);
  });

  it("returns null for no error", () => {
    expect(formatDetail(null)).toBeNull();
  });
});
