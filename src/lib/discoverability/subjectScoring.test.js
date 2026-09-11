import { describe, it, expect } from "vitest";
import {
  BDS_COMPONENTS, PDS_COMPONENTS, SFS_COMPONENTS,
  SUBJECT_SCORES, SUBJECT_SCORE_IDS,
  COMPONENT_SOURCES, UNBUILT_SOURCES,
  scoreSubject, isThin, THIN_COVERAGE, missingFacts, intentCoverage,
} from "./subjectScoring.js";

const sum = (o) => Object.values(o).reduce((n, c) => n + c.weight, 0);
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ── The formulas ───────────────────────────────────────────────────────────

describe("the three formulas are the PRD's, to the digit", () => {
  // 🔴 THESE ASSERTIONS EXIST SO AN "ALIGN THE NUMBERS" PASS FAILS THE BUILD
  // WITH THE REASONING ATTACHED, rather than silently re-calibrating three
  // scores in the product. Same guard scoringModel.test.js puts on the penalty
  // model after D1.
  it("BDS = 0.25·EC + 0.20·SD + 0.25·ASOV + 0.20·TC + 0.10·RA", () => {
    expect(BDS_COMPONENTS.entity_clarity.weight).toBe(0.25);
    expect(BDS_COMPONENTS.structured_data.weight).toBe(0.20);
    expect(BDS_COMPONENTS.ai_share_of_voice.weight).toBe(0.25);
    expect(BDS_COMPONENTS.trust_credibility.weight).toBe(0.20);
    expect(BDS_COMPONENTS.recommendation_rate.weight).toBe(0.10);
  });

  it("PDS = 0.25·CF + 0.20·EA + 0.20·CC + 0.15·TP + 0.10·AR + 0.10·RA", () => {
    expect(PDS_COMPONENTS.fact_completeness.weight).toBe(0.25);
    expect(PDS_COMPONENTS.entity_association.weight).toBe(0.20);
    expect(PDS_COMPONENTS.comparison_coverage.weight).toBe(0.20);
    expect(PDS_COMPONENTS.trust_proof.weight).toBe(0.15);
    expect(PDS_COMPONENTS.answer_readiness.weight).toBe(0.10);
    expect(PDS_COMPONENTS.recommendation_rate.weight).toBe(0.10);
  });

  it("SFS = 0.25·IC + 0.20·VC + 0.20·PE + 0.15·GA + 0.10·TR + 0.10·CR", () => {
    expect(SFS_COMPONENTS.intent_coverage.weight).toBe(0.25);
    expect(SFS_COMPONENTS.vertical_coverage.weight).toBe(0.20);
    expect(SFS_COMPONENTS.process_explained.weight).toBe(0.20);
    expect(SFS_COMPONENTS.geographic_availability.weight).toBe(0.15);
    expect(SFS_COMPONENTS.trust_signals.weight).toBe(0.10);
    expect(SFS_COMPONENTS.conversion_readiness.weight).toBe(0.10);
  });

  it("every formula's weights sum to exactly 1", () => {
    for (const id of SUBJECT_SCORE_IDS) {
      expect(near(sum(SUBJECT_SCORES[id].components), 1), `${id} = ${sum(SUBJECT_SCORES[id].components)}`).toBe(true);
    }
  });

  it("keeps the PRD's abbreviations on every component, so the mapping is checkable", () => {
    expect(Object.values(BDS_COMPONENTS).map((c) => c.abbr)).toEqual(["EC", "SD", "ASOV", "TC", "RA"]);
    expect(Object.values(PDS_COMPONENTS).map((c) => c.abbr)).toEqual(["CF", "EA", "CC", "TP", "AR", "RA"]);
    expect(Object.values(SFS_COMPONENTS).map((c) => c.abbr)).toEqual(["IC", "VC", "PE", "GA", "TR", "CR"]);
  });
});

describe("every component binds to a real source", () => {
  it("🔴 names a KNOWN source for each — a component with no source is a weight on a number nobody produces", () => {
    for (const id of SUBJECT_SCORE_IDS) {
      for (const [cid, c] of Object.entries(SUBJECT_SCORES[id].components)) {
        expect(COMPONENT_SOURCES[c.source], `${id}.${cid} → ${c.source}`).toBeTruthy();
        expect(c.label, cid).toBeTruthy();
        expect(c.describes, cid).toBeTruthy();
      }
    }
  });

  it("records honestly which sources are not built yet", () => {
    // If a workstream ships and this is not updated, the score silently stays
    // short of coverage for ever — so the list is asserted, not assumed.
    expect([...UNBUILT_SOURCES].sort()).toEqual(["local_directory", "trust_proof"]);
    expect(COMPONENT_SOURCES.trust_proof.workstream).toBe("W13");
    expect(COMPONENT_SOURCES.local_directory.workstream).toBe("W12");
  });
});

