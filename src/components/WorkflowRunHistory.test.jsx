import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import WorkflowRunHistory from "./WorkflowRunHistory.jsx";
import WorkflowRunPreview from "../pages/WorkflowRunPreview.jsx";
import * as api from "../lib/templates/templatesClient.js";

vi.mock("../lib/templates/templatesClient.js", () => ({
  listRuns: vi.fn(),
  getRun: vi.fn(),
}));

const SAMPLE_RUNS = [
  {
    id: "run-abc-12345678",
    template_key: "account_brief",
    template_version: 1,
    status: "complete",
    credits_estimated: 8,
    credits_actual: 8,
    created_at: "2026-09-03T10:00:00.000Z",
    input: { domain: "stripe.com", angle: "discovery" },
    output: {
      title: "Stripe",
      target: "https://stripe.com",
      summary: "Stripe provides financial infrastructure for the internet.",
      talking_points: ["Mention global scale", "Highlight billing APIs"],
      fields: { hq_location: "San Francisco", industry: "Fintech" },
      sources: [{ url: "https://stripe.com", fetched_at: "2026-09-03T10:00:00.000Z" }],
    },
    output_summary: "Stripe provides financial infrastructure for the internet.",
  },
  {
    id: "run-def-87654321",
    template_key: "competitor_pricing_tracker",
    template_version: 1,
    status: "failed",
    error: "Target page unreachable",
    credits_estimated: 7,
    credits_actual: 0,
    created_at: "2026-09-03T11:00:00.000Z",
    input: { domain: "unreachable-site.xyz" },
    output: null,
    output_summary: null,
  },
];

describe("WorkflowRunHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listRuns.mockResolvedValue({ runs: SAMPLE_RUNS });
    api.getRun.mockImplementation((id) => {
      const found = SAMPLE_RUNS.find((r) => r.id === id);
      return Promise.resolve({ run: found });
    });
  });

  it("renders workflow runs and stats", async () => {
    render(
      <MemoryRouter>
        <WorkflowRunHistory />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("stripe.com")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Competitor Pricing Tracker")[0]).toBeInTheDocument();
    expect(screen.getByText("stripe.com")).toBeInTheDocument();
    expect(screen.getByText("unreachable-site.xyz")).toBeInTheDocument();
  });

  it("navigates to WorkflowRunPreview when a run row is clicked", async () => {
    render(
      <MemoryRouter initialEntries={["/dashboard?view=runs"]}>
        <Routes>
          <Route path="/dashboard" element={<WorkflowRunHistory />} />
          <Route path="/workflows/runs/:runId" element={<WorkflowRunPreview />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("stripe.com")).toBeInTheDocument();
    });

    // Click the row or View button
    const row = screen.getByText("stripe.com").closest("tr");
    expect(row).toBeInTheDocument();
    fireEvent.click(row);

    // Verify preview page opened
    await waitFor(() => {
      expect(screen.getByText("Executive Summary")).toBeInTheDocument();
    });

    expect(screen.getByText("Stripe provides financial infrastructure for the internet.")).toBeInTheDocument();
    expect(screen.getByText("Key Talking Points & Insights")).toBeInTheDocument();
    expect(screen.getByText("Mention global scale")).toBeInTheDocument();
  });

  it("displays failed run explanation in preview without billing credits", async () => {
    render(
      <MemoryRouter initialEntries={["/dashboard?view=runs"]}>
        <Routes>
          <Route path="/dashboard" element={<WorkflowRunHistory />} />
          <Route path="/workflows/runs/:runId" element={<WorkflowRunPreview />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("unreachable-site.xyz")).toBeInTheDocument();
    });

    const row = screen.getByText("unreachable-site.xyz").closest("tr");
    fireEvent.click(row);

    await waitFor(() => {
      expect(screen.getByText("Run execution failed")).toBeInTheDocument();
    });

    expect(screen.getByText("Target page unreachable")).toBeInTheDocument();
    expect(screen.getByText("No credits were billed for this failed run.")).toBeInTheDocument();
  });

  it("supports multi-selection and filtering", async () => {
    render(
      <MemoryRouter>
        <WorkflowRunHistory />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("stripe.com")).toBeInTheDocument();
    });

    // Filter by search query
    const searchInput = screen.getByPlaceholderText("Search domain or summary…");
    fireEvent.change(searchInput, { target: { value: "stripe" } });

    expect(screen.getByText("stripe.com")).toBeInTheDocument();
    expect(screen.queryByText("unreachable-site.xyz")).not.toBeInTheDocument();

    // Clear search
    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.getByText("unreachable-site.xyz")).toBeInTheDocument();
  });
});
