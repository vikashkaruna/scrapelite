// src/pages/admin/AdminAutomation.integration.test.jsx
//
// C-38 — /admin/automation page: renders KPI cards, table, detail panel,
// and the action buttons (retry/cancel/dispatch). Mocks fetch + adminToken.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import AdminAutomation from "./AdminAutomation.jsx";

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Default admin token present
  localStorage.setItem("scrapelite.adminAuth", "test-admin-tok");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const okJson = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const SAMPLE_STATS = {
  byState: { pending: 3, processing: 1, failed: 2, done: 42, cancelled: 5 },
  byKind: { "schedule.changed": 30, "contact.received": 12, "op.alert": 5 },
  last24h: { failed: 2, done: 12, total: 25 },
  avgTimeToDoneMs: 2300,
  last24hTotal: 25,
};

const SAMPLE_EVENTS = [
  {
    id: "wfe_a1",
    kind: "schedule.changed",
    ref_id: "sch_abc",
    user_id: "u1",
    state: "failed",
    attempts: 5,
    max_attempts: 5,
    last_error: "n8n 503: upstream timeout",
    created_at: "2026-07-26T20:00:00Z",
    next_attempt_at: "2026-07-26T20:00:00Z",
  },
  {
    id: "wfe_b2",
    kind: "contact.received",
    ref_id: "ct_xyz",
    user_id: null,
    state: "done",
    attempts: 1,
    max_attempts: 5,
    last_error: null,
    created_at: "2026-07-26T19:00:00Z",
  },
];

function mockInitialLoad() {
  fetchMock.mockResolvedValueOnce(
    okJson({ ok: true, stats: SAMPLE_STATS, events: SAMPLE_EVENTS })
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminAutomation />
    </MemoryRouter>
  );
}

describe("AdminAutomation — initial render", () => {
  it("shows the page title", async () => {
    mockInitialLoad();
    renderPage();
    expect(screen.getByText("Automation")).toBeInTheDocument();
  });

  it("renders the 6 KPI cards with values from /api/admin-automation", async () => {
    mockInitialLoad();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Pending")).toBeInTheDocument();
      expect(screen.getByText("Processing")).toBeInTheDocument();
      expect(screen.getByText("Failed (24h)")).toBeInTheDocument();
      expect(screen.getByText("Done (24h)")).toBeInTheDocument();
      expect(screen.getByText("Avg time-to-done")).toBeInTheDocument();
      expect(screen.getByText("Total (24h)")).toBeInTheDocument();
    });
    await waitFor(() => {
      // Numeric values rendered
      expect(screen.getAllByText("3").length).toBeGreaterThan(0);
      expect(screen.getAllByText("1").length).toBeGreaterThan(0);
      expect(screen.getAllByText("2").length).toBeGreaterThan(0);
      expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    });
  });

  it("renders the by-kind chip strip", async () => {
    mockInitialLoad();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Events by kind")).toBeInTheDocument();
      expect(screen.getAllByText("schedule.changed").length).toBeGreaterThan(0);
    });
  });

  it("renders events in the table", async () => {
    mockInitialLoad();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("sch_abc")).toBeInTheDocument();
    });
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("done").length).toBeGreaterThan(0);
  });

  it("shows the empty-state when no events match the filter", async () => {
    mockInitialLoad();
    renderPage();
    await waitFor(() => screen.getByText("sch_abc"));
    fireEvent.click(screen.getByRole("button", { name: /cancelled/i }));
    expect(screen.getByText(/No events matching "cancelled"/i)).toBeInTheDocument();
  });
});

describe("AdminAutomation — event detail", () => {
  it("clicking a row fetches detail and shows retry/cancel/dispatch buttons", async () => {
    mockInitialLoad();
    // Detail fetch for the failed event
    fetchMock.mockResolvedValueOnce(
      okJson({
        ok: true,
        event: { ...SAMPLE_EVENTS[0], channels: [{ type: "slack", channel: "#monitoring" }] },
        runs: [{ id: "wfr_1", attempt_n: 1, response_status: 503, error: "upstream" }],
      })
    );
    renderPage();
    await waitFor(() => screen.getByText("sch_abc"));
    fireEvent.click(screen.getByText("sch_abc"));
    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
      expect(screen.getByText("Dispatch now")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });
  });

  it("does not show retry button for a 'done' event", async () => {
    mockInitialLoad();
    fetchMock.mockResolvedValueOnce(
      okJson({
        ok: true,
        event: { ...SAMPLE_EVENTS[1] },
        runs: [],
      })
    );
    renderPage();
    await waitFor(() => screen.getByText("ct_xyz"));
    fireEvent.click(screen.getByText("ct_xyz"));
    await waitFor(() => screen.getByText("ct_xyz"));
    // No retry / cancel / dispatch for done events
    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });
});

describe("AdminAutomation — actions", () => {
  it("Retry button calls /api/admin-automation POST with action=retry", async () => {
    mockInitialLoad();
    fetchMock.mockResolvedValueOnce(
      okJson({ ok: true, event: SAMPLE_EVENTS[0], runs: [] })
    );
    renderPage();
    await waitFor(() => screen.getByText("sch_abc"));
    fireEvent.click(screen.getByText("sch_abc"));
    await waitFor(() => screen.getByText("Retry"));

    fetchMock.mockResolvedValueOnce(okJson({ ok: true, event: { ...SAMPLE_EVENTS[0], state: "pending", attempts: 0 } }));
    fetchMock.mockResolvedValueOnce(okJson({ ok: true, stats: SAMPLE_STATS, events: SAMPLE_EVENTS }));

    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      const hasPost = calls.some((c) => c[1]?.method === "POST");
      expect(hasPost).toBe(true);
    });
    const retryCall = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).endsWith("/api/admin-automation") &&
        c[1]?.method === "POST" &&
        JSON.parse(c[1].body).action === "retry"
    );
    expect(retryCall).toBeTruthy();
  });

  it("Run-now button calls POST with action=run-now", async () => {
    mockInitialLoad();
    renderPage();
    await waitFor(() => screen.getByText("Run now"));
    fetchMock.mockResolvedValueOnce(okJson({ ok: true, ran: { scanned: 0 } }));
    fetchMock.mockResolvedValueOnce(okJson({ ok: true, stats: SAMPLE_STATS, events: SAMPLE_EVENTS }));
    fireEvent.click(screen.getByText("Run now"));
    await waitFor(() => {
      const runNowCall = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]).endsWith("/api/admin-automation") &&
          c[1]?.method === "POST" &&
          JSON.parse(c[1].body).action === "run-now"
      );
      expect(runNowCall).toBeTruthy();
    }, { timeout: 3000 });
  });

  it("Refresh button reloads the page", async () => {
    mockInitialLoad();
    renderPage();
    await waitFor(() => screen.getByText("sch_abc"));
    fetchMock.mockResolvedValueOnce(okJson({ ok: true, stats: SAMPLE_STATS, events: [] }));
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => {
      const refreshCalls = fetchMock.mock.calls.filter(
        (c) => String(c[0]).endsWith("/api/admin-automation") && (!c[1]?.method || c[1]?.method === "GET")
      );
      expect(refreshCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("AdminAutomation — error handling", () => {
  it("shows an error banner when the initial load fails", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ ok: false, error: "supabase not configured" }, 503));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/supabase not configured/)).toBeInTheDocument();
    });
  });
});
