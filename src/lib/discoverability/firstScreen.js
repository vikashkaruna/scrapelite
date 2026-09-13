// firstScreen.js — Information Architecture & First Screen (IA) layer (Stage 2 / P3A).
//
// PURE. Shared by React and Netlify functions.
//
// Evaluates above-the-fold clarity, immediate value comprehension, and visual hierarchy:
// - 5 IA components:
//     o: Orientation Clarity ATF (0.25)
//     a: Answer Immediacy (0.20)
//     v: Value Proposition Immediacy (0.20)
//     p: Primary Action Prominence (0.20)
//     n: Navigation Scent & Visual Hierarchy (0.15)
//
// ⚠️ The 6 required flags are FINDINGS, not direct score inputs.
// A flag that silently moved the number would double-count its own component.

import { SXO_LAYERS, weightedMeanMap } from "./sxoModel.js";

export const FIRST_SCREEN_FLAGS = Object.freeze([
  "generic_hero_without_category",
  "audience_not_identified",
  "value_or_proof_buried",
  "competing_ctas",
  "intrusive_overlays",
  "no_practical_pricing_path",
]);

/**
 * Evaluates the 6 required flags from raw evidence and facts.
 */
export function evaluateFirstScreenFlags(evidence = {}, facts = {}, options = {}) {
  const headings = evidence.heading_outline || [];
  const technical = facts.technical || {};
  const content = facts.content || {};

  const has_visible_h1 = headings.some((h) => h.level === 1 && (h.text || "").trim().length > 0);
  const has_direct_answer_atf = (evidence.direct_answer_blocks || []).length > 0 || (evidence.faq_pairs || []).length > 0;
  const has_primary_action_atf = Boolean(technical.primary_cta_detected || (content.detected_buttons || []).length > 0);
  const viewport_meta_valid = technical.viewport_meta === true || (technical.meta_tags?.viewport ? true : false) || technical.mobile_friendly === true;
  const hero_text_substantial = (content.hero_word_count ?? (content.word_count > 150 ? 40 : 10)) >= 20;
  const media_overflow_absent = technical.horizontal_scroll_absent !== false;

  const buttons = Array.isArray(content.detected_buttons) ? content.detected_buttons : null;
  const intentClass = options.intentClass || facts.intent_class;
  const highCommercialIntent = intentClass === "commercial_investigation"
    || intentClass === "comparison"
    || intentClass === "transactional";
  return {
    generic_hero_without_category: content.hero_category_identified === false
      || (content.hero_category_identified == null && has_visible_h1 && !facts.entity?.name),
    audience_not_identified: content.audience_identified === false,
    value_or_proof_buried: content.value_proof_atf === false
      || (content.value_proof_atf == null && !has_direct_answer_atf && !hero_text_substantial),
    competing_ctas: buttons ? buttons.length > 3 : null,
    intrusive_overlays: technical.intrusive_interstitial_detected === true || technical.modal_overlay_atf === true,
    no_practical_pricing_path: highCommercialIntent
      ? !(content.price_detected || content.pricing_link_detected || evidence.schema_types?.some((t) => ["Offer", "PriceSpecification"].includes(t)))
      : false,
    _measurements: {
      has_visible_h1,
      has_direct_answer_atf,
      has_primary_action_atf,
      viewport_meta_valid,
      hero_text_substantial,
      media_overflow_absent,
    },
  };
}

/**
 * Score Orientation Clarity ATF (o, weight 0.25).
 * Does the visitor immediately understand what site they are on and what topic is addressed?
 */
export function scoreOrientation(evidence = {}, facts = {}, flags = {}) {
  let score = 50;
  if (flags.has_visible_h1) score += 30;
  if (facts.entity?.name || evidence.schema_types?.includes("Organization")) score += 20;
  return Math.min(100, score);
}

/**
 * Score Answer Immediacy (a, weight 0.20).
 * Can the visitor read a succinct resolution without scrolling?
 */
export function scoreAnswerImmediacy(evidence = {}, flags = {}) {
  if (flags.has_direct_answer_atf) return 95;
  const answers = evidence.direct_answer_blocks || [];
  if (answers.length > 0) return 80;
  return 40;
}

/**
 * Score Value Proposition Immediacy (v, weight 0.20).
 * Is the unique differentiation or summary articulated in the hero section?
 */
export function scoreValueProp(facts = {}, flags = {}) {
  let score = 40;
  if (flags.hero_text_substantial) score += 40;
  if (facts.content?.subheadings_count > 0) score += 20;
  return Math.min(100, score);
}

/**
 * Score Primary Action Prominence (p, weight 0.20).
 * Is there a visible, singular call to action or next step in the viewport?
 */
export function scorePrimaryAction(flags = {}) {
  return flags.has_primary_action_atf ? 90 : 35;
}

/**
 * Score Navigation Scent & Hierarchy (n, weight 0.15).
 * Is there clear hierarchical order (H1 -> H2 -> H3) and navigable orientation?
 */
export function scoreNavigationHierarchy(evidence = {}) {
  const headings = evidence.heading_outline || [];
  if (headings.length === 0) return 30;

  let outOfOrder = false;
  let prevLevel = 1;
  for (const h of headings) {
    if (h.level > prevLevel + 1) {
      outOfOrder = true;
      break;
    }
    prevLevel = h.level;
  }
  return outOfOrder ? 55 : 95;
}

/**
 * Primary evaluator for Information Architecture & First Screen (IA).
 */
export function evaluateFirstScreen(evidence = {}, facts = {}, options = {}) {
  const flags = evaluateFirstScreenFlags(evidence, facts, options);
  const measurements = flags._measurements;

  const o = scoreOrientation(evidence, facts, measurements);
  const a = scoreAnswerImmediacy(evidence, measurements);
  const v = scoreValueProp(facts, measurements);
  const p = scorePrimaryAction(measurements);
  const n = scoreNavigationHierarchy(evidence);

  const rawComponents = { o, a, v, p, n };
  const weights = SXO_LAYERS.ia.componentWeights;
  const { score, coverage } = weightedMeanMap(rawComponents, weights);

  const findings = [];
  if (flags.generic_hero_without_category) findings.push("Generic hero does not identify the category.");
  if (flags.audience_not_identified) findings.push("The first screen does not identify its intended audience.");
  if (flags.value_or_proof_buried) findings.push("Value or proof is buried below the first decision point.");
  if (flags.competing_ctas) findings.push("Competing calls to action weaken the primary path.");
  if (flags.intrusive_overlays) findings.push("An intrusive overlay obstructs the first screen.");
  if (flags.no_practical_pricing_path) findings.push("This high-commercial-intent page has no practical pricing or evaluation path.");

  const publicFlags = Object.fromEntries(FIRST_SCREEN_FLAGS.map((id) => [id, flags[id]]));

  return {
    score,
    coverage,
    flags: publicFlags,
    components: rawComponents,
    findings,
  };
}
