import { describe, it, expect } from "vitest";
import { diffAudits, delta, direction } from "./auditDiff.js";
import { scoreAllPillars, FRAMEWORKS, SCORING_MODEL_VERSION } from "./scoringModel.js";
import { SIGNALS, PILLAR_IDS } from "./signalRegistry.js";

/** A complete-enough audit payload, at a uniform signal value. */
function audit({ value = 70, version = SCORING_MODEL_VERSION, issues = [], penalties = [], id = "a1" } = {}) {
  const values = Object.fromEntries(Object.keys(SIGNALS).map((c) => [c, value]));
  const pillars = scoreAllPillars(values, {});
  const score = value;
  return {
    auditId: id,
    scoringModelVersion: version,
    finalScore: score, seoScore: score, aeoScore: score, geoScore: score,
    frameworks: Object.fromEntries(FRAMEWORKS.map((f) => [f, { score, coverage: 100 }])),
    pillars,
    coverage: 100,
    penaltyMultiplier: 1,
    issues,
    penalties,
    recommendations: [],
    facts: { entity: {} },
  };
}

describe("delta — the honesty flag", () => {
  it("refuses a comparison where either side was not measured", () => {
    expect(delta(null, 70).comparable).toBe(false);
    expect(delta(70, null).comparable).toBe(false);
    expect(delta(null, null).reason).toMatch(/either audit/);
  });

  it("names WHICH side was missing, because the two mean different things", () => {
    expect(delta(null, 70).reason).toMatch(/baseline/);
    expect(delta(70, null).reason).toMatch(/this audit/);
  });

  it("has a dead band so noise is not reported as movement", () => {
    expect(direction(0.3)).toBe("flat");
    expect(direction(-2)).toBe("down");
    expect(direction(null)).toBe("unknown");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W3 — THE CROSS-VERSION GUARD
// ═══════════════════════════════════════════════════════════════════════════
// Adding ENTITY_SCHEMA_INVALID and SEVERE_CWV_FAILURE moves the score of any
// page that trips them. A delta between a v1 baseline and a v2 audit therefore
// contains an unknown amount of "the model changed" mixed into "the page
// changed", and no reader can separate the two.

describe("a cross-version comparison is refused, not annotated", () => {
  const v1 = audit({ value: 60, version: "v1", id: "old" });
  const v2 = audit({ value: 70, version: "v2", id: "new" });

  it("shows no framework delta even though both scores exist", () => {
    // The trap: both numbers are present and subtracting them yields a
    // confident +10 that nobody earned.
    const d = diffAudits(v1, v2);
    for (const f of FRAMEWORKS) {
      expect(d.frameworks[f].comparable, f).toBe(false);
      expect(d.frameworks[f].change, f).toBeNull();
    }
  });

  it("says so in machine-readable form as well as in prose", () => {
    const d = diffAudits(v1, v2);
    expect(d.versionMismatch).toEqual({ baseline: "v1", current: "v2", remedy: "rerun" });
    expect(d.headline).toMatch(/earlier version of the model/i);
    expect(d.caveats[0]).toMatch(/re-run the baseline/i);
  });

  it("refuses pillars, signals, coverage and the penalty multiplier too", () => {
    const d = diffAudits(v1, v2);
    for (const p of PILLAR_IDS) expect(d.pillars[p].comparable, p).toBe(false);
    expect(d.signals.every((s) => !s.comparable)).toBe(true);
    expect(d.coverage.comparable).toBe(false);
    expect(d.penalties.multiplier.comparable).toBe(false);
  });

  it("STILL reports the issue list, because issue codes do not move with the model", () => {
    // Refusing this too would withhold more than the version bump invalidated —
    // and it is the most actionable thing left when the numbers cannot be used.
    const before = audit({ version: "v1", issues: [{ code: "AC-01" }, { code: "SH-02" }] });
    const after = audit({ version: "v2", issues: [{ code: "SH-02" }, { code: "TA-09" }] });
    const d = diffAudits(before, after);
    expect(d.issues.resolved.map((i) => i.code)).toEqual(["AC-01"]);
    expect(d.issues.remaining.map((i) => i.code)).toEqual(["SH-02"]);
    expect(d.issues.introduced.map((i) => i.code)).toEqual(["TA-09"]);
  });

  it("reports NO cleared penalties, because the penalty SET is what changed", () => {
    // A code absent from a v1 baseline may be absent because the page was clean
    // or because the check did not exist yet. "Cleared" would credit a fix
    // nobody made.
    const before = audit({ version: "v1", penalties: [{ code: "NOINDEX" }] });
    const after = audit({ version: "v2", penalties: [] });
    const d = diffAudits(before, after);
    expect(d.penalties.cleared).toEqual([]);
    expect(d.penalties.introduced).toEqual([]);
  });

  it("returns the full shape rather than null, so no consumer throws", () => {
    const d = diffAudits(v1, v2);
    for (const key of ["baselineId", "currentId", "frameworks", "pillars", "signals",
      "issues", "penalties", "coverage", "caveats", "headline", "nextBestActions"]) {
      expect(d, key).toHaveProperty(key);
    }
    expect(d.baselineId).toBe("old");
    expect(d.currentId).toBe("new");
  });

  it("treats a baseline with no recorded version as v1, not as unknown", () => {
    // Rows written before migration 0048 carry no version and WERE scored by
    // v1 — the only model this repo had shipped. Same fallback rehydrate uses.
    const unstamped = audit({ version: undefined, id: "pre-0048" });
    delete unstamped.scoringModelVersion;
    const d = diffAudits(unstamped, audit({ version: "v2" }));
    expect(d.versionMismatch.baseline).toBe("v1");
  });

  it("compares normally when both sides carry the same version", () => {
    const d = diffAudits(audit({ value: 60, version: "v2" }), audit({ value: 70, version: "v2" }));
    expect(d.versionMismatch).toBeUndefined();
    expect(d.frameworks.overall.comparable).toBe(true);
    expect(d.frameworks.overall.change).toBe(10);
  });

  it("compares two unstamped rows with each other", () => {
    // Two pre-0048 audits are both v1 and ARE comparable with one another.
    const a = audit({ value: 60 }); delete a.scoringModelVersion;
    const b = audit({ value: 64 }); delete b.scoringModelVersion;
    const d = diffAudits(a, b);
    expect(d.versionMismatch).toBeUndefined();
    expect(d.frameworks.overall.change).toBe(4);
  });
});
