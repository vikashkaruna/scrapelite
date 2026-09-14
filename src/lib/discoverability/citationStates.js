// citationStates.js — what actually happened when an engine answered.
//
// PURE. Shared by React and `netlify/`.
//
// A prompt run has carried two booleans since the module shipped:
// `mention_detected` and `citation_detected`. Four combinations, and three of
// them say almost nothing. The PRD names seven states, and the difference
// between them is the difference between "we are invisible" and "we are visible
// and losing", which are not the same problem and do not have the same fix.
//
// ── THE STATES ARE ORDERED, AND THE ORDER IS A JUDGEMENT ───────────────────
// A single answer can satisfy several descriptions at once: cited, and also
// recommending a competitor, and also getting a fact wrong. Precedence decides
// which one the operator is told about, so it is ranked by what most changes
// what they should do next — not by severity, and not by how good it feels.
//
// `misrepresented` outranks everything because a confident wrong statement
// about you propagates further than an absence does, and it is the only state
// whose fix is "correct the record" rather than "publish more".

/**
 * The seven states, in PRECEDENCE order — first match wins.
 *
 * `rank` is the ordering used for comparison and aggregation; it is NOT a
 * score. Two states one rank apart are not one unit better than each other,
 * and averaging ranks across prompts would produce a number with no meaning.
 */
export const CITATION_STATES = Object.freeze({
  misrepresented: {
    id: "misrepresented", rank: 0, present: true, favourable: false,
    label: "Incorrectly represented",
    describes: "The engine named the brand and stated something about it that contradicts the page.",
    fix: "Correct the record at source — a confident wrong claim travels further than an absence.",
  },
  cited_and_recommended: {
    id: "cited_and_recommended", rank: 1, present: true, favourable: true,
    label: "Cited and recommended",
    describes: "Named as a recommendation, with this domain given as a source.",
    fix: "Nothing. This is the outcome the rest of the work is for.",
  },
  recommended: {
    id: "recommended", rank: 2, present: true, favourable: true,
    label: "Recommended",
    describes: "Named as a recommendation, but the answer sourced somebody else.",
    fix: "The advocacy is there and the sourcing is not — make the claim verifiable on your own page.",
  },
  cited: {
    id: "cited", rank: 3, present: true, favourable: true,
    label: "Cited",
    describes: "The domain was given as a source, without the brand being recommended.",
    fix: "You are useful enough to quote and not yet the answer. Strengthen the commercial pages.",
  },
  mentioned: {
    id: "mentioned", rank: 4, present: true, favourable: true,
    label: "Mentioned",
    describes: "Named in passing, neither sourced nor recommended.",
    fix: "Recall exists. Give the engine something worth citing.",
  },
  competitor_dominated: {
    id: "competitor_dominated", rank: 5, present: false, favourable: false,
    label: "Competitor dominated",
    describes: "The brand was absent and one or more competitors were cited or recommended.",
    fix: "The question is being answered, just not by you. Read who won it and why.",
  },
  absent: {
    id: "absent", rank: 6, present: false, favourable: false,
    label: "Absent",
    describes: "Neither the brand nor a tracked competitor appeared.",
    fix: "Nobody owns this question yet, which makes it the cheapest one to win.",
  },
});

export const CITATION_STATE_IDS = Object.freeze(
  Object.keys(CITATION_STATES).sort((a, b) => CITATION_STATES[a].rank - CITATION_STATES[b].rank),
);

/** Lookup that returns null rather than throwing. */
export function citationState(id) {
  return CITATION_STATES[id] || null;
}

/** States where the brand appeared at all. Drives MentionRate. */
export const PRESENT_STATE_IDS = Object.freeze(
  CITATION_STATE_IDS.filter((id) => CITATION_STATES[id].present),
);

/** States that count as advocacy. Drives RecommendationRate. */
export const RECOMMENDED_STATE_IDS = Object.freeze(["cited_and_recommended", "recommended"]);

/** States where this domain was given as a source. Drives CitationRate. */
export const CITED_STATE_IDS = Object.freeze(["cited_and_recommended", "cited"]);

// ── Recommendation detection ───────────────────────────────────────────────

/**
 * Language that marks a naming as advocacy rather than description.
 *
 * ⚠️ ONLY MEANINGFUL ON A COMMERCIAL PROMPT. "DatIQ is the best tool for X" in
 * answer to "what is DatIQ" is the engine describing a product's own claim, not
 * recommending it. The caller supplies `commercial`, which comes from the
 * prompt's declared kind — see promptTaxonomy.js.
 */
const ADVOCACY = /\b(recommend(?:ed|s)?|best (?:choice|option|tool|fit)|top (?:choice|pick)|should (?:use|consider|try)|ideal for|go with|worth considering|strong(?:est)? (?:choice|option))\b/i;

/**
 * Was the brand named as a recommendation, rather than merely named?
 *
 * Looks at the sentences that NAME the brand, not the whole answer. An answer
 * that recommends a competitor in its first line and mentions us in its last
 * would otherwise read as advocacy for us.
 */
