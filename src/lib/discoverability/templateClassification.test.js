import { describe, it, expect } from "vitest";
import {
  TEMPLATE_KEYS,
  classifyPageTemplate,
} from "./templateClassification.js";

describe("templateClassification — 12 audit template classification (Deliverable 4.1)", () => {
  it("covers all 12 primary templates (§5 / §11.10)", () => {
    expect(TEMPLATE_KEYS.length).toBe(12);
    expect(TEMPLATE_KEYS).toEqual([
      "homepage",
      "product",
      "service",
      "location",
      "pricing",
      "article",
      "docs",
      "faq",
      "comparison",
      "category_listing",
      "case_study",
      "landing_page",
    ]);
  });

  it("classifies homepage correctly", () => {
    const res = classifyPageTemplate("https://datiq.app/");
    expect(res.template_key).toBe("homepage");
    expect(res.confidence).toBe(1.0);
  });

  it("classifies pricing, docs, and comparison pages by URL pattern", () => {
    expect(classifyPageTemplate("https://datiq.app/pricing").template_key).toBe("pricing");
    expect(classifyPageTemplate("https://datiq.app/docs/getting-started").template_key).toBe("docs");
    expect(classifyPageTemplate("https://datiq.app/vs/competitor-a").template_key).toBe("comparison");
  });

  it("classifies templates 10–12 correctly", () => {
    expect(classifyPageTemplate("https://datiq.app/category/analytics").template_key).toBe("category_listing");
    expect(classifyPageTemplate("https://datiq.app/case-studies/acme-growth").template_key).toBe("case_study");
    expect(classifyPageTemplate("https://datiq.app/lp/growth-stack").template_key).toBe("landing_page");
  });

  it("uses schema type evidence when path is generic", () => {
    const res = classifyPageTemplate("https://datiq.app/info/general-questions", {
      schemaTypes: ["FAQPage"],
    });
    expect(res.template_key).toBe("faq");
    expect(res.confidence).toBe(0.85);
  });
});
