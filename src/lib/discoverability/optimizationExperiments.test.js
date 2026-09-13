import { describe, it, expect } from "vitest";
import {
  EXPERIMENT_STATUSES,
  CORRELATION_CAVEAT,
  createExperimentRecord,
  evaluateExperimentImpact,
} from "./optimizationExperiments.js";

describe("optimizationExperiments — change tracking & correlation invariants (Deliverable 4.4)", () => {
  it("defines standard experiment statuses", () => {
    expect(EXPERIMENT_STATUSES).toEqual(["draft", "active", "completed", "cancelled"]);
  });

  it("creates experiment record with mandatory correlation disclosure", () => {
    const record = createExperimentRecord({
      experiment_name: "Hero CTA Redesign",
      ticket_url: "https://linear.app/datiq/issue/ENG-101",
      expected_metric: "primary_cta_click",
      baseline_value: 120,
    });

    expect(record.experiment_name).toBe("Hero CTA Redesign");
    expect(record.expected_metric).toBe("primary_cta_click");
    expect(record.baseline_value).toBe(120);
    expect(record.relationship).toBe("correlation");
    expect(record.caveat).toBe(CORRELATION_CAVEAT);
  });

  it("evaluates metric movement and labels relationship as correlation", () => {
    const exp = {
      experiment_name: "Hero CTA Redesign",
      expected_metric: "primary_cta_click",
      baseline_value: 100,
    };

    const impact = evaluateExperimentImpact(exp, 100, 135);
    expect(impact.baseline_value).toBe(100);
    expect(impact.current_value).toBe(135);
    expect(impact.delta).toBe(35.0);
    expect(impact.percent_change).toBe(35.0);
    expect(impact.relationship).toBe("correlation");
    expect(impact.caveat).toContain("Correlation does not establish causation");
  });

  it("never claims causation even on positive movement", () => {
    const exp = {
      experiment_name: "Schema Fix",
      expected_metric: "sxo_total_score",
    };
    const impact = evaluateExperimentImpact(exp, 50, 90);
    expect(impact.relationship).not.toBe("causation");
    expect(impact.relationship).toBe("correlation");
  });
});
