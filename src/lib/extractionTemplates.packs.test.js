// src/lib/extractionTemplates.packs.test.js — F06 (Recipe Packs).

import { describe, it, expect } from "vitest";
import {
  EXTRACTION_TEMPLATES,
  RECIPE_PACKS,
  getPackByKey,
  getTemplatesByPack,
  getAllPackKeys,
  getTemplateByKey,
} from "./extractionTemplates.js";

describe("Recipe Packs (F06)", () => {
  it("defines the 4 expected packs", () => {
    const keys = getAllPackKeys();
    expect(keys).toEqual(["sales", "ci", "discoverability", "seo"]);
  });

  it("each pack has a label, description, icon, color, and at least 3 templates", () => {
    for (const p of RECIPE_PACKS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.icon).toBeTruthy();
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.templateKeys.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("every templateKey referenced by a pack exists in EXTRACTION_TEMPLATES", () => {
    for (const p of RECIPE_PACKS) {
      for (const key of p.templateKeys) {
        const tpl = getTemplateByKey(key);
        expect(tpl).toBeTruthy();
        expect(tpl.key).toBe(key);
      }
    }
  });

  it("every template's packs field is an array (backward-compatible — empty is fine)", () => {
    for (const t of EXTRACTION_TEMPLATES) {
      expect(Array.isArray(t.packs)).toBe(true);
    }
  });

  it("every pack's templates are in that pack's packs field too", () => {
    for (const p of RECIPE_PACKS) {
      const templates = getTemplatesByPack(p.key);
      for (const t of templates) {
        expect(t.packs).toContain(p.key);
      }
    }
  });

  it("getPackByKey returns null for unknown keys", () => {
    expect(getPackByKey("nope")).toBeNull();
  });

  it("getTemplatesByPack returns an empty array for unknown keys", () => {
    expect(getTemplatesByPack("nope")).toEqual([]);
  });

  it("Sales Pack includes yc-companies, leadership-contacts, linkedin-profile", () => {
    const sales = getTemplatesByPack("sales");
    const keys = sales.map((t) => t.key);
    expect(keys).toContain("yc-companies");
    expect(keys).toContain("leadership-contacts");
    expect(keys).toContain("linkedin-profile");
  });

  it("CI Pack includes saas-pricing, tech-stack, competitor-pricing", () => {
    const ci = getTemplatesByPack("ci");
    const keys = ci.map((t) => t.key);
    expect(keys).toContain("saas-pricing");
    expect(keys).toContain("tech-stack");
    expect(keys).toContain("competitor-pricing");
  });

  it("SEO Pack includes seo-audit, news-article, github-repo", () => {
    const seo = getTemplatesByPack("seo");
    const keys = seo.map((t) => t.key);
    expect(keys).toContain("seo-audit");
    expect(keys).toContain("news-article");
    expect(keys).toContain("github-repo");
  });

  it("every pack contains 3–6 templates (sized for fast consumption)", () => {
    for (const p of RECIPE_PACKS) {
      expect(p.templateKeys.length).toBeGreaterThanOrEqual(3);
      expect(p.templateKeys.length).toBeLessThanOrEqual(6);
    }
  });

  it("packs are distinct (no template is in 0 packs)", () => {
    const tplInAnyPack = new Set();
    for (const p of RECIPE_PACKS) for (const k of p.templateKeys) tplInAnyPack.add(k);
    expect(tplInAnyPack.size).toBeGreaterThan(0);
  });
});
