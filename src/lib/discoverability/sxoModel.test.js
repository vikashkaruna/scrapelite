// sxoModel.test.js — Unit test suite for SXO model and scoring (Stage 2 / P3A).

import { describe, it, expect } from "vitest";
import {
  SXO_LAYERS,
  SXO_LAYER_WEIGHTS,
  MASTER_FRAMEWORK_WEIGHTS,
  SXO_MODEL_VERSION,
  DEFAULT_WEIGHT_SET_ID,
  getSxoLayer,
} from "./sxoModel.js";
import { INTENT_CLASSES, evaluateIntentMatch, scoreQuestionHeadings } from "./intentMatch.js";
import { FIRST_SCREEN_FLAGS, evaluateFirstScreen } from "./firstScreen.js";
import { evaluateFriction, scoreCoreWebVitals } from "./frictionAudit.js";
import { PRIMARY_OUTCOMES, evaluateConversionDesign } from "./conversionDesign.js";
import { evaluateSxo, computeMasterScore } from "./sxoScoring.js";

describe("SXO Model & Weights (§0.1 / §11.3 parity)", () => {
  it("SXO layer weights sum exactly to 1.00", () => {
    const sum = Object.values(SXO_LAYER_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 1000) / 1000).toBe(1.0);
  });

  it("Master framework weights sum exactly to 1.00 (§0.1: 0.25SEO + 0.20AEO + 0.20GEO + 0.35SXO)", () => {
    const sum = Object.values(MASTER_FRAMEWORK_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 1000) / 1000).toBe(1.0);
    expect(MASTER_FRAMEWORK_WEIGHTS.seo).toBe(0.25);
    expect(MASTER_FRAMEWORK_WEIGHTS.aeo).toBe(0.20);
    expect(MASTER_FRAMEWORK_WEIGHTS.geo).toBe(0.20);
    expect(MASTER_FRAMEWORK_WEIGHTS.sxo).toBe(0.35);
  });

  it("Component weights for all layers sum to 1.00", () => {
    for (const [key, layer] of Object.entries(SXO_LAYERS)) {
      if (layer.componentWeights) {
        const sum = Object.values(layer.componentWeights).reduce((a, b) => a + b, 0);
        expect(Math.round(sum * 1000) / 1000, `Layer ${key} weights do not sum to 1.0`).toBe(1.0);
      }
    }
  });

  it("TD reuses Technical Accessibility directly with no duplicate scorer", () => {
    const td = getSxoLayer("td");
    expect(td).not.toBeNull();
    expect(td.reusesFrom).toBe("technical_accessibility");
    expect(td.weight).toBe(0.20);
  });

  it("SXO uses dedicated model series 's1' and weight set 'sxo_default_v1'", () => {
    expect(SXO_MODEL_VERSION).toBe("s1");
    expect(DEFAULT_WEIGHT_SET_ID).toBe("sxo_default_v1");
  });
});

describe("Intent Match (IC layer §11.4)", () => {
  it("defines exactly the 8 intent classes", () => {
    expect(INTENT_CLASSES).toEqual([
      "informational", "navigational", "commercial_investigation", "comparison",
      "transactional", "local_service", "support_troubleshooting", "brand_reputation_validation",
    ]);
  });

  it("scores question headings accurately", () => {
    const outline = [
      { level: 1, text: "Welcome to DatIQ" },
      { level: 2, text: "How does AEO work?" },
      { level: 2, text: "What is SXO?" },
      { level: 3, text: "Pricing options" },
    ];
    const qh = scoreQuestionHeadings(outline);
    expect(qh.count).toBe(2);
    expect(qh.total).toBe(4);
    expect(qh.score).toBeGreaterThan(50);
  });

  it("evaluates IC layer and redistributes unmeasured components", () => {
    const evidence = {
      heading_outline: [{ level: 1, text: "How to audit your site?" }],
      direct_answer_blocks: [{ text: "An audit evaluates technical, content and conversion factors." }],
      faq_pairs: [{ q: "What is SXO?", a: "Search Experience Optimization." }],
    };
    const facts = { content: { word_count: 500, numbers_count: 8, lists_count: 2 } };
    const res = evaluateIntentMatch(evidence, facts, { intentClass: "informational" });

    expect(res.score).toBeGreaterThan(60);
    // Citation and CTA evidence were not collected, so their 25% is excluded.
    expect(res.coverage).toBe(75);
    expect(res.components.qh).not.toBeNull();
    expect(res.components.af).not.toBeNull();
  });

  it("does not treat missing answer and citation evidence as a measured failure", () => {
    const res = evaluateIntentMatch({}, {});
    expect(res.components).toEqual({
      qh: null, af: null, pf: null, ev: null, "ic.cta": null,
    });
    expect(res.score).toBeNull();
    expect(res.coverage).toBe(0);
    expect(res.findings.join(" ")).toMatch(/unmeasured|not measured|detected/i);
  });
});

