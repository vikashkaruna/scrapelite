import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import WorkflowRunPreview from "./WorkflowRunPreview.jsx";
import * as api from "../lib/templates/templatesClient.js";

vi.mock("../lib/templates/templatesClient.js", () => ({
  getRun: vi.fn(),
}));

const SAMPLE_RUN = {
  id: "run-123",
  template_key: "competitor_tracker",
  status: "succeeded",
  credits_charged: 2,
  created_at: "2026-09-08T12:00:00Z",
  input: { domain: "stripe.com" },
  output: {
    summary: "Stripe launched a new pricing model with reduced transaction fees.",
    facts: [
      { key: "starter_price", label: "Starter Price", value: "$49/mo" },
      { key: "enterprise", label: "Enterprise Tier", value: "Custom" },
    ],
    talking_points: [
      "Stripe updated transaction fees for micro-payments.",
    ],
  },
};

function renderPreview(runId = "run-123", initialRun = null) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/workflows/runs/${runId}`, state: initialRun ? { run: initialRun } : undefined }]}>
      <Routes>
        <Route path="/workflows/runs/:runId" element={<WorkflowRunPreview />} />
        <Route path="/dashboard" element={<div>Dashboard Page</div>} />
        <Route path="/templates" element={<div>Templates Page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("WorkflowRunPreview page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("loads and displays workflow run details from API", async () => {
    api.getRun.mockResolvedValueOnce({ ok: true, run: SAMPLE_RUN });

    renderPreview("run-123");

    expect(screen.getByText(/Loading workflow run details/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Competitor Tracker/i)).toBeInTheDocument();
    });

    expect(screen.getByText("stripe.com")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText(/2 cr/i)).toBeInTheDocument();
    expect(screen.getByText(/Stripe launched a new pricing model/i)).toBeInTheDocument();
    expect(screen.getByText("Starter Price")).toBeInTheDocument();
    expect(screen.getByText("$49/mo")).toBeInTheDocument();
  });

  it("renders immediately from navigation state without loading spinner", () => {
    api.getRun.mockResolvedValueOnce({ ok: true, run: SAMPLE_RUN });
    renderPreview("run-123", SAMPLE_RUN);

    expect(screen.queryByText(/Loading workflow run details/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Competitor Tracker/i)).toBeInTheDocument();
    expect(screen.getByText("stripe.com")).toBeInTheDocument();
  });

  it("renders error state when API fails to load run", async () => {
    api.getRun.mockRejectedValueOnce(new Error("Network timeout"));

    renderPreview("run-999");

    await waitFor(() => {
      expect(screen.getByText(/Network timeout/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Back to Workflow Runs/i)).toBeInTheDocument();
  });
});
