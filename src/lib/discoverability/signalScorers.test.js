import { describe, it, expect } from "vitest";
import {
  concisenessScore, answerPositionScore, extractableFormattingScore,
  headingTreeIntegrityScore, singleH1Score,
  cwvMetricScore, coreWebVitalsScore, CWV_THRESHOLDS,
  renderCompletenessScore, contentLossRatio,
  citationFootprintScore, shareOfVoice, freshnessScore,
  IDEAL_ANSWER_MIN, IDEAL_ANSWER_MAX, SKIP_PENALTY, EMPTY_HEADING_PENALTY,
} from "./signalScorers.js";

describe("concisenessScore", () => {
  it("gives full marks across the whole 40-60 word band", () => {
    for (let w = IDEAL_ANSWER_MIN; w <= IDEAL_ANSWER_MAX; w++) {
      expect(concisenessScore(w), `${w} words`).toBe(100);
    }
  });

  it("declines monotonically on both sides of the ideal band", () => {
    const below = [10, 20, 30, 39].map(concisenessScore);
    const above = [61, 100, 150, 200, 400].map(concisenessScore);
    for (let i = 1; i < below.length; i++) expect(below[i]).toBeGreaterThan(below[i - 1]);
    for (let i = 1; i < above.length; i++) expect(above[i]).toBeLessThan(above[i - 1]);
  });

  it("soft-fails a very long answer instead of zeroing it", () => {
    // A 400-word answer is a worse answer, not the absence of one. Scoring it
    // as harshly as an empty page would tell the author to delete, not tighten.
    expect(concisenessScore(400)).toBeGreaterThan(0);
    expect(concisenessScore(400)).toBeLessThan(30);
    expect(concisenessScore(5000)).toBe(10);
  });

  it("scores a measured absence of any answer as a real 0", () => {
    expect(concisenessScore(0)).toBe(0);
  });

  it("returns null when the length was never measured", () => {
    expect(concisenessScore(null)).toBeNull();
    expect(concisenessScore(undefined)).toBeNull();
    expect(concisenessScore(NaN)).toBeNull();
  });
});

describe("answerPositionScore", () => {
  it("rewards answer-first placement and punishes a buried answer", () => {
    expect(answerPositionScore(3)).toBe(100);
    expect(answerPositionScore(90)).toBe(15);
    expect(answerPositionScore(50)).toBeGreaterThan(answerPositionScore(80));
  });
  it("is null when position was not measured", () => {
    expect(answerPositionScore(null)).toBeNull();
  });
});

describe("extractableFormattingScore", () => {
  it("saturates rather than rewarding bullet volume", () => {
    const one = extractableFormattingScore({ lists: 1, tables: 1, listItems: 5 });
    const many = extractableFormattingScore({ lists: 9, tables: 4, listItems: 90 });
    expect(one).toBe(100);
    expect(many).toBe(100);
  });
  it("treats a two-item list as decoration, not structure", () => {
    const thin = extractableFormattingScore({ lists: 1, tables: 0, listItems: 2 });
    const real = extractableFormattingScore({ lists: 1, tables: 0, listItems: 6 });
    expect(thin).toBeLessThan(real);
  });
  it("scores an unformatted wall of prose 0, and unmeasured input null", () => {
    expect(extractableFormattingScore({ lists: 0, tables: 0, listItems: 0 })).toBe(0);
    expect(extractableFormattingScore({ lists: null })).toBeNull();
  });
});

describe("headingTreeIntegrityScore", () => {
  it("gives a clean tree full marks", () => {
    expect(headingTreeIntegrityScore({ skipped: 0, empty: 0, total: 12 })).toBe(100);
  });
  it("charges a skipped level more than an empty heading", () => {
    expect(SKIP_PENALTY).toBeGreaterThan(EMPTY_HEADING_PENALTY);
    const skip = headingTreeIntegrityScore({ skipped: 1, empty: 0, total: 10 });
    const empty = headingTreeIntegrityScore({ skipped: 0, empty: 1, total: 10 });
    expect(skip).toBeLessThan(empty);
  });
  it("floors at 0 rather than going negative on a badly broken tree", () => {
    expect(headingTreeIntegrityScore({ skipped: 20, empty: 20, total: 40 })).toBe(0);
  });
  it("scores a page with no headings 0 — a measured failure of structure", () => {
    expect(headingTreeIntegrityScore({ skipped: 0, empty: 0, total: 0 })).toBe(0);
  });
});

