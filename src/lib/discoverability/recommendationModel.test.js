import { describe, it, expect } from "vitest";
import {
  estimateLift, computePriorityScore, priorityBand, buildRecommendation,
  rankRecommendations, topRecommendations, groupByOwner, filterByFramework,
  estimateTotalLift, BREADTH_BONUS, EASE_FLOOR, penaltyLift,
  applyDependencies, estimateUnblockedLift, BLOCKER_GATES,
} from "./recommendationModel.js";
import { PENALTIES } from "./scoringModel.js";
import { ISSUES, ISSUE_CODES, SEVERITIES, OWNERS, FRAMEWORK_SCOPES, severityTally } from "./issueCatalog.js";
import { SIGNALS, PILLARS } from "./signalRegistry.js";

describe("issue catalogue integrity", () => {
  it("every issue is fully specified", () => {
    for (const code of ISSUE_CODES) {
      const i = ISSUES[code];
      expect(SEVERITIES, code).toContain(i.severity);
      expect(OWNERS, code).toContain(i.owner);
      expect(PILLARS[i.pillar], code).toBeDefined();
      expect(i.frameworks.length, code).toBeGreaterThan(0);
      for (const f of i.frameworks) expect(FRAMEWORK_SCOPES, `${code} → ${f}`).toContain(f);
      for (const k of ["title", "why", "fix"]) expect(i[k]?.length, `${code}.${k}`).toBeGreaterThan(10);
      for (const k of ["impact", "effort", "confidence"]) {
        expect(i[k], `${code}.${k}`).toBeGreaterThanOrEqual(0);
        expect(i[k], `${code}.${k}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("uses the pillar-prefixed code convention consistently", () => {
    const prefix = {
      answer_clarity: "AC", entity_authority: "EA",
      structural_hierarchy: "SH", technical_accessibility: "TA",
    };
    for (const code of ISSUE_CODES) {
      expect(code, code).toMatch(/^(AC|EA|SH|TA)-\d{2}$/);
      expect(code.split("-")[0]).toBe(prefix[ISSUES[code].pillar]);
    }
  });

  it("has no duplicate codes", () => {
    expect(new Set(ISSUE_CODES).size).toBe(ISSUE_CODES.length);
  });

  it("tallies severities for the dashboard matrix", () => {
    const t = severityTally([{ severity: "critical" }, { severity: "high" }, { severity: "critical" }]);
    expect(t).toEqual({ critical: 2, high: 1, medium: 0, low: 0 });
  });
});

describe("estimateLift — what THIS page can actually recover", () => {
  it("is the unrecovered share of the signal's weight through its pillar", () => {
    // core_web_vitals: 0.30 of a pillar worth 0.25 = 7.5 points at full loss.
    expect(estimateLift("core_web_vitals", 0)).toBe(7.5);
    expect(estimateLift("core_web_vitals", 50)).toBe(3.8);
    expect(estimateLift("core_web_vitals", 100)).toBe(0);
  });

  it("differs per page, which is the point", () => {
    // The same issue on a page already scoring well is worth less work.
    expect(estimateLift("faq_schema_alignment", 20))
      .toBeGreaterThan(estimateLift("faq_schema_alignment", 80));
  });

  it("returns null rather than inventing a lift with no baseline", () => {
    expect(estimateLift("core_web_vitals", null)).toBeNull();
    expect(estimateLift("no_such_signal", 0)).toBeNull();
  });

  it("never exceeds the signal's total possible contribution", () => {
    for (const code of Object.keys(SIGNALS)) {
      const max = 100 * SIGNALS[code].weight * PILLARS[SIGNALS[code].pillar].weight;
      expect(estimateLift(code, 0), code).toBeLessThanOrEqual(Math.round(max * 10) / 10 + 0.05);
    }
  });
});

describe("computePriorityScore", () => {
  it("requires BOTH impact and confidence — either at zero sinks the item", () => {
    expect(computePriorityScore({ impact: 100, confidence: 0, breadth: 3, effort: 0 })).toBe(0);
    expect(computePriorityScore({ impact: 0, confidence: 100, breadth: 3, effort: 0 })).toBe(0);
  });

  it("rewards a fix that helps more than one discipline", () => {
    const base = { impact: 60, confidence: 90, effort: 30 };
    const one = computePriorityScore({ ...base, breadth: 1 });
    const three = computePriorityScore({ ...base, breadth: 3 });
    expect(three).toBeCloseTo(one * (1 + BREADTH_BONUS * 2), 0);
  });

  it("lets effort discount a fix but never bury an emergency", () => {
    // This is the deliberate product choice: ease is a 0.6-1.0 modifier, not a
    // divisor. A certain, critical, expensive fix must still rank high.
    const cheap = computePriorityScore({ impact: 40, confidence: 90, breadth: 1, effort: 0 });
    const dear  = computePriorityScore({ impact: 95, confidence: 99, breadth: 3, effort: 100 });
    expect(dear).toBeGreaterThan(cheap);
    expect(computePriorityScore({ impact: 100, confidence: 100, breadth: 1, effort: 100 }))
      .toBeCloseTo(100 * EASE_FLOOR, 1);
  });

  it("stays inside 0-100 for every input, including hostile ones", () => {
    const vals = [-50, 0, 50, 100, 500, NaN, null, undefined, "80"];
    for (const impact of vals) for (const confidence of vals) for (const effort of vals) {
      for (const breadth of [-1, 0, 1, 3, 99]) {
        const s = computePriorityScore({ impact, confidence, breadth, effort });
        expect(Number.isFinite(s), JSON.stringify({ impact, confidence, breadth, effort })).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });

  it("is deterministic", () => {
    const args = { impact: 63, confidence: 81, breadth: 2, effort: 27 };
    expect(computePriorityScore(args)).toBe(computePriorityScore(args));
  });

  it("bands the score consistently with the label the API returns", () => {
    expect(priorityBand(90)).toBe("high");
    expect(priorityBand(60)).toBe("high");
    expect(priorityBand(59.9)).toBe("medium");
    expect(priorityBand(30)).toBe("medium");
    expect(priorityBand(0)).toBe("low");
    expect(priorityBand(null)).toBe("low");
  });
});

describe("buildRecommendation", () => {
  it("carries the fix, the reason, the owner and the frameworks", () => {
    const r = buildRecommendation("SH-06", { evidence: "6 visible FAQ entries, no FAQPage markup" });
    expect(r.code).toBe("SH-06");
    expect(r.title).toBe(ISSUES["SH-06"].fix);
    expect(r.issueTitle).toBe(ISSUES["SH-06"].title);
    expect(r.rationale).toBe(ISSUES["SH-06"].why);
    expect(r.owner).toBe("seo");
    expect(r.frameworks).toContain("aeo");
    expect(r.evidence).toMatch(/6 visible/);
    expect(r.status).toBe("open");
  });

  it("replaces the generic prior with this page's real recoverable lift", () => {
    const bad  = buildRecommendation("SH-06", { signalCode: "faq_schema_alignment", measuredScore: 0 });
    const good = buildRecommendation("SH-06", { signalCode: "faq_schema_alignment", measuredScore: 90 });
    expect(bad.estimatedLift).toBeGreaterThan(good.estimatedLift);
    expect(bad.priorityScore).toBeGreaterThan(good.priorityScore);
  });

  it("falls back to the catalogue prior when nothing was measured", () => {
    const r = buildRecommendation("SH-06", { signalCode: "faq_schema_alignment", measuredScore: null });
    expect(r.estimatedLift).toBeNull();
    expect(r.impactScore).toBe(ISSUES["SH-06"].impact);
  });

  it("lets a low-confidence reading be marked down", () => {
    // An AI-inferred finding must not outrank a measured one just by sounding
    // certain, so the pipeline can lower confidence per audit.
    const sure   = buildRecommendation("AC-06", { confidenceOverride: 95 });
    const unsure = buildRecommendation("AC-06", { confidenceOverride: 30 });
    expect(unsure.priorityScore).toBeLessThan(sure.priorityScore);
  });

  it("returns null for an unknown issue code instead of throwing", () => {
    expect(buildRecommendation("ZZ-99")).toBeNull();
  });
});

describe("ranking", () => {
  const all = ISSUE_CODES.map((c) => buildRecommendation(c));

  it("puts the cheap, certain emergencies at the very top", () => {
    const top = topRecommendations(all, 3).map((r) => r.code);
    expect(top).toContain("TA-03");   // noindex
    expect(top).toContain("TA-01");   // AI crawlers blocked
  });

  it("keeps an expensive critical fix high rather than burying it", () => {
    const order = rankRecommendations(all).map((r) => r.code);
    // Server-rendering a hydration-only page is a 70-effort job and still
    // belongs in the top quarter of the queue.
    expect(order.indexOf("TA-07")).toBeLessThan(order.length / 4);
  });

  it("sinks the low-impact cosmetics", () => {
    const order = rankRecommendations(all).map((r) => r.code);
    expect(order.indexOf("SH-05")).toBeGreaterThan(order.length * 0.7);
  });

  it("is stable — the same audit never reorders between runs", () => {
    const a = rankRecommendations(all).map((r) => r.code);
    const b = rankRecommendations([...all].reverse()).map((r) => r.code);
    expect(a).toEqual(b);
  });

  it("breaks a priority tie by severity", () => {
    const tied = [
      { code: "X-01", priorityScore: 50, severity: "low" },
      { code: "X-02", priorityScore: 50, severity: "critical" },
    ];
    expect(rankRecommendations(tied)[0].code).toBe("X-02");
  });

  it("groups by owner so work can be assigned", () => {
    const g = groupByOwner(all);
    expect(Object.keys(g).sort()).toEqual(["brand", "content", "engineering", "product", "seo"].filter((o) => g[o]));
    for (const list of Object.values(g)) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i].priorityScore).toBeLessThanOrEqual(list[i - 1].priorityScore);
      }
    }
  });

  it("filters to one framework tab, keeping common items everywhere", () => {
    const geo = filterByFramework(all, "geo");
    expect(geo.length).toBeGreaterThan(0);
    expect(geo.length).toBeLessThan(all.length);
    for (const r of geo) expect(r.frameworks.some((f) => f === "geo" || f === "common")).toBe(true);
    expect(filterByFramework(all, "overall")).toHaveLength(all.length);
  });
});

describe("estimateTotalLift", () => {
  it("sums only the open recommendations with a measured lift", () => {
    const recs = [
      { status: "open",     estimatedLift: 3.5 },
      { status: "open",     estimatedLift: 1.2 },
      { status: "done",     estimatedLift: 9.9 },   // already fixed
      { status: "open",     estimatedLift: null },  // never measured
      { status: "dismissed", estimatedLift: 5 },
    ];
    expect(estimateTotalLift(recs)).toBe(4.7);
  });
  it("is 0, not NaN, for an empty queue", () => {
    expect(estimateTotalLift([])).toBe(0);
    expect(estimateTotalLift()).toBe(0);
  });
});

describe("penaltyLift — pricing the blocker, not just the signal", () => {
  it("values removing a blocker at what the multiplier actually costs", () => {
    // A page scoring 62 BEFORE penalties, carrying only NOINDEX (0.20), is
    // shown 49.6. Clearing it returns the full 62, so the fix is worth 12.4
    // points — against the 6.25 its signal share alone would suggest.
    const lift = penaltyLift("NOINDEX", 62, ["NOINDEX"]);
    expect(lift).toBeCloseTo(12.4, 1);
    expect(lift).toBeGreaterThan(estimateLift("crawl_index_eligibility", 0));
  });

  it("accounts for the blockers that remain", () => {
    // With another blocker still applied the score stays scaled down, so
    // clearing this one releases less.
    const alone = penaltyLift("NOINDEX", 62, ["NOINDEX"]);
    const alongside = penaltyLift("NOINDEX", 62, ["NOINDEX", "CONTENT_HYDRATION_ONLY"]);
    expect(alongside).toBeLessThan(alone);
    expect(alongside).toBeGreaterThan(0);
  });

  it("is zero for a blocker that is not actually applied", () => {
    expect(penaltyLift("NOINDEX", 62, [])).toBe(0);
    expect(penaltyLift("NOINDEX", 62, ["AI_CRAWLER_BLOCKED"])).toBe(0);
  });

  it("is zero for issues that trigger no blocker, and for unknown codes", () => {
    expect(penaltyLift(null, 62, [])).toBe(0);
    expect(penaltyLift("NOT_A_PENALTY", 62, ["NOT_A_PENALTY"])).toBe(0);
    expect(penaltyLift("NOINDEX", null, ["NOINDEX"])).toBe(0);
  });

  // ── The regression this exists to prevent ────────────────────────────────
  it("ranks removing a noindex above content polish on an unindexable page", () => {
    const ctx = { prePenaltyScore: 62, activePenalties: ["NOINDEX", "AI_CRAWLER_BLOCKED"] };
    const noindex = buildRecommendation("TA-03", {
      ...ctx, signalCode: "crawl_index_eligibility", measuredScore: 0,
    });
    const answerBlock = buildRecommendation("AC-01", {
      ...ctx, signalCode: "direct_answer_block", measuredScore: 0,
    });
    // Adding an answer block cannot pay off until the page can be indexed.
    expect(noindex.priorityScore).toBeGreaterThan(answerBlock.priorityScore);
    expect(noindex.blockerLift).toBeGreaterThan(0);
    expect(answerBlock.blockerLift).toBe(0);
  });

  it("reports the two halves of the lift separately, so the report can explain it", () => {
    const r = buildRecommendation("TA-01", {
      signalCode: "crawl_index_eligibility", measuredScore: 0,
      prePenaltyScore: 70, activePenalties: ["AI_CRAWLER_BLOCKED"],
    });
    expect(r.signalLift).toBeGreaterThan(0);
    expect(r.blockerLift).toBeGreaterThan(0);
    expect(r.estimatedLift).toBeCloseTo(r.signalLift + r.blockerLift, 1);
  });

  it("every issue naming a penalty names one that exists", () => {
    for (const code of ISSUE_CODES) {
      const p = ISSUES[code].penalty;
      if (p) expect(Object.keys(PENALTIES), `${code} → ${p}`).toContain(p);
    }
  });
});

describe("dependencies — a fix that cannot pay off yet", () => {
  const shellPage = () => applyDependencies([
    buildRecommendation("TA-07", { signalCode: "render_completeness", measuredScore: 15 }),
    buildRecommendation("AC-01", { signalCode: "direct_answer_block", measuredScore: 0 }),
    buildRecommendation("SH-10", { signalCode: "heading_tree_integrity", measuredScore: 0 }),
    buildRecommendation("EA-01", { signalCode: "schema_identity_completeness", measuredScore: 0 }),
  ], ["CONTENT_HYDRATION_ONLY"]);

  it("marks content fixes as waiting on the hydration blocker", () => {
    const recs = shellPage();
    expect(recs.find((r) => r.code === "AC-01").blockedBy).toBe("TA-07");
    expect(recs.find((r) => r.code === "SH-10").blockedBy).toBe("TA-07");
  });

  it("leaves fixes that DO work on a shell page unblocked", () => {
    // JSON-LD lives in the <head>, which a non-rendering crawler reads. Adding
    // Organization schema genuinely works on a shell page, so gating it would
    // discourage work that pays off immediately.
    expect(shellPage().find((r) => r.code === "EA-01").blockedBy).toBeUndefined();
  });

  it("never marks the blocker as blocked by itself", () => {
    expect(shellPage().find((r) => r.code === "TA-07").blockedBy).toBeUndefined();
  });

  it("sorts every blocked item below the work that unblocks it", () => {
    const order = rankRecommendations(shellPage()).map((r) => r.code);
    expect(order.indexOf("TA-07")).toBeLessThan(order.indexOf("AC-01"));
    expect(order.indexOf("TA-07")).toBeLessThan(order.indexOf("SH-10"));
  });

  it("does nothing when no gating blocker is active", () => {
    const recs = applyDependencies([
      buildRecommendation("AC-01"), buildRecommendation("SH-10"),
    ], ["CANONICAL_TARGET_BROKEN"]);
    // A broken canonical is critical and gates nothing — content work still pays.
    for (const r of recs) expect(r.blockedBy).toBeUndefined();
    expect(applyDependencies([buildRecommendation("AC-01")], [])[0].blockedBy).toBeUndefined();
  });

  it("every gate names a real penalty and a real issue code", () => {
    for (const [penalty, gate] of Object.entries(BLOCKER_GATES)) {
      expect(Object.keys(PENALTIES), penalty).toContain(penalty);
      expect(ISSUE_CODES, gate.code).toContain(gate.code);
      expect(ISSUES[gate.code].penalty, `${gate.code} must be the issue that RAISES ${penalty}`).toBe(penalty);
      expect(gate.pillars.length).toBeGreaterThan(0);
    }
  });

  it("separates the lift available now from the lift waiting on a blocker", () => {
    const recs = shellPage().map((r) => ({ ...r, status: "open" }));
    expect(estimateUnblockedLift(recs)).toBeLessThan(estimateTotalLift(recs));
    expect(estimateUnblockedLift(recs)).toBeGreaterThan(0);
  });
});
