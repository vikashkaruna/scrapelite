import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import WorkflowRunHistory from "./WorkflowRunHistory.jsx";
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

  it("opens WorkflowRunModal when a run row is clicked", async () => {
    render(
      <MemoryRouter>
        <WorkflowRunHistory />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("stripe.com")).toBeInTheDocument();
    });

    // Click the first run row
    const row = screen.getByText("stripe.com").closest("li");
    expect(row).toBeInTheDocument();
    fireEvent.click(row);

    // Verify modal is opened
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Stripe provides financial infrastructure for the internet.")[0]).toBeInTheDocument();
    expect(screen.getByText("Talking Points")).toBeInTheDocument();
    expect(screen.getByText("Mention global scale")).toBeInTheDocument();

    // Close modal
    const closeBtn = screen.getAllByRole("button", { name: "Close" })[0];
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("displays failed run explanation in modal without billing credits", async () => {
    render(
      <MemoryRouter>
        <WorkflowRunHistory />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("unreachable-site.xyz")).toBeInTheDocument();
    });

    const row = screen.getByText("unreachable-site.xyz").closest("li");
    fireEvent.click(row);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    expect(screen.getByText("Run failed")).toBeInTheDocument();
    expect(screen.getByText("Target page unreachable")).toBeInTheDocument();
    expect(screen.getByText("No credits were billed for this failed run.")).toBeInTheDocument();
  });
});
