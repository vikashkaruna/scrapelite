// auditProfiles.js — audit profiles and page-type rule packs.
//
// PURE. Shared by the pipeline and the UI.
//
// ── A PROFILE IS A LENS, NOT DIFFERENT MATHS ───────────────────────────────
// This is the most important constraint in the file. Every audit ALWAYS
// computes all four framework views with identical weightings. A profile only
// selects which one leads the report.
//
// ⚠️ `emphasiseForProfile` BELOW IS EXPORTED AND CALLED BY NOTHING. This header
// used to claim a profile also decided "which recommendations are emphasised",
// and it does not: no caller anywhere passes the queue through that function,
// so the ordering a user sees is `rankRecommendations` + `applyDependencies`
// alone, whatever profile they ran under. Wiring it is not a one-liner —
// `applyDependencies` deliberately puts a blocker above the work it blocks, and
// a naive re-sort by pillar would break that ordering — so it belongs with the
// recommendation work in W5, not here. The claim has been removed from the UI
// copy in the meantime rather than left standing.
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

  // ── The four business-model lenses ──────────────────────────────────────
  //
  // The first four profiles name a FRAMEWORK. These four name a BUSINESS, and
  // then pick the framework that business is usually judged by. They exist
  // because "which of SEO, AEO and GEO matters most to me?" is a question a
  // customer cannot answer on their first visit, while "I sell software" is
  // one they can answer instantly.
  //
  // ⚠️ The constraint at the top of this file binds them exactly as hard: all
  // four framework views are still computed with identical weightings, and a
  // page audited as `ecommerce` and as `balanced` produces the same four
  // numbers. Only the headline differs. A profile that re-weighted for a
  // business model would make every trend line meaningless the first time a
  // customer changed their mind about what they sell.
  saas: {
    id: "saas", label: "SaaS", headline: "aeo",
    // Software is bought after a question — "does it do X", "how does it
    // compare to Y" — and those questions are increasingly asked of an answer
    // engine rather than typed into a search box. Extractability leads.
    description: "Leads with answer extraction: docs, comparisons and the questions buyers ask before a trial.",
    emphasise: ["answer_clarity", "entity_authority"],
  },
  services: {
    id: "services", label: "Services", headline: "geo",
    // A service has no SKU and no spec sheet, so an engine recommending one is
    // recommending an ORGANISATION. Who you are is the product.
    description: "Leads with who you are and what you are trusted to do — the identity an engine has to resolve before it recommends a provider.",
    emphasise: ["entity_authority", "answer_clarity"],
  },
  local: {
    id: "local", label: "Local", headline: "geo",
    // Local discovery is an identity-resolution problem before it is a content
    // problem: an engine that cannot decide which of three similarly-named
    // businesses you are will not name any of them.
    description: "Leads with identity and place — the schema, address and profile consistency an engine resolves a business by.",
    emphasise: ["entity_authority", "technical_accessibility"],
  },
  ecommerce: {
    // `ecommerce`, not `e-commerce`. Codes are a public contract (AGENTS.md)
    // and this one travels through a URL query string, a JSON field, a CHECK
    // constraint and a React key. A hyphen survives all four, but only one of
    // them is where it would eventually be typed wrong.
    id: "ecommerce", label: "E-commerce", headline: "seo",
    // Product pages are won on crawl coverage and structured data long before
    // they are won on prose: a product an engine cannot enumerate, price and
    // compare is not in the consideration set at all.
    description: "Leads with crawlability and product structured data — the machine-readable facts a product needs to be comparable.",
    emphasise: ["technical_accessibility", "structural_hierarchy"],
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
  // ── The four templates the BRD names and this pack set was missing ──────
  //
  // ⚠️ NONE OF THEM LISTS `howto_schema_alignment` AS notApplicable, AND THAT
  // IS DELIBERATE. The analyser already returns null / `not_applicable` for
  // that signal when a page carries neither HowTo markup nor procedural
  // content (structureAnalysis.js), so listing it here would only ever bite on
  // a page that DOES have a real procedure — a homepage with a genuine "how it
  // works" section, say — and suppress a true finding rather than an invented
  // one. A pack exists to stop us manufacturing defects, not to stop us
  // reporting them.
  //
  // The consequence worth stating plainly: these packs change which issues are
  // promoted and suppressed, and change NO score. `SCORING_MODEL_VERSION`
  // therefore stays "v1" through this work.
  homepage: {
    id: "homepage", label: "Homepage",
    // The page an engine resolves the ORGANISATION from. If identity is going
    // to be established anywhere on a site, it is here.
    expectSchema: ["Organization", "WebSite"],
    notApplicable: [],
    critical: ["EA-01", "EA-03"],
    // A homepage has no byline and no publication date. Asking for either is
    // the pricing-page HowTo mistake wearing a different hat.
    suppress: ["EA-04", "EA-05", "EA-06"],
  },
  service: {
    id: "service", label: "Service page",
    expectSchema: ["Service", "Organization", "FAQPage"],
    notApplicable: [],
    // A service page that never states what the service IS, in a sentence a
    // machine can lift, cannot be recommended by one.
    critical: ["AC-01", "AC-07", "EA-10"],
    suppress: ["EA-04", "EA-05"],
  },
  location: {
    id: "location", label: "Location page",
    expectSchema: ["LocalBusiness", "PostalAddress", "Organization"],
    notApplicable: [],
    // Identity completeness IS the page's job. A location page without a
    // machine-readable address has failed at the only thing it exists for.
    critical: ["EA-01", "EA-02", "EA-10"],
    suppress: ["EA-04", "EA-05", "EA-06"],
  },
  comparison: {
    id: "comparison", label: "Comparison page",
    expectSchema: ["Article", "ItemList", "Organization"],
    notApplicable: [],
    // AC-08 — comparative content written as prose — is the defining failure
    // of this template, and the one an engine punishes hardest: a comparison
    // it cannot lift as a table is a comparison it will summarise from
    // somebody else's page.
    critical: ["AC-08", "AC-01", "SH-04"],
    // Comparisons make claims about other people's products. A byline and a
    // date are part of standing behind that, so nothing is suppressed here.
    suppress: [],
  },
  // ── Templates 10–12 (§11.10) ───────────────────────────────────────────
  category_listing: {
    id: "category_listing", label: "Category / listing page",
    expectSchema: ["CollectionPage", "ItemList", "Organization"],
    notApplicable: [],
    critical: ["SH-04", "AC-01"],
    suppress: ["EA-04", "EA-05"],
  },
  case_study: {
    id: "case_study", label: "Case study",
    expectSchema: ["Article", "Organization"],
    notApplicable: [],
    critical: ["AC-01", "EA-06", "EA-10"],
    suppress: [],
  },
  landing_page: {
    id: "landing_page", label: "Landing page",
    expectSchema: ["WebPage", "Organization"],
    notApplicable: [],
    critical: ["AC-01", "EA-10"],
    suppress: ["EA-04", "EA-05"],
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
