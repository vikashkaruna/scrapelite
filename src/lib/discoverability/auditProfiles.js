// auditProfiles.js — audit profiles and page-type rule packs.
//
// PURE. Shared by the pipeline and the UI.
//
// ── A PROFILE IS A LENS, NOT DIFFERENT MATHS ───────────────────────────────
// This is the most important constraint in the file. Every audit ALWAYS
// computes all four framework views with identical weightings. A profile only
// selects which one leads the report and which recommendations are emphasised.
//
// The alternative — re-weighting the score per profile — would mean the same
// page audited under "seo" and under "geo" produced two different numbers for
// the same framework, and a user who switched profiles between runs would see a
// change in their trend line that no change to their page caused. That destroys
// the validation loop, which is the whole reason to run a second audit.

export const AUDIT_PROFILES = Object.freeze({
  balanced: {
    id: "balanced", label: "Balanced", headline: "overall",
    description: "Weighs classic search, answer extraction and generative citation together.",
    emphasise: [],
  },
  seo: {
    id: "seo", label: "SEO-heavy", headline: "seo",
    description: "Leads with crawlability, rendering, canonicals and Core Web Vitals.",
    emphasise: ["technical_accessibility", "structural_hierarchy"],
  },
  aeo: {
    id: "aeo", label: "AEO-heavy", headline: "aeo",
    description: "Leads with answer-first structure, extractable passages and FAQ markup.",
    emphasise: ["answer_clarity", "structural_hierarchy"],
  },
  geo: {
    id: "geo", label: "GEO-heavy", headline: "geo",
    description: "Leads with entity identity, authorship and citation footprint.",
    emphasise: ["entity_authority", "answer_clarity"],
  },
});

export const PROFILE_IDS = Object.freeze(Object.keys(AUDIT_PROFILES));

/**
 * Attach the profile's lens to a scored result.
 *
 * Adds `headlineScore` / `headlineFramework` and nothing else. The four
 * framework scores are untouched, so an audit run under any profile stays
 * comparable with an audit run under any other.
 */
export function applyProfile(scored, profileId = "balanced") {
  const profile = AUDIT_PROFILES[profileId] || AUDIT_PROFILES.balanced;
  const headline = scored?.frameworks?.[profile.headline];
  return {
    ...scored,
    profile: profile.id,
    headlineFramework: profile.headline,
    headlineScore: headline?.score ?? scored?.finalScore ?? null,
  };
}

/** Sort recommendations so the profile's pillars surface first, ties unchanged. */
export function emphasiseForProfile(recommendations = [], profileId = "balanced") {
  const profile = AUDIT_PROFILES[profileId] || AUDIT_PROFILES.balanced;
  if (profile.emphasise.length === 0) return recommendations;
  const rank = (r) => {
    const idx = profile.emphasise.indexOf(r.pillar);
    return idx === -1 ? profile.emphasise.length : idx;
  };
  return [...recommendations].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return (b.priorityScore || 0) - (a.priorityScore || 0);
  });
}

// ── Page-type rule packs ───────────────────────────────────────────────────
//
// Different templates have genuinely different obligations. A pricing page has
// no procedural content, so telling its author to add HowTo markup produces
// markup describing nothing — the SH-07 defect, manufactured by our own advice.
// An article without an author is a real trust gap; a pricing page without one
// is normal.
//
// Packs adjust EXPECTATIONS, never signal scores. `notApplicable` marks signals
// this template genuinely has no obligation to satisfy — the same treatment an
// unmeasured signal gets, so the weight redistributes rather than the page
// being marked down for a defect it cannot have.

export const PAGE_TYPE_PACKS = Object.freeze({
  article: {
    id: "article", label: "Article",
    expectSchema: ["Article", "Organization", "Person"],
    notApplicable: [],
    critical: ["EA-04", "EA-06", "AC-01"],
    suppress: [],
  },
  faq: {
    id: "faq", label: "FAQ page",
    expectSchema: ["FAQPage", "Organization"],
    notApplicable: ["howto_schema_alignment"],
    critical: ["SH-06", "SH-07", "AC-01"],
    suppress: ["SH-08"],
  },
  howto: {
    id: "howto", label: "How-to / tutorial",
    expectSchema: ["HowTo", "Organization"],
    notApplicable: [],
    critical: ["SH-08", "AC-08"],
    suppress: [],
  },
  pricing: {
    id: "pricing", label: "Pricing page",
    expectSchema: ["Product", "Offer", "Organization"],
    // No procedural content and rarely a byline. Both are normal here.
    notApplicable: ["howto_schema_alignment"],
    critical: ["AC-01", "EA-10"],
    suppress: ["SH-08", "EA-04", "EA-05"],
  },
  product: {
    id: "product", label: "Product page",
    expectSchema: ["Product", "Offer", "Organization"],
    notApplicable: ["howto_schema_alignment"],
    critical: ["EA-10", "AC-01"],
    suppress: ["EA-04", "EA-05"],
  },
  docs: {
    id: "docs", label: "Documentation",
    expectSchema: ["TechArticle", "Organization", "BreadcrumbList"],
    notApplicable: [],
    critical: ["SH-04", "SH-09", "AC-07"],
    // Docs are maintained continuously and rarely carry a personal byline.
    suppress: ["EA-04", "EA-05"],
  },
  page: {
    id: "page", label: "General page",
    expectSchema: ["Organization"],
    notApplicable: [],
    critical: [],
    suppress: [],
  },
  unknown: {
    id: "unknown", label: "Unknown",
    expectSchema: [], notApplicable: [], critical: [], suppress: [],
  },
});

export const PAGE_TYPES = Object.freeze(Object.keys(PAGE_TYPE_PACKS));

export function packFor(pageType) {
  return PAGE_TYPE_PACKS[pageType] || PAGE_TYPE_PACKS.page;
}

/**
 * Apply a page-type pack to a set of issues.
 *
 * Suppressed issues are REMOVED, not merely deprioritised: an audit that keeps
 * telling a pricing page to add an author byline trains its reader to skim past
 * the list, and a queue nobody reads is worth nothing however correct it is.
 * Critical issues for this template are promoted so the pack's own priorities
 * lead.
 */
export function applyPageTypePack(issues = [], pageType = "page") {
  const pack = packFor(pageType);
  return issues
    .filter((i) => !pack.suppress.includes(i.code))
    .map((i) => (pack.critical.includes(i.code) && i.severity !== "critical"
      ? { ...i, severity: "high", promotedByPageType: true }
      : i));
}

/** Signals this template has no obligation to satisfy. */
export function notApplicableSignals(pageType = "page") {
  return [...packFor(pageType).notApplicable];
}
