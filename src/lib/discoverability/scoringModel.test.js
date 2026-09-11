import { describe, it, expect } from "vitest";
import {
  PILLARS, PILLAR_IDS, SIGNALS, SIGNAL_CODES, signalsForPillar, nonDeterministicSignals,
} from "./signalRegistry.js";
import {
  FRAMEWORK_WEIGHTS, FRAMEWORKS, PENALTIES, PENALTY_CODES,
  scorePillar, scoreAllPillars, scoreFramework, scoreAllFrameworks,
  composePenalty, scoreAudit, weightedMean, clamp100, round1, scoreBand, BANDS,
  SCORING_MODEL_VERSION,
} from "./scoringModel.js";

const allSignals = (v) => Object.fromEntries(SIGNAL_CODES.map((c) => [c, v]));

describe("signal registry integrity", () => {
  // These four assertions are the reason a future weight edit cannot silently
  // rescale every user's historical score. Rebalancing is allowed; forgetting
  // to rebalance is not.
  it("each pillar's signal weights sum to exactly 1", () => {
    for (const pillar of PILLAR_IDS) {
      const sum = signalsForPillar(pillar).reduce((a, c) => a + SIGNALS[c].weight, 0);
      expect(sum, `pillar ${pillar}`).toBeCloseTo(1, 10);
    }
  });

  it("the four pillar weights sum to exactly 1", () => {
    expect(Object.values(PILLARS).reduce((a, p) => a + p.weight, 0)).toBeCloseTo(1, 10);
  });

  it("every signal belongs to a declared pillar", () => {
    for (const code of SIGNAL_CODES) expect(PILLAR_IDS).toContain(SIGNALS[code].pillar);
  });

  it("every signal has a label and a description of what it measures", () => {
    for (const code of SIGNAL_CODES) {
      expect(SIGNALS[code].label, code).toBeTruthy();
      expect(SIGNALS[code].measures, code).toBeTruthy();
    }
  });

  it("names the three signals that depend on a model or an external service", () => {
    // If this list grows, an audit can silently lose more coverage than the UI
    // is prepared to explain — so the growth should be a deliberate edit here.
    expect(nonDeterministicSignals().sort()).toEqual(
      ["citation_footprint", "core_web_vitals", "passage_independence"],
    );
  });
});

describe("framework weightings", () => {
  it("every framework's pillar weights sum to exactly 1", () => {
    for (const f of FRAMEWORKS) {
      const sum = Object.values(FRAMEWORK_WEIGHTS[f]).reduce((a, b) => a + b, 0);
      expect(sum, `framework ${f}`).toBeCloseTo(1, 10);
    }
  });

  it("covers every pillar in every framework", () => {
    for (const f of FRAMEWORKS) {
      expect(Object.keys(FRAMEWORK_WEIGHTS[f]).sort()).toEqual([...PILLAR_IDS].sort());
    }
  });

  it("encodes the real difference between the disciplines", () => {
    // SEO leans on technical access, AEO on extractable answers, GEO on entity
    // authority. If these ever invert, the three tabs stop meaning anything.
    expect(FRAMEWORK_WEIGHTS.seo.technical_accessibility)
      .toBeGreaterThan(FRAMEWORK_WEIGHTS.aeo.technical_accessibility);
    expect(FRAMEWORK_WEIGHTS.aeo.answer_clarity)
      .toBeGreaterThan(FRAMEWORK_WEIGHTS.seo.answer_clarity);
    expect(FRAMEWORK_WEIGHTS.geo.entity_authority)
      .toBeGreaterThan(FRAMEWORK_WEIGHTS.seo.entity_authority);
  });
});

describe("weightedMean — the unknown-redistribution primitive", () => {
  it("is a plain weighted mean when everything is measured", () => {
    const r = weightedMean([{ value: 100, weight: 0.5 }, { value: 0, weight: 0.5 }]);
    expect(r.score).toBe(50);
    expect(r.coverage).toBe(1);
  });

  it("redistributes an unmeasured entry's weight instead of scoring it 0", () => {
    const r = weightedMean([{ value: 100, weight: 0.5 }, { value: null, weight: 0.5 }]);
    expect(r.score).toBe(100);   // NOT 50
    expect(r.coverage).toBe(0.5);
  });

  it("returns null, not 0, when nothing was measured", () => {
    const r = weightedMean([{ value: null, weight: 0.5 }, { value: undefined, weight: 0.5 }]);
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });

  it("treats NaN and non-numbers as unmeasured rather than as zero", () => {
    for (const bad of [NaN, Infinity, "80", true, {}, []]) {
      expect(weightedMean([{ value: bad, weight: 1 }]).score, String(bad)).toBeNull();
    }
  });
});

