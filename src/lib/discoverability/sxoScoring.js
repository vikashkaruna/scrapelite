// sxoScoring.js — SXO Scoring engine & Read-time Master Composite (Stage 2 / P3A).
//
// PURE. Shared by React and Netlify functions.
//
// ── SXO SCORING ENGINE ─────────────────────────────────────────────────────
// 1. Evaluates all 6 layers (TD, IC, UX, IA, CD, MI).
// 2. TD wires directly to the Technical Accessibility pillar (zero duplicated calls).
// 3. Components that cannot be measured are NULL (never zero).
// 4. Stamped with SXO_MODEL_VERSION ("s1") and weight_set_id ("sxo_default_v1").
//
// ── READ-TIME MASTER COMPOSITE (D14) ───────────────────────────────────────
// Master = 0.25 * SEO + 0.20 * AEO + 0.20 * GEO + 0.35 * SXO
// Computed at read-time across P1 framework scores and the SXO score.

import {
  SXO_MODEL_VERSION,
  DEFAULT_WEIGHT_SET_ID,
  SXO_LAYER_WEIGHTS,
  MASTER_FRAMEWORK_WEIGHTS,
  SXO_LAYERS,
  weightedMeanMap,
} from "./sxoModel.js";
import { evaluateIntentMatch } from "./intentMatch.js";
import { evaluateFirstScreen } from "./firstScreen.js";
import { evaluateFriction } from "./frictionAudit.js";
import { evaluateConversionDesign } from "./conversionDesign.js";
import { evaluateMeasurementMaturity } from "./measurementMaturity.js";

export { evaluateMeasurementMaturity };
export const evaluateMeasurementIteration = evaluateMeasurementMaturity;

/**
 * Evaluates all 6 SXO layers for a given audit result.
 *
 * @param {object} auditData - The completed audit data containing pillars, evidence, facts
 * @param {object} [options] - Optional overrides (intentClass, primaryOutcome, weightSetId)
 * @returns {object} SXO evaluation result with layer scores, components, findings, and total score
 */
export function evaluateSxo(auditData = {}, options = {}) {
  const pillars = auditData.pillars || {};
  const evidence = auditData.evidence || auditData.result?.evidence_json || {};
  const facts = auditData.facts || auditData.result?.facts_json || {};
  const analytics = auditData.analytics || null;

  // 1. TD: Technical Discoverability (weight 0.20)
  // Reuses the Technical Accessibility pillar wholesale. A test asserts TD === T pillar.
  const technicalPillar = pillars.technical_accessibility || {};
  const tdScore = technicalPillar.score ?? auditData.technicalScore ?? null;
  const tdCoverage = technicalPillar.coverage ?? (tdScore !== null ? 100 : 0);

  // 2. IC: Intent-Aligned Content (weight 0.20)
  const ic = evaluateIntentMatch(evidence, facts, {
    intentClass: options.intentClass || auditData.intentClass || "informational",
  });

  // 3. UX: Fast, Low-Friction Experience (weight 0.20)
  const ux = evaluateFriction(evidence, facts, options);

  // 4. IA: Information Architecture & First Screen (weight 0.20)
  const ia = evaluateFirstScreen(evidence, facts, options);

  // 5. CD: Conversion Design (weight 0.15)
  const cd = evaluateConversionDesign(evidence, facts, {
    primaryOutcome: options.primaryOutcome || auditData.primaryOutcome || "lead_capture",
  });

  // 6. MI: Measurement & Iteration (weight 0.05)
  const mi = evaluateMeasurementIteration(analytics);

  const layerScores = {
    td: tdScore,
    ic: ic.score,
    ux: ux.score,
    ia: ia.score,
    cd: cd.score,
    mi: mi.score,
  };

  const { score: totalScore, coverage } = weightedMeanMap(layerScores, SXO_LAYER_WEIGHTS);

  const layerResults = {
    td: { score: tdScore, coverage: tdCoverage, components: technicalPillar.signals || {}, findings: [] },
    ic,
    ux,
    ia,
    cd,
    mi,
  };

  const allFindings = [
    ...(ic.findings || []).map((f) => (typeof f === "string" ? { message: f, layer: "ic" } : { ...f, layer: "ic" })),
    ...(ux.findings || []).map((f) => (typeof f === "string" ? { message: f, layer: "ux" } : { ...f, layer: "ux" })),
    ...(ia.findings || []).map((f) => (typeof f === "string" ? { message: f, layer: "ia" } : { ...f, layer: "ia" })),
    ...(cd.findings || []).map((f) => (typeof f === "string" ? { message: f, layer: "cd" } : { ...f, layer: "cd" })),
    ...(mi.findings || []).map((f) => (typeof f === "string" ? { message: f, layer: "mi" } : { ...f, layer: "mi" })),
  ];

  return {
    score: totalScore,
    coverage,
    layerScores,
    layerResults,
    findings: allFindings,
    modelVersion: SXO_MODEL_VERSION,
    weightSetId: options.weightSetId || DEFAULT_WEIGHT_SET_ID,
  };
}

/**
 * Computes the Master Composite Score across the 4 frameworks: SEO, AEO, GEO, SXO.
 * Gated by D14: computed at read time across stored audit scores.
 *
 * Formula: 0.25 * SEO + 0.20 * AEO + 0.20 * GEO + 0.35 * SXO
 *
 * @param {object} frameworks - { seo, aeo, geo, sxo } scores (each 0-100 or null)
 * @returns {object} { score: number | null, coverage: number }
 */
export function computeMasterScore(frameworks = {}) {
  const rawScores = {
    seo: frameworks.seo ?? null,
    aeo: frameworks.aeo ?? null,
    geo: frameworks.geo ?? null,
    sxo: frameworks.sxo ?? null,
  };

  const { score, coverage } = weightedMeanMap(rawScores, MASTER_FRAMEWORK_WEIGHTS);

  return {
    score,
    coverage,
    frameworks: rawScores,
    weights: MASTER_FRAMEWORK_WEIGHTS,
    overlap_disclosure:
      "Master score weights include: SEO 0.25, AEO 0.20, GEO 0.20, SXO 0.35. Technical accessibility signals (including Core Web Vitals and mobile parity) are evaluated across both technical SEO foundation and SXO experience friction layers as specified in §11.3.",
  };
}
