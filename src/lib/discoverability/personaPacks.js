// personaPacks.js — 7 Discoverability & SXO Persona Action Packs (Stage 4 / P3C).
//
// PURE. Imported by React components and Netlify functions.
//
// ── THE 7 PERSONA PACKS (LOCKED — §5 / §11.11 / §12) ───────────────────────
// 1. seo               (SEO Director / Strategist)
// 2. content           (Content & Editorial Lead)
// 3. ux                (UX & Design Specialist)
// 4. cro               (Conversion Rate Optimizer / Growth Lead)
// 5. product_marketing (Product Marketing Manager)
// 6. agency_client     (Agency Account Lead / Client Strategist)
// 7. local_operator    (Local Business Operator / Franchisee)
//
// ⚠️ STANDING RULE (§11.11):
// "Presentation lens over recommendationModel.js, with §12's widened owner
// vocabulary. NOT SEVEN COPIES OF THE QUEUE."

export const PERSONA_PACKS = Object.freeze({
  seo: {
    id: "seo",
    label: "SEO Director & Technical Lead",
    title: "Technical SEO & Structural Health",
    description: "Prioritizes crawl eligibility, schema validity, site speed, and structural hierarchy.",
    targetOwners: Object.freeze(["seo", "engineering"]),
    targetPillars: Object.freeze(["technical_accessibility", "structural_hierarchy"]),
    targetLayers: Object.freeze(["td"]),
  },
  content: {
    id: "content",
    label: "Content & Editorial Lead",
    title: "Answer Clarity & Editorial Authority",
    description: "Focuses on intent alignment, direct answers, heading outline, and factual depth.",
    targetOwners: Object.freeze(["content", "brand"]),
    targetPillars: Object.freeze(["answer_clarity", "entity_authority"]),
    targetLayers: Object.freeze(["ic"]),
  },
  ux: {
    id: "ux",
    label: "UX & Design Specialist",
    title: "Experience Friction & Visual Hierarchy",
    description: "Addresses Core Web Vitals, mobile viewport parity, layout shift, and readability.",
    targetOwners: Object.freeze(["design", "engineering"]),
    targetPillars: Object.freeze(["technical_accessibility", "structural_hierarchy"]),
    targetLayers: Object.freeze(["ux", "ia"]),
  },
  cro: {
    id: "cro",
    label: "Conversion Rate Optimizer (CRO)",
    title: "Conversion Design & Funnel Friction",
    description: "Streamlines CTA pathways, form friction, social proof placement, and booking flows.",
    targetOwners: Object.freeze(["growth_cro", "analytics"]),
    targetPillars: Object.freeze(["answer_clarity"]),
    targetLayers: Object.freeze(["cd", "mi"]),
  },
  product_marketing: {
    id: "product_marketing",
    label: "Product Marketing Manager",
    title: "Value Proposition & Competitive Differentiation",
    description: "Ensures above-the-fold value proposition clarity, pricing transparency, and proof integrity.",
    targetOwners: Object.freeze(["product_marketing", "product"]),
    targetPillars: Object.freeze(["entity_authority", "answer_clarity"]),
    targetLayers: Object.freeze(["ia", "cd"]),
  },
  agency_client: {
    id: "agency_client",
    label: "Agency Account Lead & Client Strategist",
    title: "Executive Visibility & Cross-Functional Progress",
    description: "Provides high-impact remediation summaries, baseline trends, and validation proofs.",
    targetOwners: Object.freeze(["agency", "brand", "sales"]),
    targetPillars: Object.freeze(["technical_accessibility", "entity_authority", "answer_clarity", "structural_hierarchy"]),
    targetLayers: Object.freeze(["td", "ic", "ux", "ia", "cd", "mi"]),
  },
  local_operator: {
    id: "local_operator",
    label: "Local Business Operator & Multi-Location Lead",
    title: "Local Discoverability & NAP Consistency",
    description: "Focuses on local directory citations, business truth accuracy, and geo-findability.",
    targetOwners: Object.freeze(["local_ops", "customer_success"]),
    targetPillars: Object.freeze(["entity_authority", "technical_accessibility"]),
    targetLayers: Object.freeze(["td", "ic"]),
  },
});

export const PERSONA_PACK_IDS = Object.freeze(Object.keys(PERSONA_PACKS));

/**
 * Filters and orders the canonical recommendation queue for a specific persona.
 *
 * ⚠️ NOT seven copies of the queue — this is a pure lens over the single
 * canonical recommendation list from recommendationModel.js.
 *
 * @param {Array<object>} recommendations - Canonical list of recommendations
 * @param {string} [personaId="seo"] - One of the 7 persona pack IDs
 * @returns {object} { persona, total_recommendations, matched_count, recommendations }
 */
export function filterPersonaQueue(recommendations = [], personaId = "seo") {
  const pack = PERSONA_PACKS[personaId] || PERSONA_PACKS.seo;
  const list = Array.isArray(recommendations) ? recommendations : [];

  const targetOwnersSet = new Set(pack.targetOwners);
  const targetPillarsSet = new Set(pack.targetPillars);

  const matched = [];
  const other = [];

  for (const rec of list) {
    const ownerMatch = Boolean(rec.owner && targetOwnersSet.has(rec.owner));
    const pillarMatch = Boolean((!rec.owner || rec.owner === "unassigned") && rec.pillar && targetPillarsSet.has(rec.pillar));

    if (ownerMatch || pillarMatch) {
      matched.push({
        ...rec,
        persona_relevance: ownerMatch ? "primary" : "secondary",
        matched_persona: pack.id,
      });
    } else {
      other.push(rec);
    }
  }

  return {
    persona: pack,
    total_recommendations: list.length,
    matched_count: matched.length,
    recommendations: matched,
    unmatched_count: other.length,
  };
}
