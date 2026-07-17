// src/pages/Workspace.test.jsx — Q4 (logged-in → workspace) integration tests.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
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

vi.mock("../lib/apiClient.js", () => ({ setAuthToken: vi.fn() }));
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

describe("Q4 — /workspace route (WorkspaceRedirect wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch {}
  });

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
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch {}
  });

  it("renders greeting, quick actions, recent extractions, and usage for signed-in users", async () => {
    await act(async () => {
      renderWorkspace(["/workspace"], true);
    });
    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
    expect(screen.getAllByText("New extraction").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Batch run").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Collections").length).toBeGreaterThanOrEqual(1);
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
});

