// src/components/AuthModal.integration.test.jsx
// I-42 + I-43 — AuthModal integration.
//
//   - When opened with authMode='signin' → "Sign in" tab is active by default.
//   - When opened with authMode='signup' → "Create account" tab is active.
//   - The authError from AuthProvider is shown in the error banner.
//   - All three OAuth buttons (Google, Microsoft, GitHub) are present.
//   - Submitting the email form calls signInWithEmail / signUpWithEmail.
//   - "Forgot password?" link switches to the reset-request view.
//   - Supabase surface errors are replaced with friendly copy + a CTA.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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
  resetPasswordForEmail: vi.fn(),
  resendSignUpConfirmation: vi.fn(),
  updatePassword: vi.fn(),
}));

vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return {
    ...actual,
    // Tests mock every auth call, so the configured-guard must not block them
    authEnabled: true,
    signInWithEmail: authMocks.signInWithEmail,
    signUpWithEmail: authMocks.signUpWithEmail,
    signInWithOAuth: authMocks.signInWithOAuth,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
    resetPasswordForEmail: authMocks.resetPasswordForEmail,
    resendSignUpConfirmation: authMocks.resendSignUpConfirmation,
    updatePassword: authMocks.updatePassword,
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
    <MemoryRouter>
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

describe("I-43 — AuthModal password reset flow", () => {
  it("renders a 'Forgot password?' link on the Sign in tab", async () => {
    render(<Shell authMode="signin" />);
    await act(async () => {
      await Promise.resolve();
    });
    const link = screen.getByRole("button", { name: /forgot password\?/i });
    expect(link).toBeInTheDocument();
  });

  it("clicking 'Forgot password?' switches the modal to the reset-request view", async () => {
    render(<Shell authMode="signin" />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async => {
      fireEvent.click(screen.getByRole("button", { name: /forgot password\?/i }));
    });
    expect(screen.getByRole("heading", { name: /reset your password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument();
  });

  it("submitting the reset form calls resetPasswordForEmail and shows the success state", async () => {
    authMocks.resetPasswordForEmail.mockResolvedValue({});
    render(<Shell authMode="signin" />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async => {
      fireEvent.click(screen.getByRole("button", { name: /forgot password\?/i }));
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "alice@example.com" },
    });
    await act(async => {
      fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    });
    expect(authMocks.resetPasswordForEmail).toHaveBeenCalledWith("alice@example.com");
    expect(screen.getByRole("heading", { name: /check your email/i })).toBeInTheDocument();
  });

  it("'Back to sign in' from the forgot view returns to the sign-in form", async () => {
    render(<Shell authMode="signin" />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async => {
      fireEvent.click(screen.getByRole("button", { name: /forgot password\?/i }));
    });
    await act(async => {
      fireEvent.click(screen.getByRole("button", { name: /back to sign in/i }));
    });
    expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
  });
});

describe("I-44 — AuthModal friendly error copy", () => {
  it("'Invalid login credentials' surfaces the friendly title with a 'Reset password' CTA", async () => {
    authMocks.signInWithEmail.mockRejectedValue(new Error("Invalid login credentials"));
    render(<Shell authMode="signin" />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "wrong-pw" },
    });
    await act(async => {
      fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    });
    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // The friendly message body + the actionable CTA both live in the alert.
    expect(alert.textContent).toMatch(/double-check the email address and password/i);
    // The CTA is rendered as a button inside the feedback.
    const cta = alert.querySelector("button");
    expect(cta).not.toBeNull();
    expect(cta.textContent).toMatch(/reset password/i);
  });

  it("'Email not confirmed' surfaces the resend CTA that calls resendSignUpConfirmation", async () => {
    authMocks.signInWithEmail.mockRejectedValue(new Error("Email not confirmed"));
    authMocks.resendSignUpConfirmation.mockResolvedValue({});
    render(<Shell authMode="signin" />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "good-pw" },
    });
    await act(async => {
      fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    });
    const cta = document.querySelector('[role="alert"] button');
    await act(async => {
      fireEvent.click(cta);
    });
    expect(authMocks.resendSignUpConfirmation).toHaveBeenCalledWith("new@example.com");
  });
});
