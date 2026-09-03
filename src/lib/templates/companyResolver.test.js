import { describe, it, expect } from "vitest";
import { candidateDomains, nameToSlug, scoreMatch, judge, bestOf } from "./companyResolver.js";

describe("candidateDomains", () => {
  it("tries the FIRST TOKEN before the whole name — companies shorten", () => {
    const c = candidateDomains("Protean eGov Technologies");
    expect(c[0]).toBe("protean.com");
    expect(c).toContain("proteanegov.com");
  });

  it("strips legal suffixes and noise", () => {
    expect(nameToSlug("Acme Inc.")).toBe("acme");
    expect(nameToSlug("Zoho Corporation")).toBe("zoho");
    expect(nameToSlug("The Widget Company Ltd")).toBe("widget");
  });

  // The PRD ships a "Lead List Builder for Indian SMBs", so an Indian company
  // is a first-class case here — omitting .in would make this quietly useless
  // for a segment the product explicitly targets.
  it("includes .in, not only western TLDs", () => {
    expect(candidateDomains("Acme", { max: 6 })).toContain("acme.in");
  });

  // Inventing five wrong alternatives around a correct answer wastes fetches
  // and can only make the result worse.
  it("returns a typed domain unchanged instead of guessing around it", () => {
    expect(candidateDomains("stripe.com")).toEqual(["stripe.com"]);
    expect(candidateDomains("https://www.stripe.com/pricing")).toEqual(["stripe.com"]);
  });

  // Each candidate costs a real fetch. A long list turns a form field into a
  // crawler, and the person typing is not the one who pays for it.
  it("is hard-capped", () => {
    expect(candidateDomains("Acme", { max: 3 })).toHaveLength(3);
    expect(candidateDomains("Acme").length).toBeLessThanOrEqual(5);
  });

  it("returns nothing for input with no usable token", () => {
    expect(candidateDomains("")).toEqual([]);
    expect(candidateDomains("   ")).toEqual([]);
    expect(candidateDomains("Inc. Ltd. The")).toEqual([]);
    expect(candidateDomains(null)).toEqual([]);
  });

  it("never produces a duplicate candidate", () => {
    const c = candidateDomains("Stripe", { max: 6 });
    expect(new Set(c).size).toBe(c.length);
  });
});

describe("scoreMatch — we only claim what the page corroborated", () => {
  it("scores a full match when the page names the company", () => {
    expect(scoreMatch("Acme", { title: "Acme — widgets for everyone" })).toBe(1);
    expect(scoreMatch("Zoho Corporation", { siteName: "Zoho" })).toBe(1);
  });

  it("scores a first-token match as WEAK, not confirmed", () => {
    const s = scoreMatch("Protean eGov Technologies", { title: "Protean — Digital Public Infrastructure" });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
    expect(judge("Protean eGov Technologies", "protean.com", { title: "Protean — DPI" }).confirmed).toBe(false);
  });

  it("scores an unrelated page zero", () => {
    expect(scoreMatch("Acme", { title: "Completely Unrelated Business" })).toBe(0);
  });

  it("ignores a too-short first token rather than matching noise", () => {
    // "AB Systems" must not match any page containing "ab".
    expect(scoreMatch("AB Systems", { title: "Fabulous Cabbages" })).toBe(0);
  });

  it("survives an empty or missing page", () => {
    expect(scoreMatch("Acme", {})).toBe(0);
    expect(scoreMatch("Acme", null)).toBe(0);
    expect(scoreMatch("", { title: "Acme" })).toBe(0);
  });
});

describe("judge / bestOf", () => {
  it("marks only a full match as confirmed", () => {
    expect(judge("Acme", "acme.com", { title: "Acme Inc" }).confirmed).toBe(true);
    expect(judge("Acme", "acme.io", { title: "Nothing here" }).confirmed).toBe(false);
  });

  it("picks the strongest candidate and ignores zero-confidence ones", () => {
    const best = bestOf([
      judge("Acme", "acme.io", { title: "Unrelated" }),
      judge("Acme", "acme.com", { title: "Acme Inc" }),
    ]);
    expect(best.domain).toBe("acme.com");
  });

  // A miss is the EXPECTED outcome for any company whose domain does not
  // derive from its name. The caller must treat null as "type it yourself".
  it("returns null when nothing corroborated — never a bare guess", () => {
    expect(bestOf([judge("Acme", "acme.io", { title: "Unrelated" })])).toBeNull();
    expect(bestOf([])).toBeNull();
    expect(bestOf(null)).toBeNull();
  });
});
