// auditUrl.test.js — the canonical identity of an audited page.
//
// An audit's value is its HISTORY, and history only accumulates when the same
// page resolves to the same target every time. These pin the two failure
// directions: splitting one page into two trend lines (tracking params,
// fragments, param order) and merging two genuinely different pages into one
// (stripping a real parameter).

import { describe, it, expect } from "vitest";
import {
  TRACKING_PARAMS, canonicalAuditUrl, auditHost, sameAuditTarget,
} from "./auditUrl.js";

describe("canonicalAuditUrl", () => {
  it("strips campaign parameters, so a newsletter link joins the page's history", () => {
    const tracked = canonicalAuditUrl("https://example.com/pricing?utm_source=news&utm_medium=email&gclid=abc");
    expect(tracked).toBe(canonicalAuditUrl("https://example.com/pricing"));
    expect(tracked).not.toMatch(/utm_|gclid|\?/);
  });

  it("KEEPS a real parameter — merging two different pages is the worse failure", () => {
    const docs = canonicalAuditUrl("https://docs.example.com/page?id=7&ref=api");
    expect(docs).toContain("id=7");
    expect(docs).toContain("ref=api");
    expect(docs).not.toBe(canonicalAuditUrl("https://docs.example.com/page?id=8&ref=api"));
  });

  it("sorts the parameters that remain, so order cannot open a second target", () => {
    const a = canonicalAuditUrl("https://example.com/p?b=2&a=1");
    expect(a).toBe(canonicalAuditUrl("https://example.com/p?a=1&b=2"));
    expect(a).toContain("a=1&b=2");
  });

  it("drops a fragment — it addresses a position, not a page", () => {
    expect(canonicalAuditUrl("https://example.com/p#faq")).toBe(canonicalAuditUrl("https://example.com/p"));
  });

  it("strips tracking and keeps the real parameter in the same URL", () => {
    const out = canonicalAuditUrl("https://example.com/p?utm_campaign=x&page=2&fbclid=y");
    expect(out).toContain("page=2");
    expect(out).not.toMatch(/utm_campaign|fbclid/);
  });

  it("returns an empty string for anything that is not an http(s) page", () => {
    expect(canonicalAuditUrl("")).toBe("");
    expect(canonicalAuditUrl("not a url")).toBe("");
    expect(canonicalAuditUrl("ftp://example.com/file")).toBe("");
  });
});

describe("auditHost", () => {
  it("strips www so both spellings group together", () => {
    expect(auditHost("https://www.Example.com/a")).toBe("example.com");
    expect(auditHost("https://shop.example.com/a")).toBe("shop.example.com");
  });

  it("is empty, not a throw, for an unparseable value", () => {
    expect(auditHost("nope")).toBe("");
  });
});

describe("sameAuditTarget", () => {
  it("treats a tracked, fragmented link as the same page", () => {
    expect(sameAuditTarget("https://example.com/p?utm_source=x#top", "https://example.com/p")).toBe(true);
  });

  it("keeps different paths apart", () => {
    expect(sameAuditTarget("https://example.com/a", "https://example.com/b")).toBe(false);
  });

  it("never calls two unparseable values the same target", () => {
    expect(sameAuditTarget("", "")).toBe(false);
    expect(sameAuditTarget("garbage", "garbage")).toBe(false);
  });
});

describe("TRACKING_PARAMS", () => {
  it("is a frozen, explicit list rather than a pattern", () => {
    expect(Object.isFrozen(TRACKING_PARAMS)).toBe(true);
    expect(TRACKING_PARAMS).toEqual(expect.arrayContaining(["utm_source", "gclid", "fbclid", "msclkid"]));
    // A pattern-based strip would eventually eat `?id=` or `?ref=`.
    expect(TRACKING_PARAMS).not.toContain("id");
    expect(TRACKING_PARAMS).not.toContain("ref");
  });
});
