import { describe, it, expect } from "vitest";
import {
  FORM_METRIC_KEYS,
  evaluateFormDiagnostics,
} from "./formDiagnostics.js";

describe("formDiagnostics — 9 per-form metrics and friction flags (Deliverable 3.5)", () => {
  it("defines exactly 9 per-form metrics (§5 / §11.9)", () => {
    expect(FORM_METRIC_KEYS.length).toBe(9);
    expect(FORM_METRIC_KEYS).toEqual([
      "views",
      "starts",
      "submits",
      "completion_rate",
      "abandonment_rate",
      "field_errors",
      "completion_time_sec",
      "device_split",
      "last_field_touched",
    ]);
  });

  it("calculates all 9 metrics accurately", () => {
    const result = evaluateFormDiagnostics({
      views: 500,
      starts: 200,
      submits: 50,
      field_errors: 25,
      completion_time_sec: 45.2,
      device_split: { desktop: 120, mobile: 70, tablet: 10 },
      last_field_touched: { phone_number: 80, company_size: 40 },
    });

    const m = result.metrics;
    expect(m.views).toBe(500);
    expect(m.starts).toBe(200);
    expect(m.submits).toBe(50);
    expect(m.completion_rate).toBe(25); // 50 / 200 = 25%
    expect(m.abandonment_rate).toBe(75); // 150 / 200 = 75%
    expect(m.field_errors).toBe(25);
    expect(m.completion_time_sec).toBe(45.2);
    expect(m.device_split.desktop).toBe(120);
    expect(m.device_split.mobile).toBe(70);
    expect(m.last_field_touched.phone_number).toBe(80);
  });

  it("identifies high abandonment and field bottlenecks", () => {
    const result = evaluateFormDiagnostics({
      views: 1000,
      starts: 100,
      submits: 20,
      field_errors: 50, // 50 / 100 = 0.5 errors per start
      last_field_touched: { ssn_tax_id: 60, address: 20 },
    });

    expect(result.friction_flags).toContain("HIGH_ABANDONMENT_RATE");
    expect(result.friction_flags).toContain("HIGH_VALIDATION_ERRORS");
    expect(result.friction_flags).toContain("FIELD_DROPOFF_BOTTLENECK");

    const bottleneckRec = result.recommendations.find((r) => r.code === "REEXAMINE_BOTTLENECK_FIELD");
    expect(bottleneckRec).toBeDefined();
    expect(bottleneckRec.detail).toContain("ssn_tax_id");
  });
});
