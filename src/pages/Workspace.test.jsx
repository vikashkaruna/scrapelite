// src/pages/Workspace.test.jsx — Q4 (logged-in → workspace) integration tests.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

const usageRepoMocks = vi.hoisted(() => ({
  fetchUsageFromDb: vi.fn(() => Promise.resolve(null)),
  fetchSubscriptionFromDb: vi.fn(() => Promise.resolve(null)),
  fetchPaymentHistory: vi.fn(() => Promise.resolve([])),
  syncUsageToDb: vi.fn(() => Promise.resolve()),
  syncSubscriptionToDb: vi.fn(() => Promise.resolve()),
  logPaymentEvent: vi.fn(() => Promise.resolve()),
  getSessionId: vi.fn(() => "sess_test"),
}));

const apiMocks = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  upsertSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  listExtractions: vi.fn(),
}));

vi.mock("../lib/apiClient.js", async () => {
  const actual = await vi.importActual("../lib/apiClient.js");
  return {
    ...actual,
    setAuthToken: vi.fn(),
    // Replace the apiClient object itself (not just add top-level
    // listExtractions, which would shadow nothing — extractionsRepo.js
    // imports `apiClient` and calls apiClient.listExtractions on it).
    apiClient: {
      ...actual.apiClient,
      listSchedules: apiMocks.listSchedules,
      listExtractions: apiMocks.listExtractions,
      upsertSchedule: apiMocks.upsertSchedule,
      deleteSchedule: apiMocks.deleteSchedule,
    },
  };
});
vi.mock("../lib/supabaseClient.js", () => ({
  supabase: null,
  isSupabaseEnabled: false,
  EXTRACTIONS_TABLE: "extractions",
}));
vi.mock("../lib/authService.js", async () => {
  // Replace the whole module so our getSession / onAuthStateChange stubs run
  // BEFORE the early-return `if (!supabase) return ...` check. The real
  // module short-circuits when supabase is null, so importActual+spread
  // never reaches our overrides.
  const actual = await vi.importActual("../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
    getUserInitials: () => "QA",
    getUserAvatar: () => null,
    getUserDisplayName: (u) => u?.email?.split("@")[0] || "QA",
  };
});
vi.mock("../lib/usageRepo.js", () => usageRepoMocks);
vi.mock("../lib/paymentRepo.js", () => usageRepoMocks);

import { AppProviders } from "../__tests__/harness/AppProviders.jsx";
import Workspace from "./Workspace.jsx";
import WorkspaceRedirect from "../components/WorkspaceRedirect.jsx";

function setAuthMock(withUser) {
  if (withUser) {
    // getSession() returns the SESSION directly (not wrapped). The real
    // authService.js does `const { data: { session } } = await supabase.auth.getSession(); return session;`
    authMocks.getSession.mockResolvedValue({
      user: { id: "u_1", email: "qa@example.com", user_metadata: { name: "QA" } },
      access_token: "tkn",
    });
  } else {
    authMocks.getSession.mockResolvedValue(null);
  }
  // onAuthStateChange must return an unsubscribe FUNCTION (the real
  // authService.js returns () => subscription.unsubscribe()).
  authMocks.onAuthStateChange.mockImplementation((_cb) => {
    return () => {};
  });
}

function renderWorkspace(initialEntries = ["/workspace"], withUser = false) {
  setAuthMock(withUser);
  return render(
    <AppProviders initialEntries={initialEntries}>
      <Routes>
        <Route path="/workspace" element={<WorkspaceRedirect><Workspace /></WorkspaceRedirect>} />
      </Routes>
    </AppProviders>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.clear(); } catch {}
  // Default: apiClient returns empty list. Tests that need schedules
  // override this.
  apiMocks.listSchedules.mockResolvedValue([]);
  apiMocks.listExtractions.mockResolvedValue([]);
});

describe("Q4 — /workspace route (WorkspaceRedirect wrapper)", () => {
  it("renders a marketing teaser for logged-out users (no Dashboard cards)", () => {
    renderWorkspace();
    expect(screen.getByText(/Your workspace, once you sign in\./i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Recent extractions/i })).toBeNull();
  });

  it("teaser offers both Sign in and Create account CTAs", () => {
    renderWorkspace();
    expect(screen.getByRole("button", { name: /Create a free account/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in/i })).toBeInTheDocument();
  });
});

