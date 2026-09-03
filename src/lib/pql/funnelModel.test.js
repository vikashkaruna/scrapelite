import { describe, it, expect } from "vitest";
import { buildPqlFunnel } from "./funnelModel.js";
import { PQL_THRESHOLD, PQL_MAX_POINTS, ACTIVATION_DEFINITIONS } from "./pqlModel.js";

const row = (o = {}) => ({ score: 60, coverage: 0.731, is_pql: true, activated: true, persona: "sales", ...o });

describe("buildPqlFunnel — an invented number is worse than 'no data'", () => {
  it("returns nulls, not zeros, for an empty cohort", () => {
    const f = buildPqlFunnel([]);
    expect(f.total).toBe(0);
    expect(f.activationRate).toBeNull();
    expect(f.pqlRate).toBeNull();
    expect(f.meanScore).toBeNull();
    expect(f.meanCoverage).toBeNull();
  });

  it("survives junk input", () => {
    expect(() => buildPqlFunnel(null)).not.toThrow();
    expect(buildPqlFunnel([null, undefined, 7, "x"]).total).toBe(0);
  });

  // A NULL score means "nothing was measurable". Counting it as 0 invents
  // disengagement out of an instrumentation gap.
  it("excludes unscorable rows from the mean rather than counting them as zero", () => {
    const f = buildPqlFunnel([
      row({ score: 100 }), row({ score: 50 }),
      row({ score: null, coverage: 0, is_pql: false, activated: false }),
    ]);
    expect(f.meanScore).toBe(75);          // not 50
    expect(f.scored).toBe(2);
    expect(f.unscorable).toBe(1);
    expect(f.total).toBe(3);
  });

  // ...but excluding them from the DENOMINATOR of everything would inflate
  // every rate. Each rate states which denominator it used.
  it("rates pqlRate against SCORED and activationRate against TOTAL", () => {
    const f = buildPqlFunnel([
      row({ score: 80, is_pql: true, activated: true }),
      row({ score: 10, is_pql: false, activated: false }),
      row({ score: null, is_pql: false, activated: false }),
    ]);
    expect(f.pqlRate).toBe(0.5);           // 1 of 2 scored
    expect(f.activationRate).toBeCloseTo(0.333, 2); // 1 of 3 total
  });

  it("never hides unscorable accounts", () => {
    const f = buildPqlFunnel([row({ score: null, is_pql: false, activated: false })]);
    expect(f.unscorable).toBe(1);
    expect(f.pqlRate).toBeNull();          // nothing scored → no rate to state
  });

  // Coverage is what lets a reader six months from now tell a real PQL rise
  // from the jump that happens when Phase 4 makes two more signals measurable.
  it("reports mean coverage so a count can be read as a floor, not a measurement", () => {
    const f = buildPqlFunnel([row({ coverage: 0.731 }), row({ coverage: 1 })]);
    // (0.731 + 1) / 2 = 0.8655 → 0.865 at 3dp. Asserted exactly rather than
    // "close to", so a change in the rounding rule is a visible failure.
    expect(f.meanCoverage).toBe(0.865);
  });

  it("defaults a missing coverage to full rather than to zero", () => {
    // A row written before coverage existed is not a zero-coverage row.
    expect(buildPqlFunnel([row({ coverage: undefined })]).meanCoverage).toBe(1);
  });
});

describe("grouping and bands", () => {
  it("groups by the PRD's activation groups, not the app's seven personas", () => {
    const f = buildPqlFunnel([row({ persona: "market-research" }), row({ persona: "founder-vc" })]);
    const vc = f.groups.find((g) => g.key === "vc-analyst");
    // Both app personas map to the same PRD job, and the founder's question is
    // "which JOB activates?", so they aggregate.
    expect(vc.users).toBe(2);
  });

  it("exposes every activation group even at zero users", () => {
    const f = buildPqlFunnel([row({ persona: "sales" })]);
    for (const key of Object.keys(ACTIVATION_DEFINITIONS)) {
      expect(f.groups.some((g) => g.key === key), `missing group ${key}`).toBe(true);
    }
  });

  it("buckets a persona it cannot map, and only shows that bucket when non-empty", () => {
    expect(buildPqlFunnel([row({ persona: "sales" })]).groups.some((g) => g.key === "unknown")).toBe(false);
    const f = buildPqlFunnel([row({ persona: null })]);
    expect(f.groups.find((g) => g.key === "unknown").users).toBe(1);
  });

  it("states a null activation rate for a group with no users", () => {
    const f = buildPqlFunnel([row({ persona: "sales" })]);
    expect(f.groups.find((g) => g.key === "agency").activationRate).toBeNull();
  });

  it("bands relative to the threshold, so a weight change does not re-cut them", () => {
    const f = buildPqlFunnel([
      row({ score: 10 }), row({ score: PQL_THRESHOLD - 1 }),
      row({ score: PQL_THRESHOLD }), row({ score: PQL_THRESHOLD * 2 }),
    ]);
    expect(f.bands).toEqual({ belowHalf: 1, approaching: 1, atThreshold: 1, strong: 1 });
  });

  it("carries the scale so the UI never has to hardcode 130 or 50", () => {
    const f = buildPqlFunnel([]);
    expect(f.threshold).toBe(PQL_THRESHOLD);
    expect(f.maxPoints).toBe(PQL_MAX_POINTS);
  });
});
