import { describe, it, expect } from "vitest";
import {
  SIGNAL_NOISE_FLOOR, TREND_WINDOWS,
  classifyIssues, trendWindow, attributeMovement,
} from "./validationLab.js";
// 🔴 The signal diff comes from auditDiff — there is exactly ONE in this
// codebase, and these tests consume it rather than a second copy.
import { diffAudits } from "./auditDiff.js";
import { SIGNALS } from "./signalRegistry.js";

const someSignal = Object.keys(SIGNALS)[0];
const otherSignal = Object.keys(SIGNALS)[1];

/**
 * The REAL audit shape. `diffAudits` reads signal scores from
 * `pillars[].signals[].score`, not a flat map — a fixture with the wrong shape
 * makes these tests pass or fail for reasons unrelated to what they assert.
 */
const audit = (scores, issues = []) => ({
  issues,
  pillars: {
    [SIGNALS[someSignal].pillar]: {
      signals: Object.entries(scores).map(([code, score]) => ({ code, score })),
    },
  },
});

describe("classifyIssues", () => {
  const issue = (code, signalCode) => ({ code, signalCode });

  it("sorts into the PRD's four buckets", () => {
    const baseline = audit({ [someSignal]: 50, [otherSignal]: 50 }, [issue("AC-01", someSignal), issue("AC-02", otherSignal)]);
    const current = audit({ [someSignal]: 50, [otherSignal]: 50 }, [issue("AC-02", otherSignal), issue("AC-03", someSignal)]);
    const c = classifyIssues(baseline, current, diffAudits(baseline, current).signals);
    expect(c.resolved.map((x) => x.code)).toEqual(["AC-01"]);
    expect(c.introduced.map((x) => x.code)).toEqual(["AC-03"]);
    expect(c.unchangedCount).toBe(1);
    expect(c.regressedCount).toBe(0);
  });

  it("🔴 splits 'still broken' into deteriorating and not", () => {
    // `remaining` conflates a backlog item with something actively getting
    // worse while nobody watches, and only the second is urgent.
    const baseline = audit({ [someSignal]: 60 }, [issue("AC-01", someSignal)]);
    const current = audit({ [someSignal]: 40 }, [issue("AC-01", someSignal)]);
    const c = classifyIssues(baseline, current, diffAudits(baseline, current).signals);
    expect(c.regressed.map((x) => x.code)).toEqual(["AC-01"]);
    expect(c.regressed[0].change).toBe(-20);
    expect(c.unchangedCount).toBe(0);
  });

  it("🔴 an unmeasurable signal is UNCHANGED, never regressed", () => {
    // Calling an outage a regression manufactures urgency, and an operator who
    // chases two of those stops trusting the fourth.
    const baseline = audit({ [someSignal]: 60 }, [issue("AC-01", someSignal)]);
    const current = audit({ [someSignal]: null }, [issue("AC-01", someSignal)]);
    const c = classifyIssues(baseline, current, diffAudits(baseline, current).signals);
    expect(c.regressedCount).toBe(0);
    expect(c.unchanged[0].change).toBeNull();
  });

  it("keeps `remaining` working for existing readers", () => {
    const baseline = audit({ [someSignal]: 60 }, [issue("AC-01", someSignal)]);
    const current = audit({ [someSignal]: 40 }, [issue("AC-01", someSignal)]);
    const c = classifyIssues(baseline, current, diffAudits(baseline, current).signals);
    expect(c.remainingCount).toBe(c.regressedCount + c.unchangedCount);
    expect(c.remaining).toHaveLength(1);
  });
});

describe("trendWindow", () => {
  const now = Date.parse("2026-09-11T00:00:00Z");
  const at = (daysAgo) => ({ at: new Date(now - daysAgo * 86400000).toISOString(), overall: 50 });

  it("offers the three windows the PRD names, plus custom", () => {
    expect(TREND_WINDOWS).toEqual([7, 28, 90]);
    expect(trendWindow([], 45, now).label).toBe("45 days");
  });

  it("keeps only what is inside the window", () => {
    const w = trendWindow([at(1), at(10), at(40)], 28, now);
    expect(w.points).toHaveLength(2);
  });

  it("⚠️ reports what it EXCLUDED, because 'flat' reads differently over 2 points than 30", () => {
    const w = trendWindow([at(1), at(10), at(40), at(100)], 28, now);
    expect(w.excluded).toBe(2);
  });

  it("treats a non-window as all time rather than silently dropping everything", () => {
    const w = trendWindow([at(1), at(400)], 0, now);
    expect(w.points).toHaveLength(2);
    expect(w.label).toBe("All time");
  });
});

describe("attributeMovement", () => {
  const base = "2026-09-01T00:00:00Z";
  const curr = "2026-09-11T00:00:00Z";
  const rec = (over = {}) => ({
    code: "AC-01", title: "Add an answer block", status: "done",
    status_changed_at: "2026-09-05T00:00:00Z", signal_code: someSignal, ...over,
  });
  const diff = (change) => [{
    code: someSignal, label: "S", comparable: change !== null, change,
  }];

  it("🔴 EVERY attribution declares itself a correlation, in the data", () => {
    // Not only in the copy: a consumer that renders the number without the
    // label has to have gone out of its way to drop it.
    const a = attributeMovement({
      recommendations: [rec()], signalDiff: diff(6.1), baselineAt: base, currentAt: curr,
    });
    expect(a.relationship).toBe("correlation");
    for (const x of a.attributions) {
      expect(x.relationship).toBe("correlation");
      expect(x.caveat).toMatch(/not a measurement of what the fix caused/i);
    }
  });

  it("🔴 never claims causation in any field", () => {
    const a = attributeMovement({
      recommendations: [rec()], signalDiff: diff(6.1), baselineAt: base, currentAt: curr,
    });
    const text = JSON.stringify(a);
    expect(text).not.toMatch(/\bcaused by\b|\bbecause of this fix\b|\bresulted in\b/i);
  });

  it("counts only work marked done BETWEEN the two audits", () => {
    const before = rec({ status_changed_at: "2026-08-01T00:00:00Z" });
    const after = rec({ status_changed_at: "2026-09-20T00:00:00Z" });
    const open = rec({ status: "open" });
    const a = attributeMovement({
      recommendations: [before, after, open], signalDiff: diff(5), baselineAt: base, currentAt: curr,
    });
    expect(a.implementedCount).toBe(0);
  });

  it("⚠️ REPORTS a fix followed by a fall rather than hiding it", () => {
    // The most useful row on the screen: either the fix did not do what was
    // expected, or something else regressed underneath it.
    const a = attributeMovement({
      recommendations: [rec()], signalDiff: diff(-8), baselineAt: base, currentAt: curr,
    });
    expect(a.movedDown).toBe(1);
    expect(a.attributions[0].outcome).toBe("moved_down");
  });

  it("separates 'we could not measure it' from 'it did nothing'", () => {
    const a = attributeMovement({
      recommendations: [rec()], signalDiff: diff(null), baselineAt: base, currentAt: curr,
    });
    expect(a.unmeasurable).toBe(1);
    expect(a.flat).toBe(0);
    expect(a.attributions[0].outcome).toBe("unmeasurable");
  });

  it("calls a sub-noise move flat", () => {
    const a = attributeMovement({
      recommendations: [rec()], signalDiff: diff(0.3), baselineAt: base, currentAt: curr,
    });
    expect(a.flat).toBe(1);
  });

  it("survives being called with nothing", () => {
    expect(attributeMovement().implementedCount).toBe(0);
  });
});