describe("Q4 — Workspace page when signed in", () => {
  it("renders greeting, quick actions, recent extractions, and usage for signed-in users", async () => {
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
    expect(screen.getAllByText("New extraction").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Batch run").length).toBeGreaterThanOrEqual(1);
    // The Collections tab is a tab now, not a quick-link — the Overview
    // card grid includes a Collections summary card with a "Collections"
    // heading. We assert the heading rather than the old quick-link.
    expect(screen.getByRole("heading", { name: /^Collections$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Recent extractions/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Recent batch runs/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Active schedules/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /This month/i })).toBeInTheDocument();
  });

  it("the free-plan pill is shown when no subscription is set", async () => {
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    expect(screen.getByText(/Free plan/i)).toBeInTheDocument();
  });

  it("lists an active schedule by label and cadence (regression: listSchedules() is async and must be awaited)", async () => {
    localStorage.setItem("datiq.schedules", JSON.stringify([{
      id: "sch_test1",
      type: "track",
      target: "https://example.com",
      label: "Track example.com",
      cadenceKey: "daily",
      cron: "0 9 * * *",
      status: "active",
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      runCount: 0,
    }]));
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    expect(screen.queryByText(/No schedules yet\./i)).toBeNull();
    // Appears twice: once in the Watchlist card (top), once in Active schedules.
    expect(screen.getAllByText("Track example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Daily")).toBeInTheDocument();
  });

  it("uses localStorage for the first paint of schedules (regression: 'No schedules yet' flash)", async () => {
    // The bug was: listSchedules() is async and the UI shows "No
    // schedules yet" while the server call is in flight. The Workspace
    // now hydrates from localStorage synchronously so users with
    // locally-cached schedules see them on first paint.
    localStorage.setItem("datiq.schedules", JSON.stringify([{
      id: "sch_local1",
      type: "track",
      target: "https://local.com",
      label: "Local schedule",
      cadenceKey: "daily",
      cron: "0 9 * * *",
      status: "active",
      createdAt: new Date().toISOString(),
    }]));
    // Server call is slow — never resolves within the test.
    apiMocks.listSchedules.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    // First paint (before the server call returns) must show the
    // locally-cached schedule, not "No schedules yet".
    expect(screen.queryByText(/No schedules yet\./i)).toBeNull();
    expect(screen.getAllByText("Local schedule").length).toBeGreaterThan(0);
  });

  it("preserves local-only schedules when the server returns [] (regression: listSchedules wiped localStorage)", async () => {
    // The bug was: listSchedules() called writeLocal(remote) even when
    // remote was [], wiping locally-cached items the user hadn't yet
    // synced to the server. The fix: when server returns [], keep the
    // local items instead of overwriting.
    localStorage.setItem("datiq.schedules", JSON.stringify([{
      id: "sch_local_only",
      type: "track",
      target: "https://local-only.com",
      label: "Local-only schedule",
      cadenceKey: "daily",
      cron: "0 9 * * *",
      status: "active",
      createdAt: new Date().toISOString(),
    }]));
    apiMocks.listSchedules.mockResolvedValue([]); // server says empty
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    // Allow the async effect to complete
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getAllByText("Local-only schedule").length).toBeGreaterThan(0);
    // And the persisted localStorage must still have it.
    const persisted = JSON.parse(localStorage.getItem("datiq.schedules"));
    expect(persisted.some((s) => s.id === "sch_local_only")).toBe(true);
  });

  it("merges server schedules with local-only items (regression: local-only items lost on server sync)", async () => {
    localStorage.setItem("datiq.schedules", JSON.stringify([{
      id: "sch_local_only",
      type: "track",
      target: "https://local-only.com",
      label: "Local-only schedule",
      cadenceKey: "daily",
      cron: "0 9 * * *",
      status: "active",
      createdAt: new Date().toISOString(),
    }]));
    apiMocks.listSchedules.mockResolvedValue([{
      id: "sch_server1",
      type: "track",
      target: "https://server.com",
      label: "Server schedule",
      cadenceKey: "weekly",
      cron: "0 9 * * 1",
      status: "active",
      createdAt: new Date().toISOString(),
    }]);
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    // Both should be visible in the Workspace (the "Active schedules"
    // card shows up to 3; the dedicated Schedules tab shows all).
    expect(screen.getAllByText("Server schedule").length).toBeGreaterThan(0);
    // LocalStorage now contains BOTH (server items + preserved local-only).
    const persisted = JSON.parse(localStorage.getItem("datiq.schedules"));
    expect(persisted.map((s) => s.id).sort()).toEqual(["sch_local_only", "sch_server1"]);
  });
});

