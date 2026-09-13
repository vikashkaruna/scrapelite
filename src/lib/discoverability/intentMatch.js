// intentMatch.js — Intent-Aligned Content (IC) layer for SXO (Stage 2 / P3A).
//
// PURE. Shared by React and Netlify functions.
//
// Evaluates how effectively the page satisfies searcher/prompter intent:
// - 8 intent classes
// - 5 IC components:
//     qh: Question Headings (0.30)
//     af: Answer-First Content Fit (0.25)
//     pf: Primary Fact Depth (0.20)
//     ev: Evidence and Citations (0.15)
//     ic.cta: Intent-Aligned CTA (0.10)
//
// 🔴 Bridges `promptTaxonomy.js` for intent mappings; does not duplicate prompt stores.

import { SXO_LAYERS, weightedMeanMap } from "./sxoModel.js";
import { PROMPT_KINDS } from "./promptTaxonomy.js";

export const INTENT_CLASSES = Object.freeze([
  "informational",
  "navigational",
  "commercial_investigation",
  "comparison",
  "transactional",
  "local_service",
  "support_troubleshooting",
  "brand_reputation_validation",
]);

export const INTENT_CLASS_DETAILS = Object.freeze({
  informational: {
    id: "informational",
    label: "Informational",
    description: "Searcher seeks to learn, understand a concept, or answer a specific question.",
    suggestedPromptKinds: ["buyer_problem", "category"],
    idealCta: ["learn_more", "download_guide", "newsletter_subscription"],
  },
  navigational: {
    id: "navigational",
    label: "Navigational",
    description: "Searcher seeks a specific site, brand portal, or destination page.",
    suggestedPromptKinds: ["brand"],
    idealCta: ["sign_in", "portal_login", "direct_action"],
  },
  transactional: {
    id: "transactional",
    label: "Transactional",
    description: "Searcher is prepared to complete an exchange: purchase, sign up, or book.",
    suggestedPromptKinds: ["category", "comparison"],
    idealCta: ["buy_now", "free_trial", "saas_signup", "book_appointment"],
  },
  commercial_investigation: {
    id: "commercial_investigation",
    label: "Commercial Investigation",
    description: "Searcher is evaluating options, features, pricing, and vendors prior to deciding.",
    suggestedPromptKinds: ["category", "buyer_problem", "comparison"],
    idealCta: ["demo_request", "quote_request", "see_pricing"],
  },
  comparison: {
    id: "comparison",
    label: "Comparison",
    description: "Searcher is comparing two or more named alternatives or seeking versus analysis.",
    suggestedPromptKinds: ["comparison"],
    idealCta: ["comparison_guide", "feature_matrix", "trial"],
  },
  local_service: {
    id: "local_service",
    label: "Local Service",
    description: "Searcher seeks a physical venue, service radius, or local provider nearby.",
    suggestedPromptKinds: ["local"],
    idealCta: ["call", "get_directions", "booking", "whatsapp_chat"],
  },
  support_troubleshooting: {
    id: "support_troubleshooting",
    label: "Support & Troubleshooting",
    description: "Searcher has an issue, error, or operational task requiring step-by-step guidance.",
    suggestedPromptKinds: ["buyer_problem"],
    idealCta: ["support_deflection", "documentation", "contact_support"],
  },
  brand_reputation_validation: {
    id: "brand_reputation_validation",
    label: "Brand Reputation Validation",
    description: "Searcher is validating a brand's legitimacy, reputation, proof, and trustworthiness.",
    suggestedPromptKinds: ["trust"],
    idealCta: ["contact", "case_study", "reviews", "security_overview"],
  },
});

const QUESTION_REGEX = /^(what|how|why|who|when|where|can|which|is|does|are|should|will)\b|\?$/i;

/**
 * Evaluates Question Headings (qh, weight 0.30).
 * Checks if headings are phrased as searcher queries and natural questions.
 */
export function scoreQuestionHeadings(outline = []) {
  if (!outline || outline.length === 0) return { score: null, findings: ["No heading outline detected."] };
  const questions = outline.filter((h) => QUESTION_REGEX.test(h.text?.trim() || ""));
  const ratio = questions.length / outline.length;
  // A healthy FAQ or informational page typically has 20-50% question headings.
  const score = Math.min(100, Math.round(ratio * 250));
  return {
    score,
    count: questions.length,
    total: outline.length,
    ratio,
    findings: ratio < 0.15 ? ["Few or no headings phrased as natural questions."] : [],
  };
}