describe("singleH1Score", () => {
  it("rewards exactly one H1", () => {
    expect(singleH1Score({ h1Count: 1 })).toBe(100);
  });
  it("distinguishes no H1 from several", () => {
    // No H1 leaves the page with no declared subject. Several leave a machine
    // choosing between subjects — milder, but still ambiguous.
    expect(singleH1Score({ h1Count: 0 })).toBe(0);
    expect(singleH1Score({ h1Count: 3 })).toBeGreaterThan(0);
    expect(singleH1Score({ h1Count: 3 })).toBeLessThan(100);
  });
  it("caps the score when the H1 and the title disagree about the subject", () => {
    const aligned = singleH1Score({
      h1Count: 1, h1Text: "What is generative engine optimization?",
      titleText: "Generative engine optimization explained | Example",
    });
    const divergent = singleH1Score({
      h1Count: 1, h1Text: "Welcome to our website",
      titleText: "Enterprise kubernetes migration consulting services",
    });
    expect(aligned).toBe(100);
    expect(divergent).toBeLessThanOrEqual(55);
  });
  it("does not punish a page whose title was not captured", () => {
    expect(singleH1Score({ h1Count: 1, h1Text: "Anything", titleText: "" })).toBe(100);
  });
});

describe("Core Web Vitals", () => {
  it("uses the published good/poor thresholds", () => {
    expect(CWV_THRESHOLDS.lcp.good).toBe(2.5);
    expect(CWV_THRESHOLDS.inp.good).toBe(200);
    expect(CWV_THRESHOLDS.cls.good).toBe(0.1);
  });

  it("maps each metric to 100 / 60 / 20 across its bands", () => {
    expect(cwvMetricScore("lcp", 2.4)).toBe(100);
    expect(cwvMetricScore("lcp", 3.0)).toBe(60);
    expect(cwvMetricScore("lcp", 5.0)).toBe(20);
    expect(cwvMetricScore("cls", 0.05)).toBe(100);
    expect(cwvMetricScore("cls", 0.3)).toBe(20);
  });

  it("averages only the metrics that came back", () => {
    // CrUX routinely omits INP for low-traffic URLs. Treating that absence as
    // a failure would punish exactly the small sites this product serves.
    expect(coreWebVitalsScore({ lcp: 2.0, cls: 0.05 })).toBe(100);
    expect(coreWebVitalsScore({ lcp: 2.0, inp: 900, cls: 0.05 })).toBeLessThan(100);
  });

  it("returns null — not 0 — when PageSpeed gave us nothing", () => {
    expect(coreWebVitalsScore({})).toBeNull();
    expect(coreWebVitalsScore()).toBeNull();
    expect(cwvMetricScore("lcp", null)).toBeNull();
  });

  it("ignores a metric name it does not know", () => {
    expect(cwvMetricScore("fid", 50)).toBeNull();
  });
});

describe("renderCompletenessScore", () => {
  it("forgives the small gap that normal client-side enhancement creates", () => {
    expect(renderCompletenessScore({ rawWords: 950, renderedWords: 1000 })).toBe(100);
  });

  it("punishes an SPA shell whose content only exists after hydration", () => {
    expect(renderCompletenessScore({ rawWords: 20, renderedWords: 1000 })).toBe(0);
  });

  it("declines smoothly across the middle", () => {
    const a = renderCompletenessScore({ rawWords: 800, renderedWords: 1000 }); // 20% loss
    const b = renderCompletenessScore({ rawWords: 500, renderedWords: 1000 }); // 50% loss
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
  });

  it("never rewards raw exceeding rendered with a bonus", () => {
    expect(renderCompletenessScore({ rawWords: 2000, renderedWords: 1000 })).toBe(100);
  });

  it("is null when either side could not be counted", () => {
    expect(renderCompletenessScore({ rawWords: 100 })).toBeNull();
    expect(renderCompletenessScore({ rawWords: 100, renderedWords: 0 })).toBeNull();
  });

  it("reports the raw loss ratio as a fact alongside the score", () => {
    expect(contentLossRatio({ rawWords: 500, renderedWords: 1000 })).toBe(0.5);
    expect(contentLossRatio({ rawWords: 1200, renderedWords: 1000 })).toBe(0);
    expect(contentLossRatio({ renderedWords: 0 })).toBeNull();
  });
});

