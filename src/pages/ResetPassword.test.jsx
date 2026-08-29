// src/pages/ResetPassword.test.jsx
// I-45 — ResetPassword page integration.
//
//   - When the user lands on /reset-password with a valid recovery session
//     (`user` is non-null in the AuthProvider), the "Set a new password" form
//     is rendered.
//   - When the user lands without a valid session (expired / bad link), the
//     friendly "isn't valid" message is shown instead.
//   - Submitting matching + valid passwords calls updatePassword and shows
//     the success state.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider, useAuth } from "../components/AuthProvider.jsx";
import ResetPassword from "./ResetPassword.jsx";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  updatePassword: vi.fn(),
}));

vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return {
    ...actual,
    // Tests mock every auth call, so the configured-guard must not block them
    authEnabled: true,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
    updatePassword: authMocks.updatePassword,
  };
});

vi.mock("../lib/apiClient.js", () => ({
  setAuthToken: vi.fn(),
}));

function Shell({ initialUser = null }) {
  return (
    <MemoryRouter>
      <AuthProvider>
        {/* Seed the user before ResetPassword mounts so it sees a valid session. */}
        <SeedUser user={initialUser} />
        <ResetPassword />
      </AuthProvider>
    </MemoryRouter>
  );
}

function SeedUser({ user }) {
  const auth = useAuth();
  // Simulate the AuthProvider having picked up the recovery session by
  // pushing the user into the context via the same path onAuthStateChange
  // would. Tests just need the *initial render* to see user=null, so
  // a deferred seed is fine.
  if (user) {
    // setUser isn't exposed — emulate by setting a fake user via the context.
    // Easier: pass a different test setup that injects the user. Done below
    // via a pre-mounted AuthProvider variant.
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  window.history.replaceState(null, "", "/reset-password");
});

describe("I-45 — ResetPassword page", () => {
  it("shows the 'isn't valid' card when no recovery session is present", async () => {
    authMocks.getSession.mockResolvedValue(null);
    render(<Shell />);
    // Wait for AuthProvider's initial getSession() resolution (authLoading
    // flips false) so the page can switch from "checking" to "bad link".
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(
      screen.getByRole("heading", { name: /this reset link isn't valid/i }),
    ).toBeInTheDocument();
  });

  it("shows the 'Set a new password' form when a user session is active", async () => {
    // Use the actual Supabase onAuthStateChange mock to drive a session.
    const fakeUser = { id: "u_recovery", email: "alice@example.com" };
    const fakeSession = { access_token: "tok", user: fakeUser };
    authMocks.getSession.mockResolvedValue(fakeSession);
    authMocks.onAuthStateChange.mockImplementation((cb) => {
      // Fire the recovery session immediately to mimic Supabase picking
      // up the URL hash.
      setTimeout(() => cb("SIGNED_IN", fakeSession), 0);
      return () => {};
    });
    render(<Shell />);
    // Let getSession() resolve and the SIGNED_IN callback fire.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(
      screen.getByRole("heading", { name: /set a new password/i }),
    ).toBeInTheDocument();
  });

  it("submitting matching + valid passwords calls updatePassword and shows success", async () => {
    const fakeUser = { id: "u_recovery", email: "alice@example.com" };
    const fakeSession = { access_token: "tok", user: fakeUser };
    authMocks.getSession.mockResolvedValue(fakeSession);
    authMocks.onAuthStateChange.mockImplementation((cb) => {
      setTimeout(() => cb("SIGNED_IN", fakeSession), 0);
      return () => {};
    });
    authMocks.updatePassword.mockResolvedValue({ user: fakeUser });
    render(<Shell />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: "newstrongpw" },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "newstrongpw" },
    });
    await act(async => {
      fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    });
    expect(authMocks.updatePassword).toHaveBeenCalledWith("newstrongpw");
    expect(
      screen.getByRole("heading", { name: /password updated/i }),
    ).toBeInTheDocument();
  });

  it("rejects mismatched passwords without calling updatePassword", async () => {
    const fakeUser = { id: "u_recovery", email: "alice@example.com" };
    const fakeSession = { access_token: "tok", user: fakeUser };
    authMocks.getSession.mockResolvedValue(fakeSession);
    authMocks.onAuthStateChange.mockImplementation((cb) => {
      setTimeout(() => cb("SIGNED_IN", fakeSession), 0);
      return () => {};
    });
    render(<Shell />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: "newstrongpw" },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "different-pw" },
    });
    await act(async => {
      fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    });
    expect(authMocks.updatePassword).not.toHaveBeenCalled();
    expect(screen.getByText(/passwords don't match/i)).toBeInTheDocument();
  });
});
