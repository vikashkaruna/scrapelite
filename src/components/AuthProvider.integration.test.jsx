// src/components/AuthProvider.integration.test.jsx
// I-14 — AuthProvider integration.
//
//   - Mount with a #error=access_denied URL → authError is set,
//     showAuthModal is true, and window.location.hash is cleaned.
//   - On a clean mount with no Supabase session → user is null,
//     showAuthModal is false, authError is empty.
//   - The provider keeps the apiClient's auth token in sync with the
//     current session (set on mount, cleared on signOut).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useAuth, AuthProvider } from "./AuthProvider.jsx";
import * as authService from "../lib/authService.js";
import * as apiClient from "../lib/apiClient.js";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  setAuthToken: vi.fn(),
}));

vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

vi.mock("../lib/apiClient.js", () => ({
  setAuthToken: apiMocks.setAuthToken,
}));

function Capture() {
  const ctx = useAuth();
  Capture.last = ctx;
  return (
    <div>
      <span data-testid="user">{ctx.user ? ctx.user.email : "anonymous"}</span>
      <span data-testid="showAuthModal">{String(ctx.showAuthModal)}</span>
      <span data-testid="authError">{ctx.authError}</span>
      <span data-testid="authMode">{ctx.authMode}</span>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no active session, no auth state events.
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  // Clear any leftover hash from a previous test.
  window.history.replaceState(null, "", window.location.pathname);
});

describe("I-14 — AuthProvider", () => {
  it("clean mount → user is null, modal closed, no error", async () => {
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    // Wait for the initial getSession() promise to resolve.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("user").textContent).toBe("anonymous");
    expect(screen.getByTestId("showAuthModal").textContent).toBe("false");
    expect(screen.getByTestId("authError").textContent).toBe("");
  });

  it("mount with #error=access_denied → authError set, modal opened, hash cleaned", async () => {
    // Pretend the OAuth redirect landed with an error in the hash.
    window.history.replaceState(null, "", "#error=access_denied&error_description=Access+denied+by+user");
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("authError").textContent).toBe("Access denied by user");
    expect(screen.getByTestId("showAuthModal").textContent).toBe("true");
    // Hash should be cleaned so reloads don't keep showing the modal.
    expect(window.location.hash).toBe("");
  });

  it("openAuth('signin') / openAuth('signup') flip authMode + showAuthModal", async () => {
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("authMode").textContent).toBe("signin");
    act(() => Capture.last.openAuth("signup"));
    expect(screen.getByTestId("authMode").textContent).toBe("signup");
    expect(screen.getByTestId("showAuthModal").textContent).toBe("true");
    act(() => Capture.last.closeAuth());
    expect(screen.getByTestId("showAuthModal").textContent).toBe("false");
  });

  it("setAuthToken is called with null on a clean mount (no session)", async () => {
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(apiMocks.setAuthToken).toHaveBeenCalledWith(null);
  });

  // ── OAuth-callback URL cleanup ────────────────────────────────────────────
  // Bug: after Google sign-in the user lands on datiq.app/#access_token=...
  // (implicit) or datiq.app/?code=... (PKCE) and the URL never gets cleaned.
  // The Supabase auth-js client is supposed to clean it, but only when the
  // project the hash was issued for matches the project the client is
  // configured with. When they don't, the hash sticks. We strip it ourselves
  // and surface a friendly error if no session was produced.

  it("mount with #access_token=... (implicit callback) → hash cleaned even if Supabase init fails", async () => {
    window.history.replaceState(
      null,
      "",
      "#access_token=eyJabc&refresh_token=rtok&expires_in=3600&token_type=bearer"
    );
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // Hash MUST be gone — the user should never see a token-bearing URL
    // sitting in the address bar.
    expect(window.location.hash).toBe("");
    // The Supabase client returned null (project mismatch simulation), so we
    // surface a helpful error instead of silently leaving the user signed-out.
    expect(screen.getByTestId("showAuthModal").textContent).toBe("true");
    expect(screen.getByTestId("authError").textContent).toMatch(
      /Sign-in completed but we couldn't start your session/
    );
  });

  it("mount with #access_token=... AND a resolved session → no error, hash cleaned", async () => {
    authMocks.getSession.mockResolvedValue({
      access_token: "eyJabc",
      user: { id: "u1", email: "a@b.co" },
    });
    window.history.replaceState(
      null,
      "",
      "#access_token=eyJabc&refresh_token=rtok"
    );
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(window.location.hash).toBe("");
    expect(screen.getByTestId("user").textContent).toBe("a@b.co");
    expect(screen.getByTestId("showAuthModal").textContent).toBe("false");
    expect(screen.getByTestId("authError").textContent).toBe("");
  });

  it("mount with ?code=... (PKCE callback) → query cleaned, error surfaced if no session", async () => {
    window.history.replaceState(null, "", "/?code=abc123");
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    // No session → user sees the auth modal with the diagnostic error.
    expect(screen.getByTestId("showAuthModal").textContent).toBe("true");
    expect(screen.getByTestId("authError").textContent).toMatch(
      /Sign-in completed but we couldn't start your session/
    );
  });

  it("mount with ?code=... AND a resolved session → no error, query cleaned, user signed in", async () => {
    authMocks.getSession.mockResolvedValue({
      access_token: "eyJpkce",
      user: { id: "u2", email: "c@d.co" },
    });
    window.history.replaceState(null, "", "/?code=abc123");
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(window.location.search).toBe("");
    expect(screen.getByTestId("user").textContent).toBe("c@d.co");
    expect(screen.getByTestId("showAuthModal").textContent).toBe("false");
    expect(screen.getByTestId("authError").textContent).toBe("");
  });
});
