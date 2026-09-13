// templateClassification.js — Template classification across the 12 audit profiles (Stage 4 / P3C).
//
// PURE. Imported by React components and Netlify functions.
//
// ── THE 12 PRIMARY TEMPLATES (LOCKED — §5 / §11.10) ────────────────────────
// 1. homepage
// 2. product
// 3. service
// 4. location
// 5. pricing
// 6. article
// 7. docs
// 8. faq
// 9. comparison
// 10. category_listing
// 11. case_study
// 12. landing_page

import { PAGE_TYPE_PACKS } from "./auditProfiles.js";

export const TEMPLATE_KEYS = Object.freeze([
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

const URL_PATTERNS = [
  { template: "pricing", patterns: [/\/pricing\b/i, /\/plans\b/i, /\/tiers\b/i, /\/rates\b/i] },
  { template: "docs", patterns: [/\/docs\b/i, /\/documentation\b/i, /\/api-ref\b/i, /\/guides\b/i, /\/reference\b/i] },
  { template: "faq", patterns: [/\/faq\b/i, /\/frequently-asked-questions\b/i, /\/help\b/i, /\/answers\b/i] },
  { template: "comparison", patterns: [/\/vs\b/i, /\/compare\b/i, /\/alternative-to\b/i, /\/comparison\b/i] },
  { template: "location", patterns: [/\/locations?\b/i, /\/stores?\b/i, /\/branches?\b/i, /\/cities\b/i] },
  { template: "case_study", patterns: [/\/case-stud(y|ies)\b/i, /\/customers?\b/i, /\/success-stor(y|ies)\b/i] },
  { template: "category_listing", patterns: [/\/category\b/i, /\/catalog\b/i, /\/shop\b/i, /\/collections\b/i, /\/all\b/i] },
  { template: "landing_page", patterns: [/\/lp\b/i, /\/landing\b/i, /\/join\b/i, /\/try\b/i, /\/start\b/i] },
  { template: "article", patterns: [/\/blog\b/i, /\/news\b/i, /\/articles?\b/i, /\/posts?\b/i, /\/insights\b/i] },
  { template: "product", patterns: [/\/products?\b/i, /\/features?\b/i, /\/item\b/i] },
  { template: "service", patterns: [/\/services?\b/i, /\/offerings?\b/i] },
];

/**
 * Classifies a URL or page evidence into one of the 12 templates.
 *
 * @param {string} url - Target URL
 * @param {object} [evidence={}] - Page evidence containing schema types, headings, etc.
 * @returns {object} { template_key: string, label: string, confidence: number, matched_rule: string }
 */
export function classifyPageTemplate(url = "", evidence = {}) {
  let parsedPath = "/";
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    parsedPath = parsed.pathname;
  } catch {
    parsedPath = String(url || "/");
  }

  // 1. Homepage check (path is '/' or empty)
  if (parsedPath === "/" || parsedPath === "" || parsedPath === "/index.html") {
    return {
      template_key: "homepage",
      label: PAGE_TYPE_PACKS.homepage?.label || "Homepage",
      confidence: 1.0,
      matched_rule: "Root homepage path",
    };
  }

  // 2. Path pattern matching
  for (const entry of URL_PATTERNS) {
    for (const pat of entry.patterns) {
      if (pat.test(parsedPath)) {
        return {
          template_key: entry.template,
          label: PAGE_TYPE_PACKS[entry.template]?.label || entry.template,
          confidence: 0.9,
          matched_rule: `URL path pattern match: ${pat.toString()}`,
        };
      }
    }
  }

  // 3. Schema type inferences from evidence
  const schemaTypes = Array.isArray(evidence?.schemaTypes)
    ? evidence.schemaTypes.map((t) => String(t).toLowerCase())
    : [];

  if (schemaTypes.includes("faqpage")) {
    return {
      template_key: "faq",
      label: PAGE_TYPE_PACKS.faq?.label || "FAQ page",
      confidence: 0.85,
      matched_rule: "Schema.org FAQPage detected",
    };
  }
  if (schemaTypes.includes("product")) {
    return {
      template_key: "product",
      label: PAGE_TYPE_PACKS.product?.label || "Product page",
      confidence: 0.85,
      matched_rule: "Schema.org Product detected",
    };
  }
  if (schemaTypes.includes("article") || schemaTypes.includes("blogposting")) {
    return {
      template_key: "article",
      label: PAGE_TYPE_PACKS.article?.label || "Article",
      confidence: 0.85,
      matched_rule: "Schema.org Article detected",
    };
  }
  if (schemaTypes.includes("localbusiness")) {
    return {
      template_key: "location",
      label: PAGE_TYPE_PACKS.location?.label || "Location page",
      confidence: 0.85,
      matched_rule: "Schema.org LocalBusiness detected",
    };
  }

  // Fallback default: landing_page
  return {
    template_key: "landing_page",
    label: PAGE_TYPE_PACKS.landing_page?.label || "Landing page",
    confidence: 0.5,
    matched_rule: "Default heuristic fallback for interior page",
  };
}
