import { describe, it, expect } from "vitest";
import {
  PORTFOLIO_ROLLUP_AXES,
  calculatePortfolioRollup,
} from "./portfolioModel.js";

describe("portfolioModel — 9 rollup axes & governance (Deliverable 4.2)", () => {
  it("defines exactly 9 frozen rollup axes (§5 / §11.10)", () => {
    expect(PORTFOLIO_ROLLUP_AXES.length).toBe(9);
    expect(PORTFOLIO_ROLLUP_AXES).toEqual([
      "workspace",
      "brand",
      "business_unit",
      "product_line",
      "service_line",
      "location",
      "market_language",
      "template",
      "owner_team",
    ]);
  });

  it("calculates template rollup with accurate score averages", () => {
    const audits = [
      { template: "pricing", master_score: 80, framework_scores: { seo: { score: 85 }, sxo: { score: 75 } }, coverage: 100 },
      { template: "pricing", master_score: 90, framework_scores: { seo: { score: 95 }, sxo: { score: 85 } }, coverage: 100 },
      { template: "landing_page", master_score: 70, framework_scores: { seo: { score: 70 }, sxo: { score: 70 } }, coverage: 90 },
    ];

    const result = calculatePortfolioRollup(audits, "template");
    expect(result.axis).toBe("template");
    expect(result.total_audits).toBe(3);
    expect(result.rollups.length).toBe(2);

    const pricing = result.rollups.find((r) => r.axis_key === "pricing");
    expect(pricing.audit_count).toBe(2);
    expect(pricing.master_score).toBe(85.0); // (80 + 90) / 2
    expect(pricing.framework_scores.seo).toBe(90.0);
    expect(pricing.framework_scores.sxo).toBe(80.0);
    expect(pricing.status).toBe("scored");
  });

  it("unaudited subjects produce NO DATA (null), NOT ZERO (§11.10)", () => {
    const audits = [
      { template: "case_study", master_score: null, coverage: 0 },
      { template: "case_study", master_score: undefined },
    ];

    const result = calculatePortfolioRollup(audits, "template");
    expect(result.unaudited_count).toBe(2);

    const caseStudy = result.rollups.find((r) => r.axis_key === "case_study");
    expect(caseStudy.master_score).toBeNull();
    expect(caseStudy.status).toBe("no_data");
    expect(caseStudy.coverage).toBe(0);
  });

  it("rolls up across owner_team axis", () => {
    const audits = [
      { owner_team: "growth_cro", master_score: 82.5 },
      { owner_team: "seo", master_score: 75.0 },
    ];

    const result = calculatePortfolioRollup(audits, "owner_team");
    expect(result.rollups.length).toBe(2);
    expect(result.rollups.find((r) => r.axis_key === "growth_cro").master_score).toBe(82.5);
  });
});
