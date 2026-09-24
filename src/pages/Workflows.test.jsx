import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Workflows from "./Workflows.jsx";

const mockGraph = {
  nodes: [
    { id: "list-1", stage: "lists", label: "Enterprise ICP", meta: "12 enriched" },
    { id: "wl-1", stage: "watchlists", label: "Tier 1 Competitors", meta: "3 tracked" },
    { id: "rule-1", stage: "rules", label: "High Materiality Alert", meta: "watchlist → slack" },
  ],
  edges: [],
  issues: [],
  counts: { blocking: 0, warning: 0 },
  pipelines: [
    {
      id: "rule-1",
      rule_id: "rule-1",
      name: "Competitor Alert Pipeline",
      health: "healthy",
      health_label: "Healthy",
      trigger_source: "watchlist",
      upstream_stage: "watchlists",
      upstream_summary: "3 competitors in 1 watchlist",
      upstream_items: [
        { id: "wl-1", name: "Tier 1 Competitors", meta: "3 tracked", href: "/watchlists?id=wl-1" }
      ],
      action_type: "slack",
      action_config: { channel: "#intel-signals" },
      execution_count: 5,
      last_execution: { status: "delivered", latency_ms: 240, executed_at: "2026-09-17T12:00:00Z" },
      conditions: [{ field: "materiality", operator: "equals", value: "high" }],
    },
  ],
  recent_executions: [
    { id: "ex-1", rule_id: "rule-1", status: "delivered", latency_ms: 240, executed_at: "2026-09-17T12:00:00Z" }
  ],
};

vi.mock("../components/AuthProvider.jsx", () => ({
  useAuth: () => ({ user: { id: "u-123", email: "user@example.com" }, authLoading: false }),
}));

vi.mock("../lib/workflows/workflowClient.js", () => ({
  getWorkflowGraph: vi.fn(async () => mockGraph),
}));

vi.mock("../lib/rules/rulesClient.js", () => ({
  updateRule: vi.fn(async () => ({ ok: true })),
  deleteRule: vi.fn(async () => ({ ok: true })),
}));

describe("Workflows Page", () => {
  it("renders the page without crashing and displays the templates banner", async () => {
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Workflow Templates Library")).toBeInTheDocument();
    });

    const browseLink = screen.getByRole("link", { name: /browse templates/i });
    expect(browseLink).toBeInTheDocument();
    expect(browseLink.getAttribute("href")).toBe("/templates?filter=workflows");
  });

  it("renders end-to-end pipeline cards with upstream links and execution status", async () => {
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Competitor Alert Pipeline")).toBeInTheDocument();
    });

    // Check upstream item link
    const itemLink = screen.getByRole("link", { name: /Tier 1 Competitors/i });
    expect(itemLink).toBeInTheDocument();
    expect(itemLink.getAttribute("href")).toBe("/watchlists?id=wl-1");

    // Check condition filter
    expect(screen.getByText(/materiality equals high/i)).toBeInTheDocument();

    // Check destination action
    expect(screen.getByText(/Channel: #intel-signals/i)).toBeInTheDocument();
    expect(screen.getByText(/5 executions/i)).toBeInTheDocument();
  });

  it("opens edit and delete modals on pipeline cards", async () => {
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Competitor Alert Pipeline")).toBeInTheDocument();
    });

    // Click Edit
    const editBtn = screen.getByRole("button", { name: /^edit$/i });
    fireEvent.click(editBtn);
    expect(screen.getByRole("heading", { name: /edit workflow/i })).toBeInTheDocument();

    // Close edit modal
    const cancelEditBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelEditBtn);

    // Click Delete
    const deleteBtn = screen.getByTitle("Delete workflow");
    fireEvent.click(deleteBtn);
    expect(screen.getByText(/Delete this rule\?/i)).toBeInTheDocument();
    expect(screen.getByText(/Your lists and watchlists are not affected/i)).toBeInTheDocument();
    expect(screen.getByText(/Audit Trail Preserved:/i)).toBeInTheDocument();
  });

  it("an unconnected row offers Connect a rule, never Delete (it has no rule to delete)", async () => {
    const { getWorkflowGraph } = await import("../lib/workflows/workflowClient.js");
    const { deleteRule } = await import("../lib/rules/rulesClient.js");
    getWorkflowGraph.mockImplementation(async () => ({
      ...mockGraph,
      pipelines: [{
        id: "unconnected-lists", name: "Account Lists (Unconnected)", trigger_source: "bulk_enrichment",
        action_type: "none", action_config: {}, status: "unconnected", health: "disconnected",
        health_label: "No Rule Listening", upstream_stage: "Account Lists", upstream_summary: "2 account lists",
        execution_count: 0, last_execution: null, fix: { label: "Connect a rule", href: "/rules?new=1" },
      }],
    }));
    render(<MemoryRouter><Workflows /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Account Lists (Unconnected)")).toBeInTheDocument());
    expect(screen.queryByTitle("Delete workflow")).toBeNull();
    expect(screen.getByRole("link", { name: /Connect a rule/i }).getAttribute("href")).toBe("/rules?new=1");
    expect(screen.getByRole("link", { name: /Manage lists/i }).getAttribute("href")).toBe("/lists");
    expect(deleteRule).not.toHaveBeenCalled();
    getWorkflowGraph.mockImplementation(async () => mockGraph);
  });
});