describe("scoreAudit — end to end", () => {
  it("scores a flawless page 100 across every framework", () => {
    const r = scoreAudit({ signalValues: allSignals(100) });
    expect(r.finalScore).toBe(100);
    expect(r.seoScore).toBe(100);
    expect(r.aeoScore).toBe(100);
    expect(r.geoScore).toBe(100);
    expect(r.coverage).toBe(100);
  });

  it("scores a page that fails everything at 0, not null", () => {
    const r = scoreAudit({ signalValues: allSignals(0) });
    expect(r.finalScore).toBe(0);
    expect(r.coverage).toBe(100);   // fully measured, and the answer is 0
  });

  it("returns null — never 0 — when nothing could be measured at all", () => {
    const r = scoreAudit({ signalValues: allSignals(null) });
    expect(r.finalScore).toBeNull();
    expect(r.seoScore).toBeNull();
    expect(r.coverage).toBe(0);
  });

  // ── The regression this whole design exists to prevent ────────────────────
  it("an unmeasured Core Web Vitals does not lower the score", () => {
    const withCwv = scoreAudit({ signalValues: allSignals(100) });
    const withoutCwv = scoreAudit({
      signalValues: { ...allSignals(100), core_web_vitals: null },
      unknownReasons: { core_web_vitals: "not_measured" },
    });
    expect(withoutCwv.finalScore).toBe(withCwv.finalScore);
  });

  it("but a MEASURED zero Core Web Vitals does lower it", () => {
    const r = scoreAudit({ signalValues: { ...allSignals(100), core_web_vitals: 0 } });
    // 0.25 pillar share x 0.30 signal share x 100 = 7.5 points.
    expect(r.finalScore).toBe(92.5);
  });

  it("reports the lost evidence as reduced coverage, so the score is not oversold", () => {
    const r = scoreAudit({
      signalValues: { ...allSignals(100), core_web_vitals: null },
      unknownReasons: { core_web_vitals: "not_measured" },
    });
    expect(r.coverage).toBe(92.5);
    // Coverage is signal-level, so a missing technical signal costs the
    // technical-heavy SEO view more than the answer-heavy AEO view.
    expect(r.frameworks.seo.coverage).toBeLessThan(r.frameworks.aeo.coverage);
  });

  it("marks a not-applicable signal as such without penalising the page", () => {
    const r = scoreAudit({
      signalValues: { ...allSignals(100), howto_schema_alignment: null },
      unknownReasons: { howto_schema_alignment: "not_applicable" },
    });
    expect(r.finalScore).toBe(100);
    const howto = r.pillars.structural_hierarchy.signals
      .find((s) => s.code === "howto_schema_alignment");
    expect(howto.applicable).toBe(false);
    expect(howto.unknownReason).toBe("not_applicable");
  });

  it("clamps out-of-range signal values rather than letting them skew the mean", () => {
    const r = scoreAudit({ signalValues: { ...allSignals(100), conciseness: 500 } });
    expect(r.finalScore).toBe(100);
  });
});