export function readsAsRecommendation(text, brand, { commercial = false } = {}) {
  if (!commercial || !text || !brand) return false;
  const escaped = String(brand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re;
  try { re = new RegExp(`\\b${escaped}\\b`, "i"); } catch { return false; }
  const sentences = String(text).split(/(?<=[.!?])\s+/).filter((s) => re.test(s));
  return sentences.some((s) => ADVOCACY.test(s));
}

// ── Accuracy ───────────────────────────────────────────────────────────────

/** Prices, as written by humans: $49, $14.40, €1,299, ₹999. */
const PRICE_RE = /(?:[$€£₹])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/g;

/** Every distinct price in a string, as numbers. */
export function pricesIn(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(PRICE_RE)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out];
}

/**
 * Did the engine state a price for this brand that the page contradicts?
 *
 * ⚠️ NARROW ON PURPOSE, AND THE NARROWNESS IS THE POINT.
 * P2's Canonical Business Truth Record (W9) is what makes general accuracy
 * checkable; it does not exist. Until it does, the only claims we can test are
 * ones the audited page itself states, and price is the one that is both
 * unambiguous and expensive to get wrong — a reader told the wrong number
 * either overpays in their head and leaves, or arrives expecting a discount.
 *
 * 🔴 IT FIRES ONLY WHEN THE PAGE STATES PRICES AT ALL. A page with no prices
 * cannot contradict anything, and treating "we could not check" as "they got it
 * right" would be as wrong as the reverse — both invent a finding. The caller
 * receives `null` for unknown and must not read it as `false`.
 *
 * Tolerance is deliberate: an engine saying "around $50" against a $49 page is
 * correct in every sense a reader cares about, and flagging it would train
 * operators to ignore the signal that matters.
 */
export const PRICE_TOLERANCE = 0.15;

export function contradictsPrice(answerText, brand, pageText) {
  const pagePrices = pricesIn(pageText);
  if (!pagePrices.length) return null;                 // nothing to check against

  const escaped = String(brand || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return null;
  let re;
  try { re = new RegExp(`\\b${escaped}\\b`, "i"); } catch { return null; }

  // Only sentences that NAME the brand. A price quoted for a competitor in the
  // same answer is not a claim about us, and flagging it would make every
  // comparison answer look like a misrepresentation.
  const claims = String(answerText || "")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => re.test(sentence))
    .flatMap(pricesIn);
  if (!claims.length) return null;                     // it named no price for us

  return claims.some((claimed) =>
    !pagePrices.some((actual) => Math.abs(claimed - actual) <= actual * PRICE_TOLERANCE));
}

// ── Classification ─────────────────────────────────────────────────────────

/**
 * Which of the seven states this answer represents.
 *
 * Everything passed in is already MEASURED — the caller matched the brand, read
 * the citation list and ran the competitor pass. This function only decides
 * which measurement the operator is shown, so it stays pure and total: any
 * combination of inputs, including none, resolves to exactly one state.
 */
export function classifyCitation({
  mentioned = false,
  cited = false,
  commercial = false,
  recommended = false,
  misrepresented = false,
  competitorsPresent = 0,
} = {}) {
  // Only a naming can be a misrepresentation. An engine that never mentioned
  // the brand has said nothing false about it, whatever else it got wrong.
  if (mentioned && misrepresented) return "misrepresented";

  const advocacy = Boolean(commercial && recommended);
  if (advocacy && cited) return "cited_and_recommended";
  if (advocacy) return "recommended";
  if (cited) return "cited";
  if (mentioned) return "mentioned";
  if (competitorsPresent > 0) return "competitor_dominated";
  return "absent";
}

/**
 * Roll a set of classified runs into the PRD's rates.
 *
 * ⚠️ RecommendationRate has its OWN denominator, and that is the whole point.
 * It is measured over commercial prompts only, because "what is DatIQ" cannot
 * produce a recommendation and including it would dilute the rate with
 * questions that were never a contest. A run set with no commercial prompt
 * returns `null` — unmeasured, never zero, exactly as `unknown` is handled
 * everywhere else in this module.
 */
export function aggregateStates(runs = []) {
  const answered = (Array.isArray(runs) ? runs : []).filter((r) => r && !r.error && r.state);
  const total = answered.length;
  if (!total) {
    return {
      total: 0, commercialTotal: 0, counts: {},
      mentionRate: null, citationRate: null, recommendationRate: null,
    };
  }

  const counts = Object.fromEntries(CITATION_STATE_IDS.map((id) => [id, 0]));
  for (const r of answered) if (counts[r.state] !== undefined) counts[r.state] += 1;

  const commercial = answered.filter((r) => r.commercial);
  const recommended = commercial.filter((r) => RECOMMENDED_STATE_IDS.includes(r.state)).length;

  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

  return {
    total,
    commercialTotal: commercial.length,
    counts,
    mentionRate: pct(answered.filter((r) => PRESENT_STATE_IDS.includes(r.state)).length, total),
    citationRate: pct(answered.filter((r) => CITED_STATE_IDS.includes(r.state)).length, total),
    recommendationRate: pct(recommended, commercial.length),
  };
}
