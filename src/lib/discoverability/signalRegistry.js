// signalRegistry.js — the catalogue of every measurable signal in a
// discoverability audit, and the weight each one carries inside its pillar.
//
// PURE. Zero I/O. Imported by BOTH the React app and the Netlify functions
// (same reasoning as src/lib/entitlementModel.js): the scores are the product,
// so a client that renders 78 while the server stored 74 would destroy trust in
// the whole engine. There is exactly one weight table and both sides read it.
//
// ── WHY A REGISTRY AND NOT INLINE CONSTANTS ────────────────────────────────
// Every score has to be explainable down to the signal that produced it — that
// is a stated non-functional requirement, not a nicety. Keeping the code, the
// human label, the pillar, the weight and the "what does 0 vs 100 mean here"
// note in one place means the dashboard, the JSON export, the recommendation
// engine and the docs all describe a signal identically, because they all read
// this file rather than each restating it.
//
// ── SIGNAL CODES ARE A PUBLIC CONTRACT ─────────────────────────────────────
// Codes appear in the JSON audit payload, in webhook bodies and in stored rows.
// Renaming one silently breaks every consumer's saved dashboard and every diff
// against a historical audit. Add new codes; never repurpose an old one.

/** The four pillars, and their share of the composite score. */
export const PILLARS = Object.freeze({
  answer_clarity:           { weight: 0.30, label: "Answer Clarity" },
  entity_authority:         { weight: 0.25, label: "Entity Authority" },
  structural_hierarchy:     { weight: 0.20, label: "Structural Hierarchy" },
  technical_accessibility:  { weight: 0.25, label: "Technical Accessibility" },
});

export const PILLAR_IDS = Object.freeze(Object.keys(PILLARS));

/**
 * Every signal, grouped by pillar. `weight` is the signal's share WITHIN its
 * pillar and each pillar's weights sum to 1.0 (asserted by the test suite, so a
 * future edit that forgets to rebalance fails the build rather than silently
 * re-weighting everybody's scores).
 *
 * `deterministic: true`  — computed from the fetched page by rules alone.
 * `deterministic: false` — needs a model or an external service, so it is the
 *                          signal most likely to come back `unknown`.
 *
 * `nullable: true` marks a signal that is legitimately NOT APPLICABLE to some
 * pages rather than merely unmeasured. A page with no procedural content has no
 * HowTo markup to score, and penalising it for that would tell an author to add
 * fake steps. Both cases are handled the same way by the scorer (the weight is
 * redistributed) but they are reported differently in the UI, because "we could
 * not measure this" and "this does not apply to you" are different sentences.
 */
