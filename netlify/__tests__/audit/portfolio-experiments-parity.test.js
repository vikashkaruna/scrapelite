// netlify/__tests__/audit/portfolio-experiments-parity.test.js
//
// Stage 4 (P3C) Parity & Invariant Test Suite:
// Asserts migration 0070 constraints, portfolio rollups along the 9 axes,
// optimization experiments with correlation notices, and API handler execution.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PORTFOLIO_ROLLUP_AXES, calculatePortfolioRollup } from "../../../src/lib/discoverability/portfolioModel.js";
import { PERSONA_PACKS, filterPersonaQueue } from "../../../src/lib/discoverability/personaPacks.js";
import { createExperimentRecord, evaluateExperimentImpact } from "../../../src/lib/discoverability/optimizationExperiments.js";
import { handler } from "../../functions/discoverability.js";
import * as auditStore from "../../functions/lib/audit/auditStore.js";
import * as serverClient from "../../functions/lib/supabaseServerClient.js";

const ROOT = process.cwd();
const RAW_SQL = readFileSync(join(ROOT, "supabase", "migrations", "0070_portfolio_experiments.sql"), "utf8");
const SQL = RAW_SQL.replace(/^\s*--.*$/gm, "");

describe("Migration 0070 Guarantees (§11.14 / Stage 4 parity)", () => {
  it("creates audit_portfolio_rollups and audit_optimization_experiments tables", () => {
    expect(SQL).toMatch(/create table if not exists public\.audit_portfolio_rollups/i);
    expect(SQL).toMatch(/create table if not exists public\.audit_optimization_experiments/i);
  });

  it("locks RLS to service_role and revokes from anon and authenticated", () => {
    expect(SQL).toMatch(/alter table public\.audit_portfolio_rollups enable row level security/i);
    expect(SQL).toMatch(/alter table public\.audit_optimization_experiments enable row level security/i);
    expect(SQL).toMatch(/revoke all on public\.audit_portfolio_rollups from anon, authenticated/i);
    expect(SQL).toMatch(/revoke all on public\.audit_optimization_experiments from anon, authenticated/i);
    expect(SQL).toMatch(/grant select, insert, update, delete on public\.audit_portfolio_rollups to service_role/i);
    expect(SQL).toMatch(/grant select, insert, update, delete on public\.audit_optimization_experiments to service_role/i);
  });

  it("enforces observation_period_days > 0 on experiments", () => {
    expect(SQL).toMatch(/observation_period_days\s+integer\s+not\s+null\s+default\s+28\s+check\s*\(observation_period_days\s*>\s*0\)/i);
  });

  it("enforces the 9 rollup axes constraint in SQL", () => {
    for (const axis of PORTFOLIO_ROLLUP_AXES) {
      expect(SQL).toContain(`'${axis}'`);
    }
  });
});

