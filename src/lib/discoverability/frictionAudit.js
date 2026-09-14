// frictionAudit.js — Fast, Low-Friction Experience (UX) layer for SXO (Stage 2 / P3A).
//
// PURE. Shared by React and Netlify functions.
//
// Evaluates performance, stability, and interaction friction:
// - 7 UX inputs:
//     cwv: Core Web Vitals (0.30) — reuses fetchWebVitals
//     mobile: Mobile Parity & Viewport (0.20)
//     read: Readability & Content Density (0.15)
//     nav: Navigation Friction & Stability (0.15)
//     overlay: Interstitial / Overlay Obstruction (0.10)
//     access: Accessibility Basics & Legibility (0.10)
//
// 🔴 FAILURE IS ALWAYS `null`, NEVER A ZERO.
// Behavioural or external inputs that could not be gathered drop out cleanly
// so their weights redistribute rather than penalizing an unavailable metric.

import { SXO_LAYERS, weightedMeanMap } from "./sxoModel.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

/**
 * Score Core Web Vitals (cwv, weight 0.30).
 * Reuses results from fetchWebVitals (LCP in sec, INP in ms, CLS unitless).
 */
export function scoreCoreWebVitals(webVitals = null) {
  if (!webVitals) return { score: null, findings: ["Core Web Vitals unmeasured or unavailable."] };
  const { lcp, inp, cls } = webVitals;
  if (lcp === null && inp === null && cls === null) {
    return { score: null, findings: ["Core Web Vitals data absent from CrUX/lab."] };
  }

  // Scores 0-100 for each metric if present
  const scores = [];
  if (Number.isFinite(lcp)) {
    // Good: <= 2.5s, Poor: > 4.0s
    scores.push(lcp <= 2.5 ? 100 : lcp <= 4.0 ? Math.round(100 - ((lcp - 2.5) / 1.5) * 50) : 25);
  }
  if (Number.isFinite(inp)) {
    // Good: <= 200ms, Poor: > 500ms
    scores.push(inp <= 200 ? 100 : inp <= 500 ? Math.round(100 - ((inp - 200) / 300) * 50) : 25);
  }
  if (Number.isFinite(cls)) {
    // Good: <= 0.1, Poor: > 0.25
    scores.push(cls <= 0.1 ? 100 : cls <= 0.25 ? Math.round(100 - ((cls - 0.1) / 0.15) * 50) : 25);
  }

  if (scores.length === 0) return { score: null, findings: [] };
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return {
    score: avg,
    findings: avg < 60 ? ["Sub-optimal Core Web Vitals (LCP/INP/CLS) create post-click friction."] : [],
  };
}

/**
 * Score Mobile Parity & Viewport (mobile, weight 0.20).
 * Assesses mobile viewport responsiveness and content parity.
 */
export function scoreMobileParity(technical = {}) {
  const measured = hasOwn(technical, "viewport_meta") || hasOwn(technical, "mobile_friendly")
    || hasOwn(technical, "mobile_parity_missing") || hasOwn(technical, "horizontal_scroll_absent");
  if (!measured) return { score: null, findings: ["Mobile parity and viewport behavior were not measured."] };
  let score = 70;
  if (technical.viewport_meta || technical.mobile_friendly) score += 20;
  if (technical.mobile_parity_missing) score -= 30;
  if (technical.horizontal_scroll_absent !== false) score += 10;
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    findings: score < 70 ? ["Mobile rendering differences or viewport clipping detected."] : [],
  };
}

/**
 * Score Readability & Content Density (read, weight 0.15).
 * Evaluates sentence length, paragraph sizing, and cognitive density.
 */
export function scoreReadability(content = {}) {
  const words = content.word_count || 0;
  if (words < 100) return { score: null, findings: ["Insufficient text for readability analysis."] };

  const paragraphs = content.paragraphs_count || 5;
  const avgWordsPerParagraph = words / (paragraphs || 1);

  // Ideal web paragraph: 30-70 words. Over 120 is a wall of text.
  let score = 90;
  if (avgWordsPerParagraph > 120) score -= 40;
  else if (avgWordsPerParagraph > 85) score -= 20;

  if (content.avg_sentence_length > 25) score -= 20;

  score = Math.max(20, Math.min(100, score));
  return {
    score,
    findings: score < 60 ? ["Dense paragraphs or long sentence structures impede skimming."] : [],
  };
}

/**
 * Score Navigation Stability & Interaction (nav, weight 0.15).
 */
export function scoreNavigationStability(technical = {}, content = {}) {
  const measured = Number.isFinite(technical.broken_anchors_count)
    || Number.isFinite(content.internal_links_count);
  if (!measured) return { score: null, findings: ["Navigation stability was not measured."] };
  let score = 85;
  if (technical.broken_anchors_count > 0) score -= technical.broken_anchors_count * 15;
  if (content.internal_links_count === 0) score -= 25;
  score = Math.max(20, Math.min(100, score));
  return {
    score,
    findings: score < 70 ? ["Internal navigation gaps or unlinked dead ends."] : [],
  };
}

/**
 * Score Overlay / Interstitial Obstruction (overlay, weight 0.10).
 * Detects whether popups, modal takeovers, or cookie walls block the initial view.
 */
export function scoreOverlayAbsence(technical = {}) {
  const measured = hasOwn(technical, "intrusive_interstitial_detected")
    || hasOwn(technical, "modal_overlay_atf");
  if (!measured) return { score: null, findings: ["Overlay obstruction was not measured."] };
  const hasIntrusiveOverlay = Boolean(technical.intrusive_interstitial_detected || technical.modal_overlay_atf);
  const score = hasIntrusiveOverlay ? 30 : 95;
  return {
    score,
    findings: hasIntrusiveOverlay ? ["Intrusive modal or overlay covers primary content on load."] : [],
  };
}

/**
 * Score Accessibility Basics (access, weight 0.10).
 */
export function scoreAccessibility(technical = {}, content = {}) {
  const measured = Number.isFinite(content.images_without_alt)
    || Number.isFinite(technical.inputs_without_labels);
  if (!measured) return { score: null, findings: ["Accessibility basics were not measured."] };
  let score = 80;
  const missingAlt = content.images_without_alt || 0;
  if (missingAlt > 0) score -= Math.min(30, missingAlt * 5);
  if (technical.inputs_without_labels > 0) score -= 20;
  score = Math.max(20, Math.min(100, score));
  return {
    score,
    findings: score < 70 ? ["Images missing alt text or form controls missing labels."] : [],
  };
}

/**
 * Primary evaluator for Fast, Low-Friction Experience (UX).
 */
export function evaluateFriction(evidence = {}, facts = {}, options = {}) {
  const technical = facts.technical || {};
  const content = facts.content || {};

  const cwv = scoreCoreWebVitals(technical.web_vitals || technical.cwv);
  const mobile = scoreMobileParity(technical);
  const read = scoreReadability(content);
  const nav = scoreNavigationStability(technical, content);
  const overlay = scoreOverlayAbsence(technical);
  const access = scoreAccessibility(technical, content);

  const rawComponents = {
    cwv: cwv.score,
    mobile: mobile.score,
    read: read.score,
    nav: nav.score,
    overlay: overlay.score,
    access: access.score,
  };

  const weights = SXO_LAYERS.ux.componentWeights;
  const { score, coverage } = weightedMeanMap(rawComponents, weights);

  const findings = [
    ...cwv.findings,
    ...mobile.findings,
    ...read.findings,
    ...nav.findings,
    ...overlay.findings,
    ...access.findings,
  ];

  return {
    score,
    coverage,
    components: rawComponents,
    findings,
  };
}
