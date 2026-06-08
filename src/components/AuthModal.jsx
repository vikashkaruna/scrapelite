// AuthModal.jsx — sign-in / sign-up modal with email+password and OAuth.
// Rendered via a React portal so it sits above all page content.

import { useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useAuth } from "./AuthProvider.jsx";
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithOAuth,
  authEnabled,
} from "../lib/authService.js";

// SVG logos for OAuth providers (inlined so we don't need image assets).
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
      <rect width="11" height="11" fill="#F25022" />
      <rect x="12" width="11" height="11" fill="#7FBA00" />
      <rect y="12" width="11" height="11" fill="#00A4EF" />
      <rect x="12" y="12" width="11" height="11" fill="#FFB900" />
    </svg>
  );
}

function GitHubLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.647.35-1.087.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.137 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}

function Spinner() {
  return <span className="btn-spinner" aria-hidden="true" />;
}

export default function AuthModal() {
  const { closeAuth } = useAuth();
  const [tab, setTab] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(""); // '' | 'email' | 'google' | 'azure' | 'github'

  function switchTab(t) {
    setTab(t);
    setError("");
    setInfo("");
  }

  async function handleEmail(e) {
    e.preventDefault();
    if (!authEnabled) {
      setError("Auth not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setError("");
    setInfo("");
    setLoading("email");
    try {
      if (tab === "signin") {
        await signInWithEmail(email, password);
        // AuthProvider's onAuthStateChange closes the modal automatically.
      } else {
        const { user } = await signUpWithEmail(email, password);
        // If email confirmation is required, show a message instead of closing.
        if (user && !user.confirmed_at && !user.email_confirmed_at) {
          setInfo("Check your email for a confirmation link to activate your account.");
        }
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading("");
    }
  }

  async function handleOAuth(provider) {
    if (!authEnabled) {
      setError("Auth not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setError("");
    setLoading(provider);
    try {
      await signInWithOAuth(provider);
      // Page will redirect to the OAuth provider — no further state needed here.
    } catch (err) {
      setError(err.message || "OAuth sign-in failed. Please try again.");
      setLoading("");
    }
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) closeAuth();
  }

  return createPortal(
    <div className="auth-backdrop" onClick={handleBackdropClick}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-label="Sign in">
        <button className="auth-close" onClick={closeAuth} aria-label="Close sign-in dialog">
          <Icon name="x" size={18} />
        </button>

        {/* Brand */}
        <div className="auth-brand">
          <Icon name="layers" size={20} strokeWidth={2.2} />
          <span>ScrapeLite</span>
        </div>

        <h2 className="auth-title">
          {tab === "signin" ? "Welcome back" : "Create your account"}
        </h2>
        <p className="auth-sub">
          {tab === "signin"
            ? "Sign in to save and manage your extractions."
            : "Start extracting and enriching web data in seconds."}
        </p>

        {/* OAuth buttons */}
        <div className="auth-oauth">
          <button
            className="oauth-btn"
            onClick={() => handleOAuth("google")}
            disabled={!!loading}
            aria-label="Continue with Google"
          >
            {loading === "google" ? <Spinner /> : <GoogleLogo />}
            Continue with Google
          </button>
          <button
            className="oauth-btn"
            onClick={() => handleOAuth("azure")}
            disabled={!!loading}
            aria-label="Continue with Microsoft"
          >
            {loading === "azure" ? <Spinner /> : <MicrosoftLogo />}
            Continue with Microsoft
          </button>
          <button
            className="oauth-btn"
            onClick={() => handleOAuth("github")}
            disabled={!!loading}
            aria-label="Continue with GitHub"
          >
            {loading === "github" ? <Spinner /> : <GitHubLogo />}
            Continue with GitHub
          </button>
        </div>

        <div className="auth-divider">
          <span>or continue with email</span>
        </div>

        {/* Tab switcher */}
        <div className="auth-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "signin"}
            className={"auth-tab" + (tab === "signin" ? " active" : "")}
            onClick={() => switchTab("signin")}
          >
            Sign in
          </button>
          <button
            role="tab"
            aria-selected={tab === "signup"}
            className={"auth-tab" + (tab === "signup" ? " active" : "")}
            onClick={() => switchTab("signup")}
          >
            Create account
          </button>
        </div>

        {/* Email / Password form */}
        <form className="auth-form" onSubmit={handleEmail} noValidate>
          {error && (
            <div className="auth-feedback auth-error" role="alert">
              <Icon name="alert-triangle" size={14} />
              {error}
            </div>
          )}
          {info && (
            <div className="auth-feedback auth-info" role="status">
              <Icon name="check-circle" size={14} />
              {info}
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={tab === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={!!loading}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {loading === "email"
              ? "Loading…"
              : tab === "signin"
                ? "Sign in"
                : "Create account"}
          </Button>
        </form>

        <p className="auth-footer-note">
          By continuing you agree to our{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>,
    document.body
  );
}
