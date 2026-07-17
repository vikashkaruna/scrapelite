// src/lib/shareService.test.js — Q6 (shareable links + public gallery) unit tests.

import { describe, expect, it, beforeEach } from "vitest";
import {
  generateSlug,
  shareExtraction,
  unshareExtraction,
  getPublicBySlug,
  getSharedSlugForId,
  getGallery,
  buildPublicUrl,
  isValidSlug,
  _resetShareForTests,
} from "./shareService.js";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  _resetShareForTests();
});

const sampleExtraction = () => ({
  id: "ext_1",
  title: "Stripe — Pricing",
  url: "https://stripe.com/pricing",
  ai_summary: "Stripe offers four pricing tiers.",
  custom_extraction: { plans: [{ name: "Free", price: "$0" }] },
  intent: "pricing",
  created_at: "2026-07-17T00:00:00Z",
});

describe("Q6 — shareService: slug + share lifecycle", () => {
  it("generates a slug of the right shape (lowercase, no ambiguous chars)", () => {
    for (let i = 0; i < 50; i++) {
      const s = generateSlug();
      expect(s).toMatch(/^[a-z0-9]{8}$/);
      // No ambiguous chars (0/o/1/l)
      expect(s).not.toMatch(/[0o1l]/);
    }
  });

  it("isValidSlug accepts/rejects the right shapes", () => {
    expect(isValidSlug("k7m2p4qx")).toBe(true);
    expect(isValidSlug("abcdef")).toBe(true);
    expect(isValidSlug("ABC")).toBe(false);     // uppercase
    expect(isValidSlug("abc def")).toBe(false); // space
    expect(isValidSlug("a_b_c")).toBe(false);   // underscore
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug(null)).toBe(false);
  });

  it("shareExtraction creates a slug and stores a public projection", () => {
    const slug = shareExtraction(sampleExtraction());
    expect(slug).toMatch(/^[a-z0-9]{8}$/);
    const pub = getPublicBySlug(slug);
    expect(pub).toBeTruthy();
    expect(pub.title).toBe("Stripe — Pricing");
    expect(pub.url).toBe("https://stripe.com/pricing");
    expect(pub.intent).toBe("pricing");
    expect(pub.is_public).toBe(true);
  });

  it("shareExtraction is idempotent for the same id (returns same slug)", () => {
    const ext = sampleExtraction();
    const slug1 = shareExtraction(ext);
    const slug2 = shareExtraction({ ...ext, ai_summary: "Updated" });
    expect(slug1).toBe(slug2);
    const pub = getPublicBySlug(slug1);
    expect(pub.ai_summary).toBe("Updated"); // the new value overwrote
  });

  it("shareExtraction throws when extraction.id is missing", () => {
    expect(() => shareExtraction({ title: "No ID" })).toThrow(/id is required/);
    expect(() => shareExtraction(null)).toThrow();
  });

  it("unshareExtraction removes the public record + the gallery entry", () => {
    const slug = shareExtraction(sampleExtraction());
    expect(getPublicBySlug(slug)).toBeTruthy();
    const ok = unshareExtraction("ext_1");
    expect(ok).toBe(true);
    expect(getPublicBySlug(slug)).toBeNull();
    expect(getGallery().find((e) => e.slug === slug)).toBeUndefined();
  });

  it("unshareExtraction returns false for an unknown id", () => {
    expect(unshareExtraction("nope")).toBe(false);
  });

  it("getSharedSlugForId returns the slug for a shared extraction", () => {
    const slug = shareExtraction(sampleExtraction());
    expect(getSharedSlugForId("ext_1")).toBe(slug);
    expect(getSharedSlugForId("ext_unknown")).toBeNull();
  });

  it("getGallery returns the most recent shared extraction first", () => {
    shareExtraction({ ...sampleExtraction(), id: "ext_a", title: "A" });
    shareExtraction({ ...sampleExtraction(), id: "ext_b", title: "B" });
    const g = getGallery();
    expect(g[0].title).toBe("B");
    expect(g[1].title).toBe("A");
  });

  it("getGallery respects the limit argument", () => {
    for (let i = 0; i < 5; i++) {
      shareExtraction({ ...sampleExtraction(), id: `ext_${i}` });
    }
    expect(getGallery(2)).toHaveLength(2);
    expect(getGallery(10)).toHaveLength(5);
  });

  it("buildPublicUrl constructs a URL from origin + slug", () => {
    // jsdom default origin
    const url = buildPublicUrl("k7m2p4qx");
    expect(url).toMatch(/\/p\/k7m2p4qx$/);
  });
});
