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

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

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
  const headingsMeasured = Array.isArray(evidence.heading_outline);
  const headings = headingsMeasured ? evidence.heading_outline : [];
  const technical = facts.technical || {};
  const content = facts.content || {};

  const has_visible_h1 = headingsMeasured
    ? headings.some((h) => h.level === 1 && (h.text || "").trim().length > 0)
    : null;
  const answerMeasured = Array.isArray(evidence.direct_answer_blocks) || Array.isArray(evidence.faq_pairs);
  const has_direct_answer_atf = answerMeasured
    ? (evidence.direct_answer_blocks || []).length > 0 || (evidence.faq_pairs || []).length > 0
    : null;
  const actionMeasured = hasOwn(technical, "primary_cta_detected") || Array.isArray(content.detected_buttons);
  const has_primary_action_atf = actionMeasured
    ? Boolean(technical.primary_cta_detected || (content.detected_buttons || []).length > 0)
    : null;
  const viewportMeasured = hasOwn(technical, "viewport_meta")
    || hasOwn(technical, "mobile_friendly") || hasOwn(technical.meta_tags, "viewport");
  const viewport_meta_valid = viewportMeasured
    ? technical.viewport_meta === true || Boolean(technical.meta_tags?.viewport) || technical.mobile_friendly === true
    : null;
  const hero_text_substantial = Number.isFinite(content.hero_word_count)
    ? content.hero_word_count >= 20 : null;
  const media_overflow_absent = hasOwn(technical, "horizontal_scroll_absent")
    ? technical.horizontal_scroll_absent !== false : null;

  const buttons = Array.isArray(content.detected_buttons) ? content.detected_buttons : null;
  const intentClass = options.intentClass || facts.intent_class;
  const highCommercialIntent = intentClass === "commercial_investigation"
    || intentClass === "comparison"
    || intentClass === "transactional";
  return {
    generic_hero_without_category: hasOwn(content, "hero_category_identified")
      ? content.hero_category_identified === false : null,
    audience_not_identified: hasOwn(content, "audience_identified")
      ? content.audience_identified === false : null,
    value_or_proof_buried: hasOwn(content, "value_proof_atf")
      ? content.value_proof_atf === false : null,
    competing_ctas: buttons ? buttons.length > 3 : null,
    intrusive_overlays: hasOwn(technical, "intrusive_interstitial_detected") || hasOwn(technical, "modal_overlay_atf")
      ? technical.intrusive_interstitial_detected === true || technical.modal_overlay_atf === true : null,
    no_practical_pricing_path: highCommercialIntent
      ? (hasOwn(content, "price_detected") || hasOwn(content, "pricing_link_detected") || Array.isArray(evidence.schema_types)
          ? !(content.price_detected || content.pricing_link_detected || evidence.schema_types?.some((t) => ["Offer", "PriceSpecification"].includes(t)))
          : null)
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
  const signals = [];
  if (flags.has_visible_h1 !== null) signals.push(flags.has_visible_h1 ? 100 : 25);
  const entityMeasured = hasOwn(facts.entity, "name") || Array.isArray(evidence.schema_types);
  if (entityMeasured) {
    signals.push(facts.entity?.name || evidence.schema_types?.includes("Organization") ? 100 : 40);
  }
  if (!signals.length) return null;
  return Math.round(signals.reduce((sum, value) => sum + value, 0) / signals.length);
}

/**
 * Score Answer Immediacy (a, weight 0.20).
 * Can the visitor read a succinct resolution without scrolling?
 */
export function scoreAnswerImmediacy(evidence = {}, flags = {}) {
  if (flags.has_direct_answer_atf === null) return null;
  if (flags.has_direct_answer_atf) return 95;
  return 40;
}

/**
 * Score Value Proposition Immediacy (v, weight 0.20).
 * Is the unique differentiation or summary articulated in the hero section?
 */
export function scoreValueProp(facts = {}, flags = {}) {
  const content = facts.content || {};
  const measured = flags.hero_text_substantial !== null
    || hasOwn(content, "value_proof_atf") || Number.isFinite(content.subheadings_count);
  if (!measured) return null;
  let score = 40;
  if (flags.hero_text_substantial || content.value_proof_atf === true) score += 40;
  if (content.subheadings_count > 0) score += 20;
  return Math.min(100, score);
}

/**
 * Score Primary Action Prominence (p, weight 0.20).
 * Is there a visible, singular call to action or next step in the viewport?
 */
export function scorePrimaryAction(flags = {}) {
  if (flags.has_primary_action_atf === null) return null;
  return flags.has_primary_action_atf ? 90 : 35;
}

/**
 * Score Navigation Scent & Hierarchy (n, weight 0.15).
 * Is there clear hierarchical order (H1 -> H2 -> H3) and navigable orientation?
 */
export function scoreNavigationHierarchy(evidence = {}) {
  if (!Array.isArray(evidence.heading_outline)) return null;
  const headings = evidence.heading_outline;
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
  if (o === null) findings.push("First-screen orientation was not measured.");
  if (a === null) findings.push("Answer immediacy was not measured.");
  if (v === null) findings.push("Value proposition immediacy was not measured.");
  if (p === null) findings.push("Primary action prominence was not measured.");
  if (n === null) findings.push("Navigation hierarchy was not measured.");

  const publicFlags = Object.fromEntries(FIRST_SCREEN_FLAGS.map((id) => [id, flags[id]]));

  return {
    score,
    coverage,
    flags: publicFlags,
    components: rawComponents,
    findings,
  };
}
