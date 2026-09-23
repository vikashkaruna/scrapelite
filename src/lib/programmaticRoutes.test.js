// src/lib/programmaticRoutes.test.js — F11 (programmatic SEO data).

import { describe, it, expect } from "vitest";
import { PROGRAMMATIC_ROUTES, getRouteBySlug, getAllSlugs } from "./programmaticRoutes.js";

describe("programmaticRoutes (F11)", () => {
  it("has all 10 expected slugs", () => {
    const slugs = getAllSlugs();
    expect(slugs).toContain("for-sales");
    expect(slugs).toContain("for-seo");
    expect(slugs).toContain("for-ci");
    expect(slugs).toContain("for-finance");
    expect(slugs).toContain("for-healthcare");
    expect(slugs).toContain("for-retail");
    expect(slugs).toContain("for-legal");
    expect(slugs).toContain("extract-pricing");
    expect(slugs).toContain("extract-contacts");
    expect(slugs).toContain("extract-headings");
  });

  it("getRouteBySlug returns the right route", () => {
    expect(getRouteBySlug("for-sales").persona).toBe("sales");
    expect(getRouteBySlug("for-finance").industry).toBe("finance");
    expect(getRouteBySlug("extract-pricing").intent).toBe("pricing");
    expect(getRouteBySlug("nope")).toBeNull();
  });

  it("every persona route has a valid persona field", () => {
    const personaSlugs = getAllSlugs().filter((s) => getRouteBySlug(s)?.kind === "persona");
    expect(personaSlugs.length).toBe(3);
    for (const s of personaSlugs) {
      const r = getRouteBySlug(s);
      expect(r.kind).toBe("persona");
      expect(typeof r.persona).toBe("string");
      expect(typeof r.personaLabel).toBe("string");
      expect(r.bullets.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("every industry route has a valid industry field", () => {
    const industrySlugs = getAllSlugs().filter((s) => getRouteBySlug(s)?.kind === "industry");
    expect(industrySlugs.length).toBe(4);
    for (const s of industrySlugs) {
      const r = getRouteBySlug(s);
      expect(r.kind).toBe("industry");
      expect(typeof r.industry).toBe("string");
      expect(typeof r.industryLabel).toBe("string");
      expect(r.bullets.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("every extract route has a valid intent field", () => {
    const extractSlugs = getAllSlugs().filter((s) => s.startsWith("extract-"));
    expect(extractSlugs.length).toBe(3);
    for (const s of extractSlugs) {
      const r = getRouteBySlug(s);
      expect(r.kind).toBe("extract");
      expect(typeof r.intent).toBe("string");
      expect(typeof r.intentLabel).toBe("string");
      expect(r.bullets.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("every route has H1, sub, description, primary CTA, and keywords", () => {
    for (const slug of getAllSlugs()) {
      const r = getRouteBySlug(slug);
      expect(r.h1.length).toBeGreaterThan(10);
      expect(r.sub.length).toBeGreaterThan(20);
      expect(r.description.length).toBeGreaterThan(40);
      expect(r.ctaPrimary.label).toBeTruthy();
      expect(r.ctaPrimary.href).toBeTruthy();
      expect(r.keywords.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("the primary CTA href is always '/' (Home) so it routes to the composer", () => {
    for (const slug of getAllSlugs()) {
      const r = getRouteBySlug(slug);
      expect(r.ctaPrimary.href).toBe("/");
    }
  });

  it("every primary CTA has a pre-filled URL and intent so the user gets a one-click demo", () => {
    for (const slug of getAllSlugs()) {
      const r = getRouteBySlug(slug);
      expect(r.ctaPrimary.prefilled).toMatch(/^https:\/\//);
      expect(r.ctaPrimary.intent).toBeTruthy();
    }
  });
});
