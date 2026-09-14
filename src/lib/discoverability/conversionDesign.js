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

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export const PRIMARY_OUTCOMES = Object.freeze([
  "demo",
  "trial",
  "contact",
  "quote",
  "booking",
  "purchase",
  "add_to_cart",
  "call",
  "whatsapp_chat",
  "download",
  "newsletter",
  "account_creation",
]);

export const PRIMARY_OUTCOME_DETAILS = Object.freeze({
  demo: { id: "demo", label: "Demo", defaultFormFields: ["company", "email", "name"] },
  trial: { id: "trial", label: "Trial", defaultFormFields: ["email"] },
  contact: { id: "contact", label: "Contact", defaultFormFields: ["email", "name"] },
  quote: { id: "quote", label: "Quote", defaultFormFields: ["scope", "email", "phone"] },
  booking: { id: "booking", label: "Booking", defaultFormFields: ["datetime", "email"] },
  purchase: { id: "purchase", label: "Purchase", defaultFormFields: ["cart", "checkout"] },
  add_to_cart: { id: "add_to_cart", label: "Add to Cart", defaultFormFields: [] },
  call: { id: "call", label: "Call", defaultFormFields: ["tel"] },
  whatsapp_chat: { id: "whatsapp_chat", label: "WhatsApp Chat", defaultFormFields: [] },
  download: { id: "download", label: "Download", defaultFormFields: ["email"] },
  newsletter: { id: "newsletter", label: "Newsletter", defaultFormFields: ["email"] },
  account_creation: { id: "account_creation", label: "Account Creation", defaultFormFields: ["email", "password"] },
});

/**
 * Score Outcome Pathway Clarity (cd.cta, weight 0.25).
 * Is the primary conversion pathway distinct, unambiguous, and present?
 */
export function scorePathwayClarity(evidence = {}, facts = {}, outcome = "contact") {
  const technical = facts.technical || {};
  const content = facts.content || {};
  const measured = hasOwn(technical, "primary_cta_detected")
    || Array.isArray(content.detected_buttons) || Array.isArray(evidence.detected_actions);
  if (!measured) {
    return { score: null, findings: ["Conversion pathway and CTA evidence were not measured."] };
  }
  const buttons = Array.isArray(content.detected_buttons) ? content.detected_buttons : [];
  const actions = Array.isArray(evidence.detected_actions) ? evidence.detected_actions : [];
  const ctaCount = (technical.primary_cta_detected ? 1 : 0) + buttons.length + actions.length;

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
  if (!Array.isArray(technical.detected_forms)) {
    return { score: null, findings: ["Form friction was not measured."] };
  }
  const forms = technical.detected_forms;

  if (forms.length === 0) {
    return { score: null, findings: ["No form was detected; form friction is excluded from this score."] };
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
  const content = facts.content || {};
  const measured = Array.isArray(evidence.schema_types) || hasOwn(content, "mentions_guarantee")
    || hasOwn(content, "mentions_security") || hasOwn(content, "trust_proof_near_cta");
  if (!measured) {
    return { score: null, findings: ["Trust reinforcement proximity was not measured."] };
  }
  const schemaTypes = Array.isArray(evidence.schema_types) ? evidence.schema_types : [];
  const hasReviews = schemaTypes.some((t) => ["AggregateRating", "Review"].includes(t));
  const hasOrg = schemaTypes.includes("Organization");
  const mentionsTrust = Boolean(content.mentions_guarantee || content.mentions_security
    || content.trust_proof_near_cta || hasReviews);

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
  const content = facts.content || {};
  const measured = Array.isArray(evidence.schema_types) || hasOwn(content, "price_detected")
    || hasOwn(content, "mentions_free_tier") || hasOwn(content, "pricing_link_detected");
  if (!measured) return { score: null, findings: ["Pricing and terms clarity was not measured."] };
  const schemaTypes = Array.isArray(evidence.schema_types) ? evidence.schema_types : [];
  const hasOffer = schemaTypes.some((t) => ["Offer", "PriceSpecification"].includes(t));
  const mentionsPrice = Boolean(hasOffer || content.price_detected || content.mentions_free_tier
    || content.pricing_link_detected);

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
export function scoreValueExchange(facts = {}, outcome = "contact") {
  const score = facts.content?.value_exchange_score;
  if (!Number.isFinite(score)) {
    return { score: null, findings: ["Value exchange fairness was not measured."] };
  }
  return {
    score: Math.max(0, Math.min(100, score)),
    findings: [],
  };
}

/**
 * Primary evaluator for Conversion Design (CD).
 */
export function evaluateConversionDesign(evidence = {}, facts = {}, { primaryOutcome = "contact" } = {}) {
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
