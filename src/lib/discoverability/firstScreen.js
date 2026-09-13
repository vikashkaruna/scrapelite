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
  "has_visible_h1",
  "has_direct_answer_atf",
  "has_primary_action_atf",
  "viewport_meta_valid",
  "hero_text_substantial",
  "media_overflow_absent",
]);

/**
 * Evaluates the 6 required flags from raw evidence and facts.
 */
export function evaluateFirstScreenFlags(evidence = {}, facts = {}) {
  const headings = evidence.heading_outline || [];
  const technical = facts.technical || {};
  const content = facts.content || {};

  const has_visible_h1 = headings.some((h) => h.level === 1 && (h.text || "").trim().length > 0);
  const has_direct_answer_atf = (evidence.direct_answer_blocks || []).length > 0 || (evidence.faq_pairs || []).length > 0;
  const has_primary_action_atf = Boolean(technical.primary_cta_detected || (content.detected_buttons || []).length > 0);
  const viewport_meta_valid = technical.viewport_meta === true || (technical.meta_tags?.viewport ? true : false) || technical.mobile_friendly === true;
  const hero_text_substantial = (content.hero_word_count ?? (content.word_count > 150 ? 40 : 10)) >= 20;
  const media_overflow_absent = technical.horizontal_scroll_absent !== false;

  return {
    has_visible_h1,
    has_direct_answer_atf,
    has_primary_action_atf,
    viewport_meta_valid,
    hero_text_substantial,
    media_overflow_absent,
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
  const flags = evaluateFirstScreenFlags(evidence, facts);

  const o = scoreOrientation(evidence, facts, flags);
  const a = scoreAnswerImmediacy(evidence, flags);
  const v = scoreValueProp(facts, flags);
  const p = scorePrimaryAction(flags);
  const n = scoreNavigationHierarchy(evidence);

  const rawComponents = { o, a, v, p, n };
  const weights = SXO_LAYERS.ia.componentWeights;
  const { score, coverage } = weightedMeanMap(rawComponents, weights);

  const findings = [];
  if (!flags.has_visible_h1) findings.push("Missing visible H1 above the fold.");
  if (!flags.has_direct_answer_atf) findings.push("No direct answer or primary statement visible above the fold.");
  if (!flags.has_primary_action_atf) findings.push("No clear primary call to action visible above the fold.");
  if (!flags.viewport_meta_valid) findings.push("Invalid or missing viewport meta tag.");
  if (!flags.hero_text_substantial) findings.push("Hero text is sparse or lacking informative context.");
  if (!flags.media_overflow_absent) findings.push("Horizontal overflow detected on mobile viewports.");

  return {
    score,
    coverage,
    flags,
    components: rawComponents,
    findings,
  };
}