describe("Stage 4 Domain Invariants", () => {
  it("portfolio model strictly pins the 9 rollup axes", () => {
    expect(PORTFOLIO_ROLLUP_AXES).toHaveLength(9);
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

  it("portfolio rollup produces no data (null) for unaudited subjects, never 0", () => {
    const rollup = calculatePortfolioRollup(
      [{ brand: "Acme", master_score: null, coverage: 0 }],
      "brand"
    );
    expect(rollup.total_audits).toBe(1);
    expect(rollup.unaudited_count).toBe(1);
    const item = rollup.rollups[0];
    expect(item.audit_count).toBe(1);
    expect(item.master_score).toBeNull();
    expect(item.coverage).toBe(0);
    expect(item.status).toBe("no_data");
  });

  it("persona packs provide 7 presentation lenses over recommendationModel", () => {
    expect(Object.keys(PERSONA_PACKS)).toHaveLength(7);
    expect(PERSONA_PACKS.seo).toBeDefined();
    expect(PERSONA_PACKS.cro).toBeDefined();
    expect(PERSONA_PACKS.ux).toBeDefined();

    const queue = [
      { id: "r1", owner: "seo", title: "Add canonical" },
      { id: "r2", owner: "growth_cro", title: "Optimize CTA" },
      { id: "r3", owner: "engineering", title: "Fix LCP" },
    ];
    const croView = filterPersonaQueue(queue, "cro");
    expect(croView.recommendations).toHaveLength(1);
    expect(croView.recommendations[0].id).toBe("r2");
  });

  it("🔴 optimization experiments strictly enforce relationship: 'correlation'", () => {
    const exp = createExperimentRecord({
      experimentName: "Test CTA button",
      expectedMetric: "sxo_total_score",
    });
    expect(exp.relationship).toBe("correlation");
    expect(exp.caveats.some((c) => c.toLowerCase().includes("correlation does not establish causation"))).toBe(true);

    const impact = evaluateExperimentImpact({
      baselineAudit: { final_score: 50 },
      currentAudit: { final_score: 65 },
      targetMetric: "sxo_total_score",
    });
    expect(impact.relationship).toBe("correlation");
    expect(impact.delta).toBe(15);
  });
});

describe("Stage 4 API Handlers Execution", () => {
  const userId = "usr-stage4-test-456";

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(serverClient, "authenticateBearer").mockResolvedValue({
      ok: true,
      user: { id: userId, email: "stage4@datiq.test" },
    });
    vi.spyOn(auditStore, "getRecommendation").mockResolvedValue({ id: "rec-999", user_id: userId });
  });

  it("POST /api/sxo/experiments creates an experiment and returns 200", async () => {
    vi.spyOn(auditStore, "saveOptimizationExperiment").mockResolvedValue({
      ok: true,
      experiment: {
        id: "exp-1",
        experiment_name: "Hero Copy Test",
        relationship: "correlation",
        status: "active",
      },
    });

    const event = {
      httpMethod: "POST",
      path: "/api/sxo/experiments",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({
        experiment_name: "Hero Copy Test",
        expected_metric: "sxo_total_score",
      }),
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.experiment.relationship).toBe("correlation");
  });

  it("GET /api/sxo/experiments lists experiments", async () => {
    vi.spyOn(auditStore, "listOptimizationExperiments").mockResolvedValue([
      { id: "exp-1", experiment_name: "Hero Copy Test" },
    ]);

    const event = {
      httpMethod: "GET",
      path: "/api/sxo/experiments",
      headers: { authorization: "Bearer valid-token" },
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.experiments).toHaveLength(1);
  });

  it("GET /api/sxo/portfolio/rollups lists rollups", async () => {
    vi.spyOn(auditStore, "listPortfolioRollups").mockResolvedValue([
      { id: "roll-1", rollup_axis: "brand", axis_value: "Acme", master_score: 78.5 },
    ]);

    const event = {
      httpMethod: "GET",
      path: "/api/sxo/portfolio/rollups",
      headers: { authorization: "Bearer valid-token" },
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.rollups).toHaveLength(1);
  });

  it("POST /api/sxo/portfolio/rollups calculates only from scoped stored audits", async () => {
    vi.spyOn(auditStore, "listPortfolioAuditInputs").mockResolvedValue([
      {
        id: "aud-stored", page_type: "landing_page",
        result: { final_score: 70, seo_score: 80, aeo_score: 70, geo_score: 60 },
        sxo: { sxo_total_score: 90 },
      },
    ]);
    const save = vi.spyOn(auditStore, "savePortfolioRollup").mockResolvedValue({ ok: true, rollup: {} });

    const res = await handler({
      httpMethod: "POST",
      path: "/api/sxo/portfolio/rollups",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({
        axis: "template",
        audits: [{ template: "forged", master_score: 100, framework_scores: { seo: { score: 100 } } }],
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.rollups).toHaveLength(1);
    expect(body.rollups[0].axis_key).toBe("landing_page");
    expect(body.rollups[0].master_score).toBe(77.5);
    expect(save).toHaveBeenCalledWith(userId, expect.objectContaining({
      rollupAxis: "template", axisValue: "landing_page", masterScore: 77.5,
    }));
  });

  it("POST /api/sxo/recommendations/:id/validate transitions status to validated and warns correlation", async () => {
    vi.spyOn(auditStore, "setRecommendationStatus").mockResolvedValue({
      ok: true,
      recommendation: { id: "rec-999", status: "validated", audit_id: "aud-1" },
    });

    const event = {
      httpMethod: "POST",
      path: "/api/sxo/recommendations/rec-999/validate",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({ reason: "Re-measured in sprint 12" }),
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.recommendation.status).toBe("validated");
    expect(body.relationship).toBe("correlation");
    expect(body.caveats[0]).toContain("correlational");
  });

  it("returns 404 without mutating when an experiment is not in the caller's scope", async () => {
    vi.spyOn(auditStore, "getOptimizationExperiment").mockResolvedValue(null);
    const update = vi.spyOn(auditStore, "updateOptimizationExperiment");
    const res = await handler({
      httpMethod: "POST",
      path: "/api/sxo/experiments/foreign/evaluate",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({ baseline_audit_id: "base", current_audit_id: "current" }),
    });
    expect(res.statusCode).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 404 before validation when a recommendation is out of scope", async () => {
    auditStore.getRecommendation.mockResolvedValue(null);
    const update = vi.spyOn(auditStore, "setRecommendationStatus");
    const res = await handler({
      httpMethod: "POST",
      path: "/api/sxo/recommendations/foreign/validate",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});