export const SIGNALS = Object.freeze({
  // ── Answer Clarity ───────────────────────────────────────────────────────
  // How easily a passage can be lifted out of this page and quoted as an
  // answer. This is the pillar AEO guidance cares about most, which is why it
  // carries the largest share of the composite.
  direct_answer_block: {
    pillar: "answer_clarity", weight: 0.30, deterministic: true,
    label: "Direct-answer block",
    measures: "A self-contained resolution placed near the H1 or a question heading, rather than narrative build-up.",
  },
  conciseness: {
    pillar: "answer_clarity", weight: 0.25, deterministic: true,
    label: "Answer conciseness",
    measures: "Primary answer length. Peaks around 40-60 words and soft-fails past 200.",
  },
  passage_independence: {
    pillar: "answer_clarity", weight: 0.20, deterministic: false,
    label: "Passage independence",
    measures: "Whether the answer still makes sense when quoted alone, with no surrounding context.",
  },
  question_headings: {
    pillar: "answer_clarity", weight: 0.15, deterministic: true,
    label: "Question-style headings & FAQ",
    measures: "Headings phrased as the questions people actually ask, with visible answers beneath them.",
  },
  extractable_formatting: {
    pillar: "answer_clarity", weight: 0.10, deterministic: true,
    label: "Scannable formatting",
    measures: "Lists and tables for stepwise or comparative content, which answer engines lift verbatim.",
  },

  // ── Entity Authority ─────────────────────────────────────────────────────
  // Whether the page and the brand behind it are machine-recognisable as a
  // trustworthy entity. This is the pillar GEO guidance weights most heavily.
  schema_identity_completeness: {
    pillar: "entity_authority", weight: 0.25, deterministic: true,
    label: "Schema identity completeness",
    measures: "Presence and property completeness of Organization / Person / Article / Product / WebSite markup.",
  },
  sameas_consistency: {
    pillar: "entity_authority", weight: 0.15, deterministic: true,
    label: "sameAs profile linkage",
    measures: "Links out to the official profiles that let a machine resolve who this entity actually is.",
  },
  author_trust_signals: {
    pillar: "entity_authority", weight: 0.20, deterministic: true,
    label: "Author & organisation trust",
    measures: "A named author, a reachable bio, and visible credentials rather than an anonymous byline.",
  },
  // ── WAVI AND THE FOOTPRINT SPLIT ONE WEIGHT, AND THE REASON IS ARITHMETIC ──
  // WAVI's first two components ARE mention rate and citation rate, so a
  // pillar carrying both signals at full weight would count the same evidence
  // twice and hand answer-engine visibility 45% of entity authority. Splitting
  // the 0.25 the footprint already held leaves the pillar's total exposure to
  // that evidence exactly where v2 had it — so the v3 delta on any page is the
  // richer measurement, not a re-weighting nobody asked for.
  //
  // The footprint keeps the smaller share and stays because it is the signal
  // every stored audit was scored on, and because it still measures something
  // when WAVI cannot be computed at all.
  citation_footprint: {
    pillar: "entity_authority", weight: 0.10, deterministic: false,
    label: "Citation footprint",
    measures: "How often answer engines mention the brand and cite this domain across a sampled prompt set.",
  },
  ai_visibility: {
    pillar: "entity_authority", weight: 0.15, deterministic: false,
    label: "AI visibility (WAVI)",
    measures: "Mention, citation and recommendation rates weighted with answer prominence and accuracy — whether engines name you, source you, and advise choosing you.",
  },
  freshness_and_sources: {
    pillar: "entity_authority", weight: 0.15, deterministic: true,
    label: "Freshness & sourcing",
    measures: "A visible last-updated date and outbound attribution for the claims the page makes.",
  },

  // ── Structural Hierarchy ─────────────────────────────────────────────────
  // How cleanly the page is segmented for retrieval. Retrieval systems chunk on
  // structure, so a malformed heading tree fragments good content into
  // unusable pieces.
  heading_tree_integrity: {
    pillar: "structural_hierarchy", weight: 0.35, deterministic: true,
    label: "Heading tree integrity",
    measures: "A hierarchy with no skipped levels and no empty headings used purely for styling.",
  },
  single_h1: {
    pillar: "structural_hierarchy", weight: 0.15, deterministic: true,
    label: "Single intent-aligned H1",
    measures: "Exactly one H1, and one that states what the page is actually about.",
  },
  faq_schema_alignment: {
    pillar: "structural_hierarchy", weight: 0.25, deterministic: true, nullable: true,
    label: "FAQ structure & schema match",
    measures: "FAQPage markup whose questions and answers match the wording a human sees on the page.",
  },
  howto_schema_alignment: {
    pillar: "structural_hierarchy", weight: 0.15, deterministic: true, nullable: true,
    label: "HowTo structure & schema match",
    measures: "Ordered, visible steps represented as real HowToStep items.",
  },
  breadcrumb_semantics: {
    pillar: "structural_hierarchy", weight: 0.10, deterministic: true,
    label: "Breadcrumb & semantic structure",
    measures: "BreadcrumbList markup and semantic landmarks that place the page within the site.",
  },

  // ── Technical Accessibility ──────────────────────────────────────────────
  // Whether a bot can reach, render and trust the page at all. Everything above
  // is worthless if this pillar fails, which is why its worst failures also
  // appear in the multiplicative penalty layer rather than only here.
  crawl_index_eligibility: {
    pillar: "technical_accessibility", weight: 0.25, deterministic: true,
    label: "Crawl & index eligibility",
    measures: "HTTP status, meta robots, canonical sanity, and whether AI crawlers are permitted.",
  },
  render_completeness: {
    pillar: "technical_accessibility", weight: 0.20, deterministic: true,
    label: "Render completeness",
    measures: "How much of the rendered page survives in the raw HTML a non-rendering crawler receives.",
  },
  core_web_vitals: {
    pillar: "technical_accessibility", weight: 0.30, deterministic: false,
    label: "Core Web Vitals",
    measures: "LCP, INP and CLS against the published good/needs-work/poor thresholds.",
  },
  mobile_parity: {
    pillar: "technical_accessibility", weight: 0.10, deterministic: true,
    label: "Mobile parity",
    measures: "A viewport declaration and the same primary content and markup on small screens.",
  },
  structured_data_validity: {
    pillar: "technical_accessibility", weight: 0.15, deterministic: true,
    label: "Structured data validity",
    measures: "Whether the JSON-LD parses, carries required properties, and describes content that is visible.",
  },
});

export const SIGNAL_CODES = Object.freeze(Object.keys(SIGNALS));

/** Signal codes belonging to one pillar, in declaration order. */
export function signalsForPillar(pillar) {
  return SIGNAL_CODES.filter((code) => SIGNALS[code].pillar === pillar);
}

/** Signals that need a model or an external service, and so may be `unknown`. */
export function nonDeterministicSignals() {
  return SIGNAL_CODES.filter((code) => !SIGNALS[code].deterministic);
}

export function signalLabel(code) {
  return SIGNALS[code]?.label || code;
}

export function pillarLabel(pillar) {
  return PILLARS[pillar]?.label || pillar;
}