describe("penalty layer", () => {
  it("is multiplicative and applies to every framework view, not just overall", () => {
    const r = scoreAudit({
      signalValues: allSignals(100),
      penaltyCodes: ["AI_CRAWLER_BLOCKED"],
    });
    expect(r.penaltyMultiplier).toBe(0.8);
    expect(r.finalScore).toBe(80);
    expect(r.seoScore).toBe(80);
    expect(r.aeoScore).toBe(80);   // a robots block is no less of a problem here
    expect(r.geoScore).toBe(80);
  });

  it("preserves the pre-penalty score so the report can show the arithmetic", () => {
    const r = scoreAudit({ signalValues: allSignals(100), penaltyCodes: ["NOINDEX"] });
    expect(r.scoreMath).toEqual({
      prePenaltyTotal: 100, penaltyMultiplier: 0.8, finalScore: 80,
    });
    expect(r.frameworks.overall.prePenaltyScore).toBe(100);
  });

  it("compounds multiple blockers", () => {
    const r = composePenalty(["AI_CRAWLER_BLOCKED", "CONTENT_HYDRATION_ONLY"]);
    expect(r.multiplier).toBeCloseTo(0.64, 4);   // 0.8 x 0.8
    expect(r.applied).toHaveLength(2);
  });

  it("charges a duplicated blocker exactly once", () => {
    // Two analysers can both notice a robots block. The user is not twice as
    // blocked.
    const r = composePenalty(["AI_CRAWLER_BLOCKED", "AI_CRAWLER_BLOCKED"]);
    expect(r.multiplier).toBe(0.8);
    expect(r.applied).toHaveLength(1);
  });

  it("ignores an unrecognised code rather than losing the whole audit", () => {
    // A stored audit from an older build, or a newer analyser, must degrade to
    // a slightly generous score — never to a crash.
    const r = composePenalty(["AI_CRAWLER_BLOCKED", "SOMETHING_FROM_THE_FUTURE"]);
    expect(r.multiplier).toBe(0.8);
    expect(r.applied).toHaveLength(1);
  });

  it("leaves the score untouched when nothing is blocked", () => {
    expect(composePenalty([]).multiplier).toBe(1);
    expect(composePenalty().multiplier).toBe(1);
  });

  it("never produces a negative or above-1 multiplier", () => {
    const r = composePenalty(PENALTY_CODES);
    expect(r.multiplier).toBeGreaterThan(0);
    expect(r.multiplier).toBeLessThan(1);
  });

  it("every penalty carries a severity and an explanation a user can act on", () => {
    for (const code of PENALTY_CODES) {
      expect(["critical", "high", "medium"]).toContain(PENALTIES[code].severity);
      expect(PENALTIES[code].description.length).toBeGreaterThan(30);
    }
  });
});

describe("scorePillar", () => {
  it("reports which signals were measured and which were not", () => {
    const p = scorePillar("answer_clarity",
      { direct_answer_block: 100, conciseness: 50 },
      { passage_independence: "not_measured" });
    expect(p.measured).toBe(2);
    expect(p.unmeasured).toBe(3);
    // 100 x 0.30 + 50 x 0.25, over the 0.55 weight actually used.
    expect(p.score).toBe(77.3);
  });

  it("returns a null score for a pillar with no evidence at all", () => {
    const p = scorePillar("entity_authority", {});
    expect(p.score).toBeNull();
    expect(p.coverage).toBe(0);
  });
});

describe("scoreFramework", () => {
  it("refuses an unknown framework loudly", () => {
    expect(() => scoreFramework("bing", {})).toThrow(/Unknown framework/);
  });

  it("redistributes a whole unknown pillar across the ones with evidence", () => {
    const pillars = scoreAllPillars({ ...allSignals(80), ...Object.fromEntries(
      signalsForPillar("entity_authority").map((c) => [c, null])) });
    expect(pillars.entity_authority.score).toBeNull();
    // The three surviving pillars all read 80, so every framework must too.
    for (const f of FRAMEWORKS) expect(scoreFramework(f, pillars).score).toBe(80);
  });
});

