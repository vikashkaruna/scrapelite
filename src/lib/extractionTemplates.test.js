// src/lib/extractionTemplates.test.js — Q5 (template library) data sanity tests.

import { describe, expect, it } from "vitest";
import {
  EXTRACTION_TEMPLATES,
  TEMPLATE_TAGS,
  getTemplateByKey,
  filterTemplatesByTag,
} from "./extractionTemplates.js";

describe("Q5 — extractionTemplates: data shape", () => {
  it("exports 10-15 templates (Cloud BI target: 10-15 prebuilt extractions)", () => {
    expect(EXTRACTION_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(EXTRACTION_TEMPLATES.length).toBeLessThanOrEqual(15);
  });

  it("every template has the required fields and a valid example URL", () => {
    for (const tpl of EXTRACTION_TEMPLATES) {
      expect(tpl.key).toBeTypeOf("string");
      expect(tpl.title.length).toBeGreaterThan(0);
      expect(tpl.desc.length).toBeGreaterThan(0);
      expect(tpl.exampleUrl).toMatch(/^https?:\/\//);
      expect(["summary", "contacts", "pricing", "custom", "map"]).toContain(tpl.intent);
      expect(Array.isArray(tpl.tags)).toBe(true);
      expect(tpl.tags.length).toBeGreaterThan(0);
    }
  });

  it("every key is unique", () => {
    const keys = EXTRACTION_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("TEMPLATE_TAGS is derived, sorted, and non-empty", () => {
    expect(TEMPLATE_TAGS.length).toBeGreaterThan(0);
    const sorted = [...TEMPLATE_TAGS].sort();
    expect(TEMPLATE_TAGS).toEqual(sorted);
  });

  it("getTemplateByKey returns the matching template or null", () => {
    expect(getTemplateByKey("yc-companies").title).toMatch(/Y Combinator/i);
    expect(getTemplateByKey("nope")).toBeNull();
  });

  it("filterTemplatesByTag('all') returns everything", () => {
    expect(filterTemplatesByTag("all")).toHaveLength(EXTRACTION_TEMPLATES.length);
    expect(filterTemplatesByTag()).toHaveLength(EXTRACTION_TEMPLATES.length);
  });

  it("filterTemplatesByTag returns only templates with that tag", () => {
    const leads = filterTemplatesByTag("leads");
    expect(leads.length).toBeGreaterThan(0);
    for (const tpl of leads) expect(tpl.tags).toContain("leads");
  });

  it("custom-intent templates always carry a non-trivial prompt", () => {
    const customs = EXTRACTION_TEMPLATES.filter((t) => t.intent === "custom");
    expect(customs.length).toBeGreaterThan(0);
    for (const tpl of customs) {
      expect(tpl.prompt).toBeTypeOf("string");
      expect(tpl.prompt.length).toBeGreaterThan(20);
    }
  });
});
