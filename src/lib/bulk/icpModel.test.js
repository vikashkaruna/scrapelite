import { describe, it, expect } from "vitest";
import { evaluateIcp } from "./icpModel.js";

describe("icpModel", () => {
  const SAMPLE_RULES = [
    { field: "industry", operator: "in", value: ["Software", "SaaS", "Fintech"], weight: 40 },
    { field: "employee_count", operator: "gte", value: 50, weight: 30 },
    { field: "has_pricing", operator: "equals", value: true, weight: 30 },
  ];

  it("calculates perfect score when all criteria match", () => {
    const fields = {
      industry: "SaaS",
      employee_count: 120,
      has_pricing: true,
    };

    const res = evaluateIcp(fields, SAMPLE_RULES, 60);
    expect(res.score).toBe(100);
    expect(res.rawScore).toBe(100);
    expect(res.coverage).toBe(1.0);
    expect(res.passed).toBe(true);
    expect(res.disqualified).toBe(false);
    expect(res.unmeasuredFields).toHaveLength(0);
  });

  it("implements §1.6 coverage rule: unmeasured signals are NOT scored as 0 and weights are redistributed", () => {
    // Only 2 of 3 rules can be measured (has_pricing is not measured/missing)
    const fields = {
      industry: "SaaS", // passes (weight 40)
      employee_count: 20, // fails (weight 30)
      // has_pricing is undefined/unmeasured (weight 30)
    };

    const res = evaluateIcp(fields, SAMPLE_RULES, 50);

    // Total weight = 100. Measured weight = 70.
    expect(res.totalWeight).toBe(100);
    expect(res.measuredWeight).toBe(70);
    expect(res.coverage).toBe(0.7);
    expect(res.unmeasuredFields).toEqual(["has_pricing"]);

    // Score is 40 / 70 * 100 = 57.14, NOT 40 / 100 = 40!
    expect(res.score).toBe(57.14);
    expect(res.passed).toBe(true); // 57.14 >= threshold of 50
  });

  it("returns null score and zero coverage when nothing could be measured", () => {
    const fields = {};
    const res = evaluateIcp(fields, SAMPLE_RULES, 50);

    expect(res.score).toBeNull();
    expect(res.coverage).toBe(0);
    expect(res.passed).toBe(false);
    expect(res.unmeasuredFields).toHaveLength(3);
  });

  it("disqualifies if a required rule fails even if the threshold score is met", () => {
    const rulesWithRequired = [
      { field: "industry", operator: "equals", value: "Fintech", weight: 60, required: true },
      { field: "employee_count", operator: "gte", value: 10, weight: 40 },
    ];

    const fields = {
      industry: "Healthcare", // Required rule fails!
      employee_count: 500,    // Passes
    };

    const res = evaluateIcp(fields, rulesWithRequired, 30);
    expect(res.score).toBe(40); // 40 >= 30 threshold
    expect(res.disqualified).toBe(true);
    expect(res.passed).toBe(false); // Disqualified!
  });

  it("evaluates various numeric and string operators correctly", () => {
    const rules = [
      { field: "headquarters", operator: "contains", value: "Francisco", weight: 20 },
      { field: "revenue", operator: "gte", value: "$10M", weight: 30 },
      { field: "is_b2c", operator: "equals", value: false, weight: 20 },
      { field: "tagline", operator: "not_empty", weight: 30 },
    ];

    const fields = {
      headquarters: "San Francisco, CA",
      revenue: "$15,000,000",
      is_b2c: false,
      tagline: "The billing platform for developers",
    };

    const res = evaluateIcp(fields, rules, 70);
    expect(res.score).toBe(100);
    expect(res.passed).toBe(true);
  });
});