describe("presentation helpers", () => {
  it("bands are ordered and exhaustive from 100 down to 0", () => {
    expect(scoreBand(100).id).toBe("excellent");
    expect(scoreBand(85).id).toBe("excellent");
    expect(scoreBand(84.9).id).toBe("good");
    expect(scoreBand(70).id).toBe("good");
    expect(scoreBand(50).id).toBe("fair");
    expect(scoreBand(0).id).toBe("poor");
    expect(BANDS.map((b) => b.min)).toEqual([85, 70, 50, 0]);
  });

  it("gives an unmeasured score its own band, never the failing one", () => {
    // Rendering "not measured" in the same red as a genuine 12 is the visual
    // form of the same lie the scorer is built to avoid.
    for (const v of [null, undefined, NaN]) {
      expect(scoreBand(v).id).toBe("unknown");
      expect(scoreBand(v).tone).toBe("muted");
    }
    expect(scoreBand(10).tone).toBe("danger");
  });

  it("clamp100 and round1 behave at the edges", () => {
    expect(clamp100(-5)).toBe(0);
    expect(clamp100(150)).toBe(100);
    expect(clamp100(NaN)).toBe(0);
    expect(round1(77.25)).toBe(77.3);
    expect(round1(null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W3 — THE PENALTY SET, AND THE CALIBRATION THAT WAS DELIBERATELY KEPT
// ═══════════════════════════════════════════════════════════════════════════
// Decision D1: the shipped calibration is retained in full and only the two PRD
// conditions with no shipped equivalent are added. These assertions are the
// executable form of that ruling — if a later session "aligns to the PRD" by
// moving AI_CRAWLER_BLOCKED to 0.15, this file says why it was 0.20.

describe("the penalty model holds its shipped calibration", () => {
  it("keeps every factor that shipped, including the two that diverge from the PRD", () => {
    // AI_CRAWLER_BLOCKED and CONTENT_HYDRATION_ONLY are 0.20, not the PRD's
    // 0.15, because a page an engine cannot fetch or render is not "a good page
    // minus a few points" to that engine — it is a blank one.
    expect(PENALTIES.NOINDEX.factor).toBe(0.20);
    expect(PENALTIES.AI_CRAWLER_BLOCKED.factor).toBe(0.20);
    expect(PENALTIES.CONTENT_HYDRATION_ONLY.factor).toBe(0.20);
    expect(PENALTIES.CANONICAL_TARGET_BROKEN.factor).toBe(0.15);
    expect(PENALTIES.FAQ_SCHEMA_MISMATCH.factor).toBe(0.10);
  });

  it("keeps both DatIQ extensions the PRD has no row for", () => {
    expect(PENALTIES.AI_CRAWLER_PARTIAL_BLOCK.factor).toBe(0.05);
    expect(PENALTIES.MOBILE_PARITY_MISSING.factor).toBe(0.10);
  });

  it("adds the two PRD conditions at the PRD's own weights", () => {
    expect(PENALTIES.ENTITY_SCHEMA_INVALID.factor).toBe(0.10);
    expect(PENALTIES.SEVERE_CWV_FAILURE.factor).toBe(0.10);
  });

  it("carries nine blockers and no more", () => {
    // A count assertion catches an accidental addition that no other test
    // would notice — every penalty silently scales every framework view.
    expect(PENALTY_CODES).toHaveLength(9);
  });

  it("scores a page that trips neither new condition identically to v1", () => {
    // The claim the version-bump note rests on, and the reason the bump is
    // narrow rather than a re-calibration.
    const values = Object.fromEntries(Object.keys(SIGNALS).map((c) => [c, 70]));
    const clean = scoreAudit({ signalValues: values, penaltyCodes: [] });
    const v1Blockers = scoreAudit({ signalValues: values, penaltyCodes: ["NOINDEX", "FAQ_SCHEMA_MISMATCH"] });
    // 1 - 0.20 = 0.80, then 0.80 * (1 - 0.10) = 0.72 — exactly the v1 arithmetic.
    expect(v1Blockers.penaltyMultiplier).toBeCloseTo(0.72, 5);
    expect(clean.penaltyMultiplier).toBe(1);
  });

  it("scales a page that DOES trip a new condition", () => {
    const values = Object.fromEntries(Object.keys(SIGNALS).map((c) => [c, 70]));
    const withNew = scoreAudit({ signalValues: values, penaltyCodes: ["SEVERE_CWV_FAILURE"] });
    expect(withNew.penaltyMultiplier).toBeCloseTo(0.90, 5);
    expect(withNew.finalScore).toBeLessThan(
      scoreAudit({ signalValues: values, penaltyCodes: [] }).finalScore,
    );
  });

  it("declares v2, and every penalty has a label and a description", () => {
    expect(SCORING_MODEL_VERSION).toBe("v2");
    for (const code of PENALTY_CODES) {
      expect(PENALTIES[code].label, code).toBeTruthy();
      expect(PENALTIES[code].description, code).toBeTruthy();
      expect(PENALTIES[code].factor, code).toBeGreaterThan(0);
      expect(PENALTIES[code].factor, code).toBeLessThan(1);
    }
  });
});