describe("citationFootprintScore", () => {
  it("returns null when no engine sampled anything", () => {
    // The whole reason GEO does not collapse when no sampling key is set: an
    // unsampled brand is unknown, not uncited.
    expect(citationFootprintScore({ prompts: 0 })).toBeNull();
    expect(citationFootprintScore({})).toBeNull();
  });

  it("scores a genuinely uncited brand 0 once sampling actually ran", () => {
    expect(citationFootprintScore({ prompts: 20, mentions: 0, citations: 0 })).toBe(0);
  });

  it("weights a citation above a mere mention", () => {
    const mentioned = citationFootprintScore({ prompts: 20, mentions: 10, citations: 0 });
    const cited     = citationFootprintScore({ prompts: 20, mentions: 0,  citations: 10 });
    expect(cited).toBeGreaterThan(mentioned);
  });

  it("uses diminishing returns so early progress is visible", () => {
    // Linear scoring would rate a brand cited in 4 of 20 prompts at 20 and tell
    // a successful author they had failed.
    const modest = citationFootprintScore({ prompts: 20, mentions: 7, citations: 4, sentiment: 0.86 });
    expect(modest).toBeGreaterThan(40);
    expect(modest).toBeLessThan(60);
    // The second half of the journey is worth less than the first.
    const firstHalf  = citationFootprintScore({ prompts: 20, mentions: 0, citations: 10 });
    const secondHalf = citationFootprintScore({ prompts: 20, mentions: 0, citations: 20 })
                     - citationFootprintScore({ prompts: 20, mentions: 0, citations: 10 });
    expect(firstHalf).toBeGreaterThan(secondHalf);
  });

  it("lets sentiment modulate but never dominate", () => {
    // Being cited negatively still beats not being cited at all, so sentiment
    // must never scale the score toward zero.
    const positive = citationFootprintScore({ prompts: 20, citations: 10, sentiment: 1 });
    const negative = citationFootprintScore({ prompts: 20, citations: 10, sentiment: 0 });
    expect(negative).toBeGreaterThan(positive * 0.65);
    expect(negative).toBeLessThan(positive);
  });

  it("caps at 100 even when every prompt cites the brand", () => {
    expect(citationFootprintScore({ prompts: 5, mentions: 50, citations: 50, sentiment: 1 })).toBe(100);
  });

  it("reports share of voice as a fact", () => {
    expect(shareOfVoice({ prompts: 20, citations: 4 })).toBe(0.2);
    expect(shareOfVoice({ prompts: 0 })).toBeNull();
  });
});

describe("freshnessScore", () => {
  it("rewards a recent, sourced page", () => {
    expect(freshnessScore({ ageDays: 30, hasVisibleDate: true, hasSourceLinks: true })).toBe(100);
  });
  it("treats no date at all as worse than an old one", () => {
    const undated = freshnessScore({ hasVisibleDate: false, hasSourceLinks: true });
    const old     = freshnessScore({ ageDays: 1000, hasVisibleDate: true, hasSourceLinks: true });
    expect(undated).toBeLessThan(old);
  });
  it("deducts for claims with no attribution", () => {
    const sourced   = freshnessScore({ ageDays: 30, hasVisibleDate: true, hasSourceLinks: true });
    const unsourced = freshnessScore({ ageDays: 30, hasVisibleDate: true, hasSourceLinks: false });
    expect(unsourced).toBeLessThan(sourced);
  });
  it("stays inside 0-100", () => {
    for (const age of [0, 89, 90, 364, 366, 5000]) {
      for (const src of [true, false]) {
        const s = freshnessScore({ ageDays: age, hasVisibleDate: true, hasSourceLinks: src });
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });
});
