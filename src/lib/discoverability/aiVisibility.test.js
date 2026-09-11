import { describe, it, expect } from "vitest";
import {
  WAVI_WEIGHTS, WAVI_COMPONENT_IDS,
  answerProminence, aggregateProminence, aggregateAccuracy,
  computeWavi, waviFromSample,
} from "./aiVisibility.js";
import { SCORING_MODEL_VERSION } from "./scoringModel.js";
import { SIGNALS } from "./signalRegistry.js";

describe("the PRD's weights", () => {
  it("are 0.20M + 0.30C + 0.30R + 0.10P + 0.10A, and sum to 1", () => {
    expect(WAVI_WEIGHTS).toEqual({
      mention: 0.20, citation: 0.30, recommendation: 0.30, prominence: 0.10, accuracy: 0.10,
    });
    const sum = WAVI_COMPONENT_IDS.reduce((a, id) => a + WAVI_WEIGHTS[id], 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("weights being the source and being the answer above mere recall", () => {
    expect(WAVI_WEIGHTS.citation + WAVI_WEIGHTS.recommendation).toBeCloseTo(0.6, 10);
    expect(WAVI_WEIGHTS.mention).toBeLessThan(WAVI_WEIGHTS.citation);
  });
});

describe("answerProminence", () => {
  it("scores an opening mention far above a buried one", () => {
    const early = answerProminence("DatIQ is a tool. " + "x".repeat(400), "DatIQ");
    const late = answerProminence("x".repeat(400) + " DatIQ is a tool.", "DatIQ");
    expect(early).toBeGreaterThan(90);
    expect(late).toBeLessThan(20);
  });

  it("🔴 is NULL when the brand is absent, never 0", () => {
    // Absence is already counted by MentionRate. Scoring it here too would
    // charge the same absence twice — once as a missing mention, again as poor
    // placement of a mention that never existed.
    expect(answerProminence("Nothing about anyone.", "DatIQ")).toBeNull();
    expect(answerProminence("", "DatIQ")).toBeNull();
    expect(answerProminence("text", "")).toBeNull();
  });

  it("does not penalise a short answer for being short", () => {
    expect(answerProminence("DatIQ.", "DatIQ")).toBe(100);
  });
});

describe("aggregateProminence", () => {
  it("averages the answers that named the brand", () => {
    expect(aggregateProminence([{ prominence: 100 }, { prominence: 50 }])).toBe(75);
  });
  it("is null when none did, and ignores failures", () => {
    expect(aggregateProminence([{ prominence: null }])).toBeNull();
    expect(aggregateProminence([{ error: "boom", prominence: 100 }])).toBeNull();
    expect(aggregateProminence([])).toBeNull();
  });
});

describe("aggregateAccuracy", () => {
  it("scores over the answers we could actually check", () => {
    expect(aggregateAccuracy([
      { misrepresented: false }, { misrepresented: false },
      { misrepresented: true },
    ])).toBeCloseTo(66.7, 1);
  });

  it("🔴 excludes the uncheckable rather than calling it accurate", () => {
    // null is the COMMON case — most pages state no price to check against.
    // Treating it as accurate would hand a full 10% of WAVI to every audit on
    // the strength of a check that never ran.
    expect(aggregateAccuracy([{ misrepresented: null }, { misrepresented: null }])).toBeNull();
    expect(aggregateAccuracy([{ misrepresented: null }, { misrepresented: true }])).toBe(0);
  });
});

describe("computeWavi", () => {
  it("computes the index when every component was measured", () => {
    const w = computeWavi({
      mentionRate: 100, citationRate: 100, recommendationRate: 100,
      prominence: 100, accuracy: 100,
    });
    expect(w.score).toBe(100);
    expect(w.coverage).toBe(100);
  });

  it("🔴 redistributes an unmeasured component instead of scoring it zero", () => {
    // Scoring accuracy 0 on every page with no prices would sink WAVI across
    // the board and then show a phantom recovery the day somebody added a
    // price — the exact fiction the scorer was written to prevent.
    const w = computeWavi({
      mentionRate: 80, citationRate: 80, recommendationRate: 80,
      prominence: 80, accuracy: null,
    });
    expect(w.score).toBe(80);                      // not 72
    expect(w.coverage).toBeCloseTo(90, 5);         // the missing 10% is reported
    expect(w.components.accuracy.measured).toBe(false);
  });

  it("is null with nothing measured at all, never zero", () => {
    const w = computeWavi({});
    expect(w.score).toBeNull();
    expect(w.coverage).toBe(0);
  });

  it("returns every component with its weight, so a UI can explain the number", () => {
    const w = computeWavi({ mentionRate: 50 });
    for (const id of WAVI_COMPONENT_IDS) {
      expect(w.components[id].weight).toBe(WAVI_WEIGHTS[id]);
      expect(w.components[id].label).toBeTruthy();
    }
    expect(w.components.mention.measured).toBe(true);
  });
});

describe("waviFromSample", () => {
  it("is null when no sample was taken", () => {
    expect(waviFromSample(null)).toBeNull();
    expect(waviFromSample({ promptCount: 0 })).toBeNull();
  });

  it("builds the index from a real sample's runs", () => {
    const w = waviFromSample({
      promptCount: 2,
      states: { mentionRate: 100, citationRate: 50, recommendationRate: 50 },
      runs: [
        { prominence: 100, misrepresented: false },
        { prominence: 50, misrepresented: false },
      ],
    });
    expect(w.score).toBeGreaterThan(0);
    expect(w.components.prominence.value).toBe(75);
    expect(w.components.accuracy.value).toBe(100);
  });
});

describe("v3 — the signal, and what it cost", () => {
  it("declares v3", () => {
    expect(SCORING_MODEL_VERSION).toBe("v3");
  });

  it("registers ai_visibility under entity authority", () => {
    expect(SIGNALS.ai_visibility.pillar).toBe("entity_authority");
    expect(SIGNALS.ai_visibility.deterministic).toBe(false);
  });

  it("🔴 SPLITS one weight with the footprint rather than adding on top", () => {
    // WAVI's first two components ARE mention and citation rate. Carrying both
    // signals at full weight would count one body of evidence twice and hand
    // answer-engine visibility 45% of the pillar.
    expect(SIGNALS.ai_visibility.weight + SIGNALS.citation_footprint.weight).toBeCloseTo(0.25, 10);
  });

  it("keeps entity authority's weights summing to exactly 1", () => {
    const sum = Object.values(SIGNALS)
      .filter((s) => s.pillar === "entity_authority")
      .reduce((a, s) => a + s.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});
