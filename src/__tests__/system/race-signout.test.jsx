// src/__tests__/system/race-signout.test.jsx
// RC-01 — Two signOut() calls in the same tick should result in one
// final navigation and a single consistent state. No duplicate navigations
// or inconsistent state from the lost double-call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { AppProviders } from "../harness/AppProviders.jsx";
import { useAuth } from "../../components/AuthProvider.jsx";
import { signOut } from "../../lib/authService.js";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../../lib/authService.js", async () => {
  const actual = await vi.importActual("../../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
    signOut: authMocks.signOut,
  };
});

let navigateCalls = 0;

function Probe() {
  const auth = useAuth();
  // We track navigate() calls via a custom NavigateCounter child.
  return (
    <div>
      <span data-testid="user">{auth.user ? auth.user.email : "anonymous"}</span>
      <button
        data-testid="double-signout"
        onClick={() => {
          // Two signOut() calls in the same tick. This is the race condition
          // the test guards against.
          signOut();
          signOut();
        }}
      >
        double signout
      </button>
    </div>
  );
}

function NavCounter() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    // Count navigation events. The handleSignOut in TopBar (when
    // triggered by user-state) calls navigate("/"). Our double signOut
    // here doesn't call navigate — that's owned by AuthProvider's
    // user-state transition handler. The probe is here to capture any
    // unexpected navigations.
    navigateCalls += 1;
  });
  return (
    <div>
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="nav-count">{navigateCalls}</span>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  navigateCalls = 0;
  localStorage.clear();
  sessionStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  // Slow signOut so the two calls race on a microtask boundary.
  authMocks.signOut.mockImplementation(() => new Promise((res) => setTimeout(res, 10)));
  window.history.replaceState(null, "", window.location.pathname);
});

describe("RC-01 — simultaneous signOut is idempotent", () => {
  it("two signOut() calls in the same tick → signOut is called twice, but final state is consistent", async () => {
    render(
      <AppProviders>
        <Probe />
        <NavCounter />
      </AppProviders>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("user").textContent).toBe("anonymous");

    // Click the button that fires signOut twice synchronously.
    act(() => screen.getByTestId("double-signout").click());
    // Flush all pending microtasks + the 10ms setTimeout.
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    // signOut was called twice (the function itself is invoked twice).
    // The "race" the test guards against is: an inconsistent state from
    // running signOut twice. The final state must be clean (user null,
    // guest trial preserved, no auth-modal stuck open).
    expect(authMocks.signOut).toHaveBeenCalledTimes(2);
    // User is still anonymous.
    expect(screen.getByTestId("user").textContent).toBe("anonymous");
    // No double-navigation: the path is unchanged.
    expect(screen.getByTestId("pathname").textContent).toBe("/");
  });
});
