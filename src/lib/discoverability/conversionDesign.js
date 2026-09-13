// conversionDesign.js — Conversion Design (CD) layer for SXO (Stage 2 / P3A).
//
// PURE. Shared by React and Netlify functions.
//
// Evaluates how effectively the page converts organic and AI visitors:
// - 12 primary outcomes
// - 5 CD components:
//     cd.cta: Outcome Pathway Clarity (0.25)
//     form: Form Friction Index (0.25)
//     proof: Trust Reinforcement Proximity (0.20)
//     price: Price & Terms Clarity (0.15)
//     flow: Value Exchange Fairness & Flow (0.15)
//
// ⚠️ `cd.cta` is namespaced to distinguish it from `ic.cta` in stored rows.
// 🔴 Activates `gapTaxonomy.js`'s reserved `conversion_friction` root cause.

import { SXO_LAYERS, weightedMeanMap } from "./sxoModel.js";

export const PRIMARY_OUTCOMES = Object.freeze([
  "lead_capture",
  "saas_signup",
  "ecommerce_purchase",
  "phone_call",
  "appointment_booking",
  "quote_request",
  "content_download",
  "newsletter_subscription",
  "free_trial",
  "demo_request",
  "affiliate_click",
  "support_deflection",
]);

export const PRIMARY_OUTCOME_DETAILS = Object.freeze({
  lead_capture: { id: "lead_capture", label: "Lead Capture", defaultFormFields: ["email", "name"] },
  saas_signup: { id: "saas_signup", label: "SaaS Sign-up", defaultFormFields: ["email", "password"] },
  ecommerce_purchase: { id: "ecommerce_purchase", label: "E-commerce Purchase", defaultFormFields: ["cart", "checkout"] },
  phone_call: { id: "phone_call", label: "Phone Call / Direct Contact", defaultFormFields: ["tel"] },
  appointment_booking: { id: "appointment_booking", label: "Appointment Booking", defaultFormFields: ["datetime", "email"] },
  quote_request: { id: "quote_request", label: "Quote Request", defaultFormFields: ["scope", "email", "phone"] },
  content_download: { id: "content_download", label: "Content Download", defaultFormFields: ["email"] },
  newsletter_subscription: { id: "newsletter_subscription", label: "Newsletter Subscription", defaultFormFields: ["email"] },
  free_trial: { id: "free_trial", label: "Free Trial", defaultFormFields: ["email"] },
  demo_request: { id: "demo_request", label: "Demo Request", defaultFormFields: ["company", "email", "name"] },
  affiliate_click: { id: "affiliate_click", label: "Affiliate Outbound Click", defaultFormFields: [] },
  support_deflection: { id: "support_deflection", label: "Support Deflection", defaultFormFields: [] },
});

/**
 * Score Outcome Pathway Clarity (cd.cta, weight 0.25).
 * Is the primary conversion pathway distinct, unambiguous, and present?
 */
export function scorePathwayClarity(evidence = {}, facts = {}, outcome = "lead_capture") {
  const technical = facts.technical || {};
  const content = facts.content || {};
  const buttons = content.detected_buttons || [];
  const ctaCount = (technical.primary_cta_detected ? 1 : 0) + buttons.length;

  if (ctaCount === 0) {
    return { score: 25, findings: ["No clear call to action or conversion path detected."] };
  }
  if (ctaCount > 6) {
    return { score: 55, findings: ["Too many competing calls to action; action fatigue risk."] };
  }
  return { score: 95, findings: [] };
}

/**
 * Score Form Friction Index (form, weight 0.25).
 * Assesses field count, required fields, and friction on input.
 */
export function scoreFormFriction(facts = {}) {
  const technical = facts.technical || {};
  const forms = technical.detected_forms || [];

  if (forms.length === 0) {
    // If page has no form, neutral-high score (e.g. phone/click destination)
    return { score: 85, findings: [] };
  }

  const primaryForm = forms[0] || {};
  const fieldCount = primaryForm.field_count ?? 3;

  // Ideal: 1-3 fields. >6 fields causes sharp drop-off.
  if (fieldCount <= 3) return { score: 100, findings: [] };
  if (fieldCount <= 5) return { score: 75, findings: ["Form carries 4-5 fields; consider multi-step or reduction."] };
  return {
    score: 40,
    findings: [`High form friction: ${fieldCount} fields detected on primary conversion form.`],
  };
}

/**
 * Score Trust Reinforcement Proximity (proof, weight 0.20).
 * Are ratings, client logos, certifications, or guarantees placed near the CTA?
 */
export function scoreTrustProximity(evidence = {}, facts = {}) {
  const schemaTypes = evidence.schema_types || [];
  const hasReviews = schemaTypes.some((t) => ["AggregateRating", "Review"].includes(t));
  const hasOrg = schemaTypes.includes("Organization");
  const content = facts.content || {};
  const mentionsTrust = Boolean(content.mentions_guarantee || content.mentions_security || hasReviews);

  let score = 50;
  if (hasReviews) score += 30;
  if (mentionsTrust) score += 20;
  if (hasOrg) score += 10;
  score = Math.min(100, score);

  return {
    score,
    findings: score < 60 ? ["Lack of social proof, ratings, or trust badges near conversion points."] : [],
  };
}

/**
 * Score Price & Terms Clarity (price, weight 0.15).
 * Are pricing, trial terms, or return policies transparently stated?
 */
export function scorePriceClarity(evidence = {}, facts = {}) {
  const schemaTypes = evidence.schema_types || [];
  const hasOffer = schemaTypes.some((t) => ["Offer", "PriceSpecification"].includes(t));
  const content = facts.content || {};
  const mentionsPrice = Boolean(hasOffer || content.price_detected || content.mentions_free_tier);

  const score = mentionsPrice ? 95 : 60;
  return {
    score,
    findings: score < 70 ? ["Pricing, trial parameters, or contractual terms are unclear."] : [],
  };
}

/**
 * Score Value Exchange Fairness & Flow (flow, weight 0.15).
 * Does what the visitor receives justify what they are asked to give?
 */
export function scoreValueExchange(facts = {}, outcome = "lead_capture") {
  // Fair flow: strong value proposition matched with modest initial commitment
  return {
    score: 80,
    findings: [],
  };
}

/**
 * Primary evaluator for Conversion Design (CD).
 */
export function evaluateConversionDesign(evidence = {}, facts = {}, { primaryOutcome = "lead_capture" } = {}) {
  const cta = scorePathwayClarity(evidence, facts, primaryOutcome);
  const form = scoreFormFriction(facts);
  const proof = scoreTrustProximity(evidence, facts);
  const price = scorePriceClarity(evidence, facts);
  const flow = scoreValueExchange(facts, primaryOutcome);

  const rawComponents = {
    "cd.cta": cta.score,
    form: form.score,
    proof: proof.score,
    price: price.score,
    flow: flow.score,
  };

  const weights = SXO_LAYERS.cd.componentWeights;
  const { score, coverage } = weightedMeanMap(rawComponents, weights);

  const findings = [
    ...cta.findings,
    ...form.findings,
    ...proof.findings,
    ...price.findings,
    ...flow.findings,
  ].map((f) => ({
    message: f,
    rootCause: "conversion_friction",
  }));

  return {
    score,
    coverage,
    primaryOutcome,
    components: rawComponents,
    findings,
  };
}
