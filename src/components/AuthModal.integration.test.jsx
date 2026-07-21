// src/components/AuthModal.integration.test.jsx
// I-42 — AuthModal integration.
//
//   - When opened with authMode='signin' → "Sign in" tab is active by default.
//   - When opened with authMode='signup' → "Create account" tab is active.
//   - The authError from AuthProvider is shown in the error banner.
//   - All three OAuth buttons (Google, Microsoft, GitHub) are present.
//   - Submitting the email form calls signInWithEmail / signUpWithEmail.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "./AuthProvider.jsx";
import { PersonaProvider } from "./PersonaProvider.jsx";
import AuthModal from "./AuthModal.jsx";

const authMocks = vi.hoisted(() => ({
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return {
    ...actual,
    signInWithEmail: authMocks.signInWithEmail,
    signUpWithEmail: authMocks.signUpWithEmail,
    signInWithOAuth: authMocks.signInWithOAuth,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

vi.mock("../lib/apiClient.js", () => ({
  setAuthToken: vi.fn(),
}));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(),
    },
  },
}));

function ModalDriver({ authMode, authError }) {
  const auth = useAuth();
  // Drive the modal open on mount with the requested initial mode.
  useEffect(() => {
    if (authError && auth.setAuthError) auth.setAuthError(authError);
    auth.openAuth(authMode);
  }, [auth, authMode, authError]);
  return null;
}

function Shell({ children, authMode = "signin", authError = "" }) {
  // Mirror the production App.jsx pattern: <AuthModal /> is only mounted
  // when showAuthModal is true. This means the modal's useState init
  // captures the authMode/authError at the time of open, not at app boot.
  return (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <PersonaProvider>
          <ModalDriver authMode={authMode} authError={authError} />
          <ModalGate />
        </PersonaProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

function ModalGate() {
  const { showAuthModal } = useAuth();
  return showAuthModal ? <AuthModal /> : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  window.history.replaceState(null, "", window.location.pathname);
});

describe("I-42 — AuthModal", () => {
  it("opens on the 'Sign in' tab when authMode is 'signin'", async () => {
    render(<Shell authMode="signin" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const signinTab = screen.getByRole("tab", { name: /sign in/i });
    expect(signinTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  });

  it("opens on the 'Create account' tab when authMode is 'signup'", async () => {
    render(<Shell authMode="signup" />);
    // Two act() passes — first lets ModalDriver's useEffect call openAuth,
    // second lets React re-render AuthModal with authMode='signup'.
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const signupTab = screen.getByRole("tab", { name: /create account/i });
    expect(signupTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/create your account/i)).toBeInTheDocument();
  });

  it("renders the three OAuth buttons (Google, Microsoft, GitHub)", async () => {
    render(<Shell authMode="signin" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with microsoft/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with github/i })).toBeInTheDocument();
  });

  it("clicking an OAuth button calls signInWithOAuth", async () => {
    authMocks.signInWithOAuth.mockResolvedValue({});
    render(<Shell authMode="signin" />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    });
    expect(authMocks.signInWithOAuth).toHaveBeenCalledWith("google");
  });

  it("submitting the email form on Sign in tab calls signInWithEmail", async () => {
    authMocks.signInWithEmail.mockResolvedValue({});
    render(<Shell authMode="signin" />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "hunter2hunter" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    });
    expect(authMocks.signInWithEmail).toHaveBeenCalledWith("alice@example.com", "hunter2hunter");
  });

  it("submitting the email form on Create account tab calls signUpWithEmail", async () => {
    authMocks.signUpWithEmail.mockResolvedValue({
      user: { confirmed_at: new Date().toISOString() },
    });
    render(<Shell authMode="signup" />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Switch to Create account tab if not already active.
    const signupTab = screen.getByRole("tab", { name: /create account/i });
    if (signupTab.getAttribute("aria-selected") !== "true") {
      await act(async () => {
        fireEvent.click(signupTab);
      });
    }
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "bob@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "sup3rs3cure" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    });
    expect(authMocks.signUpWithEmail).toHaveBeenCalledWith("bob@example.com", "sup3rs3cure");
  });

  it("authError from the provider is shown in the error banner", async () => {
    // Drive the URL-hash error path the AuthProvider watches on mount
    // (the OAuth-redirect path is the only external way to seed authError).
    window.history.replaceState(
      null,
      "",
      "#error=access_denied&error_description=Demo+error+from+provider",
    );
    render(<Shell authMode="signin" />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // The .auth-error div carries role="alert".
    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("Demo error from provider");
  });
});