describe("Q4 — Workspace tabs (2026-08-11 Collections moved into Workspace)", () => {
  it("renders three tabs: Overview, Collections, Schedules", async () => {
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    expect(screen.getByRole("tab", { name: /Overview/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Collections/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Schedules/i })).toBeInTheDocument();
  });

  it("Overview is the default active tab", async () => {
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    expect(screen.getByRole("tab", { name: /Overview/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Collections/i })).toHaveAttribute("aria-selected", "false");
  });

  it("clicking the Collections tab switches the URL to ?tab=collections and shows the Collections view", async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    await user.click(screen.getByRole("tab", { name: /Collections/i }));
    expect(screen.getByRole("heading", { name: /your research, organized/i })).toBeInTheDocument();
    // The Collections tab is now active.
    expect(screen.getByRole("tab", { name: /Collections/i })).toHaveAttribute("aria-selected", "true");
  });

  it("clicking the Schedules tab shows the full schedules list (regression: 'Active schedule is not listed')", async () => {
    const user = userEvent.setup();
    localStorage.setItem("datiq.schedules", JSON.stringify([
      { id: "sch_a", type: "track", target: "https://a.com", label: "Track a.com", cadenceKey: "daily",   cron: "0 9 * * *",   status: "active", createdAt: new Date().toISOString() },
      { id: "sch_b", type: "track", target: "https://b.com", label: "Track b.com", cadenceKey: "weekly",  cron: "0 9 * * 1",   status: "active", createdAt: new Date().toISOString() },
      { id: "sch_c", type: "track", target: "https://c.com", label: "Track c.com", cadenceKey: "monthly", cron: "0 9 1 * *",   status: "active", createdAt: new Date().toISOString() },
    ]));
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    await user.click(screen.getByRole("tab", { name: /Schedules/i }));
    // All three schedules show up in the dedicated Schedules tab.
    expect(await screen.findByText("Track a.com")).toBeInTheDocument();
    expect(screen.getByText("Track b.com")).toBeInTheDocument();
    expect(screen.getByText("Track c.com")).toBeInTheDocument();
  });

  it("?tab=collections deep-link lands on the Collections tab directly", async () => {
    await act(async () => {
      renderWorkspace(["/workspace?tab=collections"], true);
    });
    expect(screen.getByRole("tab", { name: /Collections/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: /your research, organized/i })).toBeInTheDocument();
  });

  it("Collections tab inside Workspace shows the same sidebar + main-pane structure as the old /collections page", async () => {
    const user = userEvent.setup();
    apiMocks.listExtractions.mockResolvedValue([
      { id: "x1", url: "https://stripe.com/pricing", page_title: "Stripe Pricing", collection: "Stripe", created_at: "2026-07-15" },
      { id: "x2", url: "https://stripe.com/docs",     page_title: "Stripe Docs",    collection: "Stripe", created_at: "2026-07-14" },
      { id: "x3", url: "https://linear.app",          page_title: "Linear",         collection: "Q2",      created_at: "2026-07-13" },
      { id: "x4", url: "https://example.com",         page_title: "Example",        created_at: "2026-07-12" },
    ]);
    await act(async () => {
      renderWorkspace(["/workspace?tab=collections"], true);
    });
    // Sidebar has both collections + Untagged
    expect(await screen.findByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText("Q2")).toBeInTheDocument();
    expect(screen.getByText("Untagged")).toBeInTheDocument();
    // Clicking a collection lists its items. The collection picker is a real
    // ARIA tablist now (Part F fix), so its items report role="tab", not the
    // native button role.
    await user.click(screen.getByRole("tab", { name: /stripe/i }));
    expect(await screen.findByText("Stripe Pricing")).toBeInTheDocument();
    expect(screen.queryByText("Linear")).toBeNull();
  });

  it("Collections summary card on the Overview shows the top collections + Untagged count", async () => {
    apiMocks.listExtractions.mockResolvedValue([
      { id: "x1", url: "https://stripe.com/pricing", page_title: "Stripe Pricing", collection: "Stripe", created_at: "2026-07-15" },
      { id: "x2", url: "https://stripe.com/docs",     page_title: "Stripe Docs",    collection: "Stripe", created_at: "2026-07-14" },
      { id: "x3", url: "https://linear.app",          page_title: "Linear",         collection: "Q2",      created_at: "2026-07-13" },
      { id: "x4", url: "https://example.com",         page_title: "Example",        created_at: "2026-07-12" },
    ]);
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    // Find the Collections card by its heading
    const card = screen.getByRole("heading", { name: /^Collections$/ }).closest("section");
    expect(card).not.toBeNull();
    const inCard = within(card);
    expect(inCard.getByText("Stripe")).toBeInTheDocument();
    expect(inCard.getByText("Q2")).toBeInTheDocument();
    expect(inCard.getByText(/2 items/i)).toBeInTheDocument();
    expect(inCard.getByText(/Untagged/i)).toBeInTheDocument();
  });
});

