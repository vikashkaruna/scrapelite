// SxoDashboard.test.jsx — §11.15 SXO & Outcomes Dashboard test suite.
// Asserts the 6 regions, overlap disclosure, 9-stage funnel, persona filtering,
// and experiment correlation notice.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SxoDashboard from "./SxoDashboard.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";

// Mock Toast provider hook
vi.mock("../Toast.jsx", () => ({
  useToast: () => vi.fn(),
}));

describe("SxoDashboard (§11.15 / Deliverable 4.8)", () => {
  const auditFixture = {
    auditId: "aud-test-101",
    result: {
      final_score: 72,
      framework_scores: {
        seo: { score: 75.0 },
        aeo: { score: 70.0 },
        geo: { score: 68.0 },
      },
    },
    recommendations: [
      { id: "rec-1", code: "SEO_META", title: "Add meta tags", owner: "seo", impact: "high" },
      { id: "rec-2", code: "CRO_CTA", title: "Improve CTA prominence", owner: "growth_cro", impact: "high" },
      { id: "rec-3", code: "UX_LCP", title: "Optimize LCP image", owner: "engineering", impact: "medium" },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(discoverability, "listSxoRuns").mockResolvedValue({
      runs: [{
        id: "sxo-1",
        sxo_total_score: 80.0,
        coverage: 100,
        layer_scores: { td: 85, ic: 80, ux: 75, ia: 82, cd: 78, mi: 70 },
        findings: [{ message: "Generic hero without category" }],
      }],
    });
    vi.spyOn(discoverability, "listSxoIntegrations").mockResolvedValue({ connections: [] });
    vi.spyOn(discoverability, "listSxoConversionGoals").mockResolvedValue({ goals: [] });

    vi.spyOn(discoverability, "sxoJourney").mockResolvedValue({
      funnel: {
        overall_conversion_rate: 3.5,
        mi_score: 80,
        mi_caveats: ["Only 4 of 9 stages currently instrumented."],
        stage_results: [
          { key: "search_impression", measured: false },
          { key: "landing_session", measured: true, count: 10000, drop_off_rate_from_previous_measured: 0 },
          { key: "engaged_session", measured: true, count: 6000, drop_off_rate_from_previous_measured: 40 },
          { key: "key_content_seen", measured: false },
          { key: "primary_cta_view", measured: false },
          { key: "primary_cta_click", measured: true, count: 1200, drop_off_rate_from_previous_measured: 80 },
          { key: "action_start", measured: false },
          { key: "conversion_complete", measured: true, count: 350, drop_off_rate_from_previous_measured: 70.8 },
          { key: "qualified_outcome", measured: false },
        ],
      },
    });

    vi.spyOn(discoverability, "sxoFormDiagnostics").mockResolvedValue({
      diagnostics: {
        metrics: { views: 5000, starts: 2000, completion_rate: 65, abandonment_rate: 35, field_errors: 120 },
      },
    });

    vi.spyOn(discoverability, "listSxoExperiments").mockResolvedValue({
      experiments: [
        { id: "exp-1", experiment_name: "Hero Copy Test", status: "active", relationship: "correlation" },
      ],
    });

    vi.spyOn(discoverability, "getSxoPortfolioRollups").mockResolvedValue({
      rollups: [
        { axis_value: "SaaS Pricing", audit_count: 5, master_score: 78.4, coverage: 95 },
      ],
    });
  });

  it("renders Region 1: Master card, frameworks, lead delta, and mandatory overlap disclosure", async () => {
    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} />);

    expect(screen.getByText("Search Experience & Master Composite")).toBeInTheDocument();
    expect(screen.getByText(/Methodology & Overlap Disclosure:/)).toBeInTheDocument();
    expect(screen.getByText(/Master score weights include: SEO 0.25, AEO 0.20, GEO 0.20, SXO 0.35/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("SXO (0.35)")).toBeInTheDocument();
      expect(screen.getAllByText("80").length).toBeGreaterThan(0);
    });
  });

  it("renders Region 2: Six SXO architecture layers with weight percentages", async () => {
    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} />);

    expect(screen.getByText("Six SXO Architecture Layers")).toBeInTheDocument();
    expect(screen.getByText("Technical Discoverability")).toBeInTheDocument();
    expect(screen.getByText("Intent-Aligned Content")).toBeInTheDocument();
    expect(screen.getByText("Fast, Low-Friction Experience")).toBeInTheDocument();
    expect(screen.getByText("Information Architecture & First Screen")).toBeInTheDocument();
    expect(screen.getByText("Conversion Design")).toBeInTheDocument();
    expect(screen.getByText("Measurement & Iteration")).toBeInTheDocument();
  });

  it("renders Region 3: 9-Stage journey funnel with uninstrumented exclusion discipline", async () => {
    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} />);

    expect(screen.getByText("9-Stage Search-to-Outcome Funnel")).toBeInTheDocument();
    await waitFor(() => {
      // Uninstrumented stages are clearly marked and excluded
      const uninstrumented = screen.getAllByText("Uninstrumented (excluded)");
      expect(uninstrumented.length).toBeGreaterThan(0);
      // Measured stages render counts
      expect(screen.getByText("10,000")).toBeInTheDocument();
    });
  });

  it("renders Region 4: Form diagnostics and friction flags", async () => {
    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} />);

    expect(screen.getByText("Top Friction & Form Diagnostics")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Form Views")).toBeInTheDocument();
      expect(screen.getByText("5,000")).toBeInTheDocument();
      expect(screen.getByText("65%")).toBeInTheDocument();
      expect(screen.getByText("Generic hero without category")).toBeInTheDocument();
    });
  });

  it("renders Region 5: Portfolio performance rollups across axes", async () => {
    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} />);

    expect(screen.getByText("Portfolio Performance Rollups")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("SaaS Pricing")).toBeInTheDocument();
      expect(screen.getByText("78.4")).toBeInTheDocument();
    });
  });

  it("renders Region 6: Persona action filtering, validation, and mandatory correlation notice", async () => {
    const validateSpy = vi.spyOn(discoverability, "validateSxoRecommendation").mockResolvedValue({
      ok: true,
      recommendation: { id: "rec-2", status: "validated" },
      relationship: "correlation",
    });

    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} />);

    expect(screen.getByText("Persona Actions & Experiment Validation")).toBeInTheDocument();
    expect(screen.getByText(/Experiment Notice:/)).toBeInTheDocument();
    expect(screen.getByText(/Correlation does not establish causation/)).toBeInTheDocument();

    // Persona filter switches queue
    const croBtn = screen.getByRole("button", { name: /Conversion Rate Optimizer/i });
    fireEvent.click(croBtn);

    expect(screen.getByText("Improve CTA prominence")).toBeInTheDocument();
    expect(screen.queryByText("Add meta tags")).not.toBeInTheDocument();

    // Validate recommendation button
    const validateBtn = screen.getByRole("button", { name: "Validate Change" });
    fireEvent.click(validateBtn);

    expect(validateSpy).toHaveBeenCalledWith("rec-2", expect.objectContaining({
      reason: "Validated via SXO outcome testing",
    }));
  });

  it("renders Region 7: Analytics Data Governance & Early Deletion (D16)", async () => {
    const purgeSpy = vi.spyOn(discoverability, "purgeSxoAnalyticsData").mockResolvedValue({
      ok: true,
      purged: true,
      deleted: { total: 10 },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} />);

    expect(screen.getByText("Analytics Data Governance & Early Deletion")).toBeInTheDocument();
    expect(screen.getByText(/default 90-day retention window/)).toBeInTheDocument();

    const purgeSelect = screen.getByLabelText("Early deletion retention threshold");
    fireEvent.change(purgeSelect, { target: { value: "14" } });

    const purgeBtn = screen.getByRole("button", { name: "Purge Data" });
    fireEvent.click(purgeBtn);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(purgeSpy).toHaveBeenCalledWith(expect.objectContaining({
        older_than_days: 14,
        purge_all: false,
        audit_id: "aud-test-101",
      }));
    });
  });

  it("does not invent a qualified-lead delta when no measured delta exists", async () => {
    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} />);
    expect(screen.getByText("Lead Delta")).toBeInTheDocument();
    expect(screen.getByText("Not measured")).toBeInTheDocument();
    expect(screen.queryByText("Est. +14%")).not.toBeInTheDocument();
  });

  it("wires analytics credential storage, aggregate import, and conversion goals to production client methods", async () => {
    const connectSpy = vi.spyOn(discoverability, "connectSxoIntegration").mockResolvedValue({ ok: true });
    const importSpy = vi.spyOn(discoverability, "importSxoEvents").mockResolvedValue({ ok: true, queued: true });
    const goalSpy = vi.spyOn(discoverability, "saveSxoConversionGoal").mockResolvedValue({ ok: true });
    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} workspaceId="ws-1" />);

    fireEvent.change(screen.getByLabelText("GA4 property ID"), { target: { value: "properties/123" } });
    fireEvent.change(screen.getByLabelText("API credential"), { target: { value: "secret-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Encrypt & save" }));
    await waitFor(() => expect(connectSpy).toHaveBeenCalledWith("ga4", expect.objectContaining({
      provider_account_id: "properties/123", workspace_id: "ws-1",
    })));

    fireEvent.change(screen.getByLabelText("Page views"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue aggregate import" }));
    await waitFor(() => expect(importSpy).toHaveBeenCalledWith(expect.objectContaining({
      audit_id: "aud-test-101", workspace_id: "ws-1",
      events: [{ event_name: "page_view", count: 42 }],
    })));

    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "Qualified demo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    await waitFor(() => expect(goalSpy).toHaveBeenCalledWith(expect.objectContaining({
      audit_id: "aud-test-101", workspace_id: "ws-1", name: "Qualified demo", outcome_type: "lead",
    })));
  });

  it("provides Section A and Section B subnavigation switching", async () => {
    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} />);

    const archTab = screen.getByRole("tab", { name: /SXO & Journey Architecture/i });
    const portTab = screen.getByRole("tab", { name: /Validating SXO & Portfolio/i });
    const allTab = screen.getByRole("tab", { name: /All Overview/i });

    expect(archTab).toBeInTheDocument();
    expect(portTab).toBeInTheDocument();
    expect(allTab).toBeInTheDocument();

    fireEvent.click(archTab);
    expect(archTab).toHaveAttribute("aria-selected", "true");

    fireEvent.click(portTab);
    expect(portTab).toHaveAttribute("aria-selected", "true");

    fireEvent.click(allTab);
    expect(allTab).toHaveAttribute("aria-selected", "true");
  });

  it("opens interactive funnel configuration and applies sample data", async () => {
    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} />);

    const configBtn = screen.getByRole("button", { name: /Configure Funnel/i });
    fireEvent.click(configBtn);

    expect(screen.getByText("Interactive Funnel Configuration & Calibration")).toBeInTheDocument();

    const sampleBtn = screen.getByRole("button", { name: /Load Sample B2B Funnel/i });
    fireEvent.click(sampleBtn);

    const applyBtn = screen.getByRole("button", { name: /Apply & Recalculate Funnel/i });
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(screen.getByText("25,000")).toBeInTheDocument();
    });
  });

  it("re-calculates portfolio rollups when Re-calculate Rollup button is clicked", async () => {
    const rollupSpy = vi.spyOn(discoverability, "getSxoPortfolioRollups").mockResolvedValue({
      rollups: [{ axis_value: "Recalculated Segment", audit_count: 8, master_score: 82.5, coverage: 98 }],
    });

    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} workspaceId="ws-1" />);

    const recalcBtn = screen.getByRole("button", { name: /Re-calculate Rollup/i });
    fireEvent.click(recalcBtn);

    await waitFor(() => {
      expect(rollupSpy).toHaveBeenCalledWith(expect.objectContaining({
        axis: "template",
        workspace_id: "ws-1",
      }));
      expect(screen.getByText("Recalculated Segment")).toBeInTheDocument();
    });
  });

  it("displays measured Lead Delta when qualified_outcome_delta is present", async () => {
    vi.spyOn(discoverability, "sxoJourney").mockResolvedValue({
      funnel: {
        qualified_outcome_delta: 14.8,
        overall_conversion_rate: 4.2,
        stage_results: [],
      },
    });

    render(<SxoDashboard auditId="aud-test-101" fullAudit={auditFixture} />);

    await waitFor(() => {
      expect(screen.getByText("+14.8%")).toBeInTheDocument();
      expect(screen.getByText("vs baseline audit")).toBeInTheDocument();
    });
  });
});