// ── Scoring, and the redistribution that matters ───────────────────────────

describe("scoreSubject", () => {
  it("scores a fully-measured subject as the plain weighted mean", () => {
    const r = scoreSubject("brand", {
      entity_clarity: 100, structured_data: 100, ai_share_of_voice: 100,
      trust_credibility: 100, recommendation_rate: 100,
    });
    expect(r.score).toBe(100);
    expect(r.coverage).toBe(100);
    expect(r.unmeasured).toEqual([]);
    expect(r.blockedBy).toEqual([]);
  });

  it("🔴 EXCLUDES an unmeasured component and REDISTRIBUTES its weight — never scores it 0", () => {
    // TC is 20% of BDS and W13 has not shipped. Scoring it zero would take
    // every brand score down twenty points for a module that does not exist,
    // then show a phantom twenty-point gain the day it lands — making the trend
    // line a fiction, which is what weightedMean exists to prevent.
    const r = scoreSubject("brand", {
      entity_clarity: 80, structured_data: 60, ai_share_of_voice: 40,
      recommendation_rate: 20,   // trust_credibility absent
    });
    // (80·.25 + 60·.20 + 40·.25 + 20·.10) / 0.80 = 44 / 0.8 = 55
    expect(r.score).toBe(55);
    expect(r.coverage).toBe(80);
    expect(r.unmeasured).toEqual(["trust_credibility"]);

    // Scoring it 0 would have produced 44. Pin the difference explicitly.
    expect(r.score).not.toBe(44);
  });

  it("names the WORKSTREAM a missing component is waiting on", () => {
    // "coverage 80%" without a reason reads as a bug. Saying W13 is what makes
    // it an explanation.
    const r = scoreSubject("brand", { entity_clarity: 80 });
    expect(r.blockedBy).toEqual(["W13"]);
  });

  it("reports SFS blocked on both unbuilt workstreams, de-duplicated and sorted", () => {
    const r = scoreSubject("service", { intent_coverage: 50 });
    expect(r.blockedBy).toEqual(["W12", "W13"]);
  });

  it("does NOT list a workstream when the gap is the customer's own data", () => {
    // A built source with no value is the customer's gap, not ours. Attributing
    // it to a workstream would tell them to wait for us instead of acting.
    const r = scoreSubject("brand", {
      entity_clarity: 80, ai_share_of_voice: 40,
      trust_credibility: 70, recommendation_rate: 20,   // structured_data absent
    });
    expect(r.unmeasured).toEqual(["structured_data"]);
    expect(r.blockedBy).toEqual([]);
  });

  it("🔴 contributions sum to the score, so the arithmetic checks out on screen", () => {
    // A reader adding value×weight against the raw weights would find they do
    // not reach the total, and conclude the score is wrong rather than that
    // something was excluded.
    const r = scoreSubject("product", {
      fact_completeness: 90, entity_association: 70, comparison_coverage: 50,
      answer_readiness: 30, recommendation_rate: 10,   // trust_proof absent
    });
    // `contribution` is value × (weight / coverage) — i.e. already the
    // weight-scaled share, so these sum DIRECTLY to the score. (The first
    // version of this assertion multiplied by weight a second time and was
    // wrong by a factor of the weight; the code was right.)
    const total = r.components
      .filter((c) => c.contribution !== null)
      .reduce((n, c) => n + c.contribution, 0);
    expect(Math.abs(total - r.score)).toBeLessThan(0.6);

    // And the excluded component contributes nothing at all, rather than zero
    // points that would drag the visible arithmetic.
    expect(r.components.find((c) => c.id === "trust_proof").contribution).toBeNull();
  });

  it("returns a null score, not zero, when nothing at all was measured", () => {
    // Zero is a verdict. "We measured nothing" is not.
    const r = scoreSubject("service", {});
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
    expect(r.measured).toEqual([]);
  });

  it("ignores non-numeric and non-finite values rather than coercing them", () => {
    const r = scoreSubject("brand", {
      entity_clarity: "80", structured_data: NaN, ai_share_of_voice: null,
      trust_credibility: undefined, recommendation_rate: Infinity,
    });
    expect(r.score).toBeNull();
    expect(r.measured).toEqual([]);
  });

  it("refuses an unknown subject kind rather than defaulting to one", () => {
    expect(scoreSubject("wizard", { x: 1 })).toBeNull();
    expect(scoreSubject(undefined)).toBeNull();
  });

  it("survives being called with no values at all", () => {
    expect(scoreSubject("brand").score).toBeNull();
  });
});

// ── Thinness ───────────────────────────────────────────────────────────────