describe("First Screen & Information Architecture (IA layer §11.5)", () => {
  it("evaluates all 6 required flags as findings, not direct score inputs", () => {
    expect(FIRST_SCREEN_FLAGS.length).toBe(6);
    const evidence = { heading_outline: [{ level: 1, text: "Main Title" }] };
    const facts = { technical: { viewport_meta: true, mobile_friendly: true } };
    const res = evaluateFirstScreen(evidence, facts);

    expect(Object.keys(res.flags)).toEqual(FIRST_SCREEN_FLAGS);
    expect(res.score).toBeGreaterThan(0);
    // Only orientation and heading hierarchy are evidenced by this fixture.
    expect(res.coverage).toBe(40);
  });

  it("excludes every first-screen component when its evidence was not collected", () => {
    const res = evaluateFirstScreen({}, {});
    expect(res.components).toEqual({ o: null, a: null, v: null, p: null, n: null });
    expect(res.score).toBeNull();
    expect(res.coverage).toBe(0);
    expect(res.findings.join(" ")).toMatch(/unmeasured|not measured/i);
  });
});

describe("Fast, Low-Friction Experience (UX layer §11.6)", () => {
  it("🔴 unmeasured Core Web Vitals returns null and redistributes cleanly (never 0!)", () => {
    const cwv = scoreCoreWebVitals(null);
    expect(cwv.score).toBeNull();

    const res = evaluateFriction({}, { technical: {}, content: { word_count: 300 } });
    expect(res.components.cwv).toBeNull();
    // Only readability (15%) is measured; every absent input is excluded.
    expect(res.coverage).toBe(15);
    // Score is non-null because readability is measured.
    expect(res.score).toBeGreaterThan(0);
  });

  it("does not award neutral UX points to evidence the crawler never collected", () => {
    const res = evaluateFriction({}, {});
    expect(res.components).toEqual({
      cwv: null, mobile: null, read: null, nav: null, overlay: null, access: null,
    });
    expect(res.score).toBeNull();
    expect(res.coverage).toBe(0);
    expect(res.findings.join(" ")).toMatch(/unmeasured|unavailable|absent/i);
  });
});

describe("Conversion Design (CD layer §11.7)", () => {
  it("defines the 12 primary outcomes", () => {
    expect(PRIMARY_OUTCOMES).toEqual([
      "demo", "trial", "contact", "quote", "booking", "purchase", "add_to_cart",
      "call", "whatsapp_chat", "download", "newsletter", "account_creation",
    ]);
  });

  it("activates conversion_friction root cause on findings", () => {
    const res = evaluateConversionDesign({}, { technical: { primary_cta_detected: false }, content: {} });
    expect(res.findings.length).toBeGreaterThan(0);
    for (const finding of res.findings) {
      expect(finding.rootCause).toBe("conversion_friction");
    }
  });

  it("does not invent a conversion score when CTA, form, proof, price and flow were unmeasured", () => {
    const res = evaluateConversionDesign({}, {});
    expect(res.components).toEqual({
      "cd.cta": null, form: null, proof: null, price: null, flow: null,
    });
    expect(res.score).toBeNull();
    expect(res.coverage).toBe(0);
    expect(res.findings.every((finding) => finding.rootCause === "conversion_friction")).toBe(true);
    expect(res.findings.map((finding) => finding.message).join(" ")).toMatch(/unmeasured|not measured/i);
  });
});

describe("SXO Scoring & Master Composite (§0.1 / §11.3 / D14)", () => {
  it("🔴 asserts TD and the Technical Accessibility pillar agree on the same page", () => {
    const auditData = {
      pillars: {
        technical_accessibility: { score: 84.5, coverage: 100 },
      },
      evidence: {
        heading_outline: [{ level: 1, text: "Discoverability Audit Guide" }],
      },
      facts: {
        content: { word_count: 450 },
        technical: { viewport_meta: true },
      },
    };

    const res = evaluateSxo(auditData);
    expect(res.layerScores.td).toBe(84.5);
    expect(res.score).toBeGreaterThan(0);
    expect(res.modelVersion).toBe("s1");
  });

  it("computes Master Composite Score across SEO, AEO, GEO, and SXO", () => {
    const composite = computeMasterScore({
      seo: 80,
      aeo: 75,
      geo: 70,
      sxo: 85,
    });

    // 0.25*80 + 0.20*75 + 0.20*70 + 0.35*85 = 20 + 15 + 14 + 29.75 = 78.75 -> 78.8
    expect(composite.score).toBe(78.8);
    expect(composite.coverage).toBe(100);
  });

  it("redistributes cleanly when SXO is unmeasured", () => {
    const composite = computeMasterScore({
      seo: 80,
      aeo: 70,
      geo: 90,
      sxo: null,
    });

    // Measured weights: 0.25 + 0.20 + 0.20 = 0.65 -> 65% coverage
    expect(composite.coverage).toBe(65);
    expect(composite.score).toBeGreaterThan(0);
  });
});
