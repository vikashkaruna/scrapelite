// netlify/__tests__/audit/discoverability-monitor.test.js
//
// Tests scheduled regression alert evaluations (Deliverable 4.5).
// Asserts alert triggers on introduced critical issues, score drop regressions,
// threshold adherence, and non-comparable refusal.

import { describe, it, expect } from "vitest";
import { shouldAlert, diffSxoRuns } from "../../functions/discoverability-monitor.js";

describe("Scheduled Discoverability & SXO Regression Monitor (§10 / Deliverable 4.5)", () => {
  it("alerts as regression immediately when a new critical issue is introduced", () => {
    const diff = {
      issues: {
        introduced: [{ code: "SEC_HTTPS_MISSING", severity: "critical" }],
      },
      frameworks: {
        overall: { comparable: true, change: 0 },
      },
    };

    const verdict = shouldAlert(diff, 3);
    expect(verdict.alert).toBe(true);
    expect(verdict.kind).toBe("regression");
    expect(verdict.reason).toContain("SEC_HTTPS_MISSING");
  });

  it("alerts as regression when overall score drops beyond threshold", () => {
    const diff = {
      issues: { introduced: [] },
      frameworks: {
        overall: { comparable: true, change: -5.4 },
      },
    };

    const verdict = shouldAlert(diff, 3);
    expect(verdict.alert).toBe(true);
    expect(verdict.kind).toBe("regression");
    expect(verdict.reason).toContain("fell 5.4 points");
  });

  it("alerts as improvement when overall score rises beyond threshold", () => {
    const diff = {
      issues: { introduced: [] },
      frameworks: {
        overall: { comparable: true, change: 4.2 },
      },
    };

    const verdict = shouldAlert(diff, 3);
    expect(verdict.alert).toBe(true);
    expect(verdict.kind).toBe("improvement");
    expect(verdict.reason).toContain("rose 4.2 points");
  });

  it("does not alert when change is below threshold and no critical issue exists", () => {
    const diff = {
      issues: { introduced: [{ code: "OPT_IMAGE_ALT", severity: "medium" }] },
      frameworks: {
        overall: { comparable: true, change: -1.2 },
      },
    };

    const verdict = shouldAlert(diff, 3);
    expect(verdict.alert).toBe(false);
    expect(verdict.reason).toBe("below the alert threshold");
  });

  it("🔴 refuses to alert when scores are not comparable (measurement gap protection)", () => {
    const diff = {
      issues: { introduced: [] },
      frameworks: {
        overall: { comparable: false, change: null, reason: "not measured in baseline" },
      },
    };

    const verdict = shouldAlert(diff, 3);
    expect(verdict.alert).toBe(false);
    expect(verdict.reason).toBe("scores are not comparable");
  });

  it("alerts on a material SXO regression even when the overall score is stable", () => {
    const verdict = shouldAlert({
      issues: { introduced: [] },
      frameworks: {
        overall: { comparable: true, change: 0.4 },
        sxo: { comparable: true, before: 81, after: 75, change: -6 },
      },
    }, 3);
    expect(verdict).toEqual(expect.objectContaining({ alert: true, kind: "regression" }));
    expect(verdict.reason).toContain("SXO score fell 6 points");
  });

  it("compares SXO only when model and weight set match", () => {
    expect(diffSxoRuns(
      { sxo_total_score: 80, model_version: "s1", weight_set_id: "default" },
      { sxo_total_score: 76.5, model_version: "s1", weight_set_id: "default" },
    )).toEqual({ before: 80, after: 76.5, change: -3.5, comparable: true });

    expect(diffSxoRuns(
      { sxo_total_score: 80, model_version: "s1", weight_set_id: "default" },
      { sxo_total_score: 76.5, model_version: "s2", weight_set_id: "default" },
    )).toEqual(expect.objectContaining({ comparable: false, change: null }));
  });
});