describe("isThin", () => {
  it("flags a score built from less than 70% of its formula", () => {
    // A number gets screenshotted and forwarded; the caveat does not travel
    // with it. Same reasoning the PDF export already applies.
    expect(THIN_COVERAGE).toBe(70);
    expect(isThin(scoreSubject("brand", { entity_clarity: 90 }))).toBe(true);
  });

  it("does not flag a score with most of its formula measured", () => {
    const r = scoreSubject("brand", {
      entity_clarity: 90, structured_data: 90, ai_share_of_voice: 90, recommendation_rate: 90,
    });
    expect(r.coverage).toBe(80);
    expect(isThin(r)).toBe(false);
  });

  it("treats a null score as thin, and survives junk", () => {
    expect(isThin(scoreSubject("brand", {}))).toBe(true);
    expect(isThin(null)).toBe(false);
  });
});

// ── The missing-facts matrix ───────────────────────────────────────────────

describe("missingFacts", () => {
  it("🔴 SPLITS what the customer can act on from what WE have not built", () => {
    // Telling somebody to "improve trust and credibility" when we have not
    // shipped the thing that measures it is a referral to nothing.
    const r = scoreSubject("service", { intent_coverage: 50, process_explained: 40 });
    const m = missingFacts(r);
    expect(m.actionable.map((x) => x.component))
      .toEqual(["vertical_coverage", "conversion_readiness"]);
    expect(m.blocked.map((x) => x.component))
      .toEqual(["geographic_availability", "trust_signals"]);
    expect(m.blocked[0].blockedBy).toBe("W12");
  });

  it("⚠️ orders by WEIGHT, not by count — the 25% gap leads", () => {
    const r = scoreSubject("product", { trust_proof: 50 });
    const m = missingFacts(r);
    expect(m.actionable[0].component).toBe("fact_completeness");
    expect(m.actionable[0].worthPoints).toBe(25);
    // ...and equal weights break ties deterministically rather than by object order.
    const equal = m.actionable.filter((x) => x.weight === 0.20).map((x) => x.component);
    expect(equal).toEqual([...equal].sort());
  });

  it("reports how many points each gap is worth, so effort can be ranked", () => {
    const m = missingFacts(scoreSubject("brand", {}));
    const ec = m.actionable.find((x) => x.component === "entity_clarity");
    expect(ec.worthPoints).toBe(25);
    expect(ec.abbr).toBe("EC");
    expect(ec.sourceLabel).toBe("Canonical Business Truth Record");
  });

  it("returns nothing to do for a fully-measured subject", () => {
    const r = scoreSubject("brand", {
      entity_clarity: 1, structured_data: 1, ai_share_of_voice: 1,
      trust_credibility: 1, recommendation_rate: 1,
    });
    expect(missingFacts(r)).toEqual({ actionable: [], blocked: [] });
  });

  it("survives junk input", () => {
    expect(missingFacts(null)).toEqual({ actionable: [], blocked: [] });
    expect(missingFacts({ kind: "wizard" })).toEqual({ actionable: [], blocked: [] });
  });
});

// ── Intent coverage ────────────────────────────────────────────────────────

describe("intentCoverage", () => {
  it("scores answered against CHECKED, not against everything listed", () => {
    const c = intentCoverage([
      { id: "what-it-costs", answered: true },
      { id: "how-long", answered: false },
    ]);
    expect(c.score).toBe(50);
    expect(c.answered).toBe(1);
    expect(c.gaps).toEqual(["how-long"]);
  });

  it("🔴 an UNCHECKED intent is excluded and NAMED, never counted as a gap", () => {
    // Counting an unchecked question as unanswered reports a site as failing at
    // something nobody looked at — the same error as scoring an unmeasured
    // signal zero, one level up.
    const c = intentCoverage([
      { id: "what-it-costs", answered: true },
      { id: "who-for", answered: null },
      { id: "never-looked" },
    ]);
    expect(c.score).toBe(100);
    expect(c.checked).toBe(1);
    expect(c.gaps).toEqual([]);
    expect(c.unchecked).toEqual(["who-for", "never-looked"]);
  });

  it("honours per-intent weight, so a pricing question outranks a trivia one", () => {
    const c = intentCoverage([
      { id: "price", answered: true, weight: 3 },
      { id: "trivia", answered: false, weight: 1 },
    ]);
    expect(c.score).toBe(75);
  });

  it("returns null rather than zero when nothing was checked", () => {
    expect(intentCoverage([{ id: "a" }]).score).toBeNull();
    expect(intentCoverage([]).score).toBeNull();
    expect(intentCoverage(null).score).toBeNull();
  });

  it("ignores malformed intents rather than counting them", () => {
    const c = intentCoverage([null, { answered: true }, "x", { id: "ok", answered: true }]);
    expect(c.checked).toBe(1);
    expect(c.score).toBe(100);
  });
});