/**
 * Evaluates Answer-First Content (af, weight 0.25).
 * Looks for direct answer blocks and immediate answers under headings.
 */
export function scoreAnswerFirst(evidence = {}) {
  const answers = evidence.direct_answer_blocks || [];
  const faqs = evidence.faq_pairs || [];
  if (answers.length === 0 && faqs.length === 0) {
    return { score: 35, count: 0, findings: ["No extractable direct answer blocks or FAQ pairs found ATF."] };
  }
  const count = answers.length + faqs.length;
  const score = Math.min(100, 45 + count * 15);
  return {
    score,
    count,
    findings: count < 2 ? ["Only a single answer block detected; expand structured answer coverage."] : [],
  };
}

/**
 * Evaluates Primary Fact Depth (pf, weight 0.20).
 * Assesses data points, structured specs, metrics, and quantitative facts.
 */
export function scorePrimaryFacts(facts = {}) {
  const content = facts.content || {};
  const wordCount = content.word_count || 0;
  if (wordCount < 100) return { score: null, findings: ["Insufficient content length to measure factual depth."] };
  const numbersCount = (content.numbers_count ?? (content.sample_text ? (content.sample_text.match(/\b\d+(\.\d+)?%?\b/g) || []).length : 5));
  const listsCount = content.lists_count ?? 1;
  const rawScore = Math.min(100, Math.round((numbersCount * 4) + (listsCount * 12) + (wordCount > 600 ? 30 : 15)));
  return { score: rawScore, findings: rawScore < 50 ? ["Low density of quantitative facts, statistics, or structured bullet specifications."] : [] };
}

/**
 * Evaluates Evidence & Citations (ev, weight 0.15).
 * Assesses verified external citations, outbound authoritative sources, and attribution.
 */
export function scoreEvidenceCitations(evidence = {}, facts = {}) {
  const technical = facts.technical || {};
  const outboundLinks = technical.outbound_links_count ?? (evidence.citations?.length || 0);
  const schemaTypes = evidence.schema_types || [];
  const hasProofSchema = schemaTypes.some((t) => ["Organization", "Person", "Review", "Rating"].includes(t));
  const score = Math.min(100, (outboundLinks > 0 ? 40 : 10) + (hasProofSchema ? 45 : 15) + (outboundLinks > 3 ? 15 : 0));
  return { score, findings: score < 50 ? ["Page lacks external proof citations or structured author/organization backing."] : [] };
}

/**
 * Evaluates Intent-Aligned Call to Action (ic.cta, weight 0.10).
 * Checks whether page actions harmonize with the search intent class.
 */
export function scoreIntentCta(evidence = {}, intentClass = "informational") {
  const intentMeta = INTENT_CLASS_DETAILS[intentClass] || INTENT_CLASS_DETAILS.informational;
  const actions = evidence.detected_actions || [];
  if (actions.length === 0) {
    return { score: null, findings: ["Call-to-action evidence was not measured."] };
  }
  const matches = actions.some((act) => intentMeta.idealCta.some((ideal) => (act.type || act.label || "").toLowerCase().includes(ideal.replace("_", " "))));
  return {
    score: matches ? 95 : 45,
    findings: matches ? [] : [`Call to action does not align with search intent '${intentClass}'.`],
  };
}

/**
 * Primary evaluator for the Intent-Aligned Content (IC) layer.
 */
export function evaluateIntentMatch(evidence = {}, facts = {}, { intentClass = "informational" } = {}) {
  const qh = scoreQuestionHeadings(evidence.heading_outline);
  const af = scoreAnswerFirst(evidence);
  const pf = scorePrimaryFacts(facts);
  const ev = scoreEvidenceCitations(evidence, facts);
  const icCta = scoreIntentCta(evidence, intentClass);

  const rawComponents = {
    qh: qh.score,
    af: af.score,
    pf: pf.score,
    ev: ev.score,
    "ic.cta": icCta.score,
  };

  const weights = SXO_LAYERS.ic.componentWeights;
  const { score, coverage } = weightedMeanMap(rawComponents, weights);

  const findings = [
    ...qh.findings,
    ...af.findings,
    ...pf.findings,
    ...ev.findings,
    ...icCta.findings,
  ];

  return {
    score,
    coverage,
    intentClass,
    components: rawComponents,
    findings,
  };
}
