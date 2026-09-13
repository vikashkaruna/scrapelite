// sxoModel.js — Search Experience Optimization (SXO) audit model (Stage 2 / P3A).
//
// PURE. Imported by React components and Netlify functions alike.
//
// ── WHAT SXO IS ────────────────────────────────────────────────────────────
// SXO connects discoverability with post-click visitor experience and conversion
// outcomes: SEO (being found) + UX (being easy to use) + CRO (driving an outcome).
//
// ── THE SIX AUDIT LAYERS AND WEIGHTS (LOCKED — §0.1 / §11.3) ───────────────
// TD: Technical Discoverability             0.20
// IC: Intent-Aligned Content                 0.20
// UX: Fast, Low-Friction Experience          0.20
// IA: Information Architecture First-Screen  0.20
// CD: Conversion Design                      0.15
// MI: Measurement & Iteration                0.05
// Total = 1.00
//
// ── MASTER SCORE FORMULA (§0.1 / §11.3 / D14) ──────────────────────────────
// Master = 0.25 * SEO + 0.20 * AEO + 0.20 * GEO + 0.35 * SXO = 1.00
// Computed at read-time over stored P1 + SXO scores.

import { weightedMean, round1 } from "./scoringModel.js";

export const SXO_MODEL_VERSION = "s1";
export const DEFAULT_WEIGHT_SET_ID = "sxo_default_v1";

export function weightedMeanMap(values = {}, weights = {}) {
  const entries = Object.entries(weights).map(([key, weight]) => ({
    key,
    weight,
    value: values[key] ?? null,
  }));
  const { score, coverage } = weightedMean(entries);
  return {
    score: score !== null ? round1(score) : null,
    coverage: Math.round(coverage * 100),
  };
}

export const SXO_LAYER_WEIGHTS = Object.freeze({
  td: 0.20,
  ic: 0.20,
  ux: 0.20,
  ia: 0.20,
  cd: 0.15,
  mi: 0.05,
});

export const MASTER_FRAMEWORK_WEIGHTS = Object.freeze({
  seo: 0.25,
  aeo: 0.20,
  geo: 0.20,
  sxo: 0.35,
});

export const SXO_LAYERS = Object.freeze({
  td: {
    id: "td",
    code: "TD",
    label: "Technical Discoverability",
    weight: 0.20,
    column: "td_score",
    describes: "Crawl/index eligibility, render parity, AI-bot access, Core Web Vitals, mobile parity, and schema validity.",
    evidence: "Facts and technical signals from raw and rendered page fetch.",
    output: "Technical foundation ensuring crawlers and human visitors encounter no access barriers.",
    reusesFrom: "technical_accessibility",
    components: ["crawl_index_eligibility", "render_parity", "ai_bot_access", "core_web_vitals", "mobile_parity", "schema_validity"],
  },
  ic: {
    id: "ic",
    code: "IC",
    label: "Intent-Aligned Content",
    weight: 0.20,
    column: "ic_score",
    describes: "Alignment between searcher/prompter intent, question headings, answer-first depth, and factual completeness.",
    evidence: "Heading outline, extracted answer blocks, FAQ pairs, and prompt runs.",
    output: "Content that directly and comprehensively answers the query without misleading scent.",
    reusesFrom: "answer_clarity",
    formula: "0.30 * qh + 0.25 * af + 0.20 * pf + 0.15 * ev + 0.10 * ic.cta",
    componentWeights: Object.freeze({
      qh: 0.30,
      af: 0.25,
      pf: 0.20,
      ev: 0.15,
      "ic.cta": 0.10,
    }),
  },
  ux: {
    id: "ux",
    code: "UX",
    label: "Fast, Low-Friction Experience",
    weight: 0.20,
    column: "ux_score",
    describes: "Speed, visual stability, readability, layout responsiveness, and absence of intrusive overlays.",
    evidence: "PageSpeed Core Web Vitals, mobile viewport metrics, text density, and DOM structure.",
    output: "A seamless, effortless browsing experience that minimizes visitor bounce.",
    reusesFrom: "webVitals",
    formula: "0.30 * cwv + 0.20 * mobile + 0.15 * read + 0.15 * nav + 0.10 * overlay + 0.10 * access",
    componentWeights: Object.freeze({
      cwv: 0.30,
      mobile: 0.20,
      read: 0.15,
      nav: 0.15,
      overlay: 0.10,
      access: 0.10,
    }),
  },
  ia: {
    id: "ia",
    code: "IA",
    label: "Information Architecture & First Screen",
    weight: 0.20,
    column: "ia_score",
    describes: "Above-the-fold clarity, value proposition immediacy, primary action visibility, and visual hierarchy.",
    evidence: "DOM order, viewport rendering, hero section elements, and heading structure.",
    output: "Immediate clarity within 3 seconds of landing: what this is, why it matters, and where to go.",
    reusesFrom: "structural_hierarchy",
    formula: "0.25 * o + 0.20 * a + 0.20 * v + 0.20 * p + 0.15 * n",
    componentWeights: Object.freeze({
      o: 0.25,
      a: 0.20,
      v: 0.20,
      p: 0.20,
      n: 0.15,
    }),
  },
  cd: {
    id: "cd",
    code: "CD",
    label: "Conversion Design",
    weight: 0.15,
    column: "cd_score",
    describes: "Outcome pathway clarity, form friction, social proof proximity, pricing clarity, and value exchange.",
    evidence: "Forms, CTA elements, pricing indicators, trust badges, and conversion funnels.",
    output: "High-integrity pathways that turn qualified attention into concrete business outcomes.",
    reusesFrom: "conversion_friction",
    formula: "0.25 * cd.cta + 0.25 * form + 0.20 * proof + 0.15 * price + 0.15 * flow",
    componentWeights: Object.freeze({
      "cd.cta": 0.25,
      form: 0.25,
      proof: 0.20,
      price: 0.15,
      flow: 0.15,
    }),
  },
  mi: {
    id: "mi",
    code: "MI",
    label: "Measurement & Iteration",
    weight: 0.05,
    column: "mi_score",
    describes: "Analytics telemetry, funnel event instrumentation, form diagnostics, and experiment tracking.",
    evidence: "Analytics connections, tracked event taxonomy, and experiment records.",
    output: "Feedback loops ensuring conversion performance can be measured, attributed, and improved.",
    reusesFrom: "analytics",
    formula: "0.30 * event_instrumentation + 0.30 * funnel_tracking + 0.20 * form_analytics + 0.20 * experiment_readiness",
    componentWeights: Object.freeze({
      event_instrumentation: 0.30,
      funnel_tracking: 0.30,
      form_analytics: 0.20,
      experiment_readiness: 0.20,
    }),
  },
});

export const SXO_LAYER_IDS = Object.freeze(Object.keys(SXO_LAYERS));

export function getSxoLayer(id) {
  return SXO_LAYERS[id?.toLowerCase()] || null;
}
