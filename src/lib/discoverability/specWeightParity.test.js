import { describe, expect, it } from "vitest";
import { PILLARS } from "./signalRegistry.js";
import { FRAMEWORK_WEIGHTS, PENALTIES } from "./scoringModel.js";
import { BREADTH_BONUS, EASE_FLOOR, computePriorityScore } from "./recommendationModel.js";
import { WAVI_WEIGHTS } from "./aiVisibility.js";
import { BDS_COMPONENTS, PDS_COMPONENTS, SFS_COMPONENTS } from "./subjectScoring.js";
import { SOURCE_TIERS } from "./directorySources.js";
import { SCHEMA_COMPONENTS } from "./schemaIntelligence.js";
import { TC_COMPONENTS } from "./trustProof.js";

const weights = (registry) => Object.fromEntries(
  Object.entries(registry).map(([id, value]) => [id, value.weight]),
);

describe("BRD/PRD weight parity", () => {
  it("pins §7.3 pillar and framework weights verbatim", () => {
    expect(weights(PILLARS)).toEqual({
      answer_clarity: 0.30,
      entity_authority: 0.25,
      structural_hierarchy: 0.20,
      technical_accessibility: 0.25,
    });
    expect(FRAMEWORK_WEIGHTS).toEqual({
      overall: { answer_clarity: 0.30, entity_authority: 0.25, structural_hierarchy: 0.20, technical_accessibility: 0.25 },
      seo: { answer_clarity: 0.20, entity_authority: 0.20, structural_hierarchy: 0.20, technical_accessibility: 0.40 },
      aeo: { answer_clarity: 0.45, entity_authority: 0.15, structural_hierarchy: 0.25, technical_accessibility: 0.15 },
      geo: { answer_clarity: 0.25, entity_authority: 0.35, structural_hierarchy: 0.20, technical_accessibility: 0.20 },
    });
  });

  it("pins §7.4 penalties and records D1's two calibrated departures", () => {
    expect(Object.fromEntries(Object.entries(PENALTIES).map(([id, value]) => [id, value.factor]))).toEqual({
      AI_CRAWLER_BLOCKED: 0.20, // §7.4 says 0.15; D1 deliberately retains 0.20.
      AI_CRAWLER_PARTIAL_BLOCK: 0.05, // DatIQ extension, absent from §7.4.
      CANONICAL_TARGET_BROKEN: 0.15,
      FAQ_SCHEMA_MISMATCH: 0.10,
      CONTENT_HYDRATION_ONLY: 0.20, // §7.4 says 0.15; D1 deliberately retains 0.20.
      MOBILE_PARITY_MISSING: 0.10, // DatIQ extension, absent from §7.4.
      NOINDEX: 0.20,
      ENTITY_SCHEMA_INVALID: 0.10,
      SEVERE_CWV_FAILURE: 0.10,
    });
  });

  it("records §7.6's published linear weights and D1's multiplicative departure", () => {
    const publishedLinearWeights = { impact: 0.40, confidence: 0.20, breadth: 0.20, ease: 0.20 };
    expect(Object.values(publishedLinearWeights).reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(BREADTH_BONUS).toBe(0.15);
    expect(EASE_FLOOR).toBe(0.60);
    // Multiplication makes zero confidence a real gate; the published linear
    // formula would still award points. D1 retains this intentionally.
    expect(computePriorityScore({ impact: 100, confidence: 0, breadth: 3, effort: 0 })).toBe(0);
  });

  it("pins §7.8 WAVI verbatim", () => {
    expect(WAVI_WEIGHTS).toEqual({
      mention: 0.20,
      citation: 0.30,
      recommendation: 0.30,
      prominence: 0.10,
      accuracy: 0.10,
    });
  });

  it("pins §9.3–§9.5 BDS, PDS and SFS verbatim", () => {
    expect(weights(BDS_COMPONENTS)).toEqual({
      entity_clarity: 0.25, structured_data: 0.20, ai_share_of_voice: 0.25,
      trust_credibility: 0.20, recommendation_rate: 0.10,
    });
    expect(weights(PDS_COMPONENTS)).toEqual({
      fact_completeness: 0.25, entity_association: 0.20, comparison_coverage: 0.20,
      trust_proof: 0.15, answer_readiness: 0.10, recommendation_rate: 0.10,
    });
    expect(weights(SFS_COMPONENTS)).toEqual({
      intent_coverage: 0.25, vertical_coverage: 0.20, process_explained: 0.20,
      geographic_availability: 0.15, trust_signals: 0.10, conversion_readiness: 0.10,
    });
  });

  it("pins D21's normalized §9.6 5x/4x/4x/3x/1x scoring choice", () => {
    expect(weights(SOURCE_TIERS)).toEqual({
      authoritative: 1.00,
      major_aggregator: 0.80,
      registry: 0.80,
      vertical: 0.60,
      social_review: 0.20,
    });
    expect(SOURCE_TIERS.social_review.multiplierRange).toEqual([1, 2]);
  });

  it("pins §9.7 Schema and §9.8 Trust Credibility verbatim", () => {
    expect(weights(SCHEMA_COMPONENTS)).toEqual({
      entity_object: 0.30, lint_validity: 0.30, type_spread: 0.20,
      fidelity: 0.10, graph_linkage: 0.10,
    });
    expect(weights(TC_COMPONENTS)).toEqual({
      documented_proof: 0.25, ratings_reviews: 0.20, people_identity: 0.20,
      media_mentions: 0.15, credentials: 0.10, external_presence: 0.10,
    });
  });
});
