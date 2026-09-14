// AuthModal.jsx — sign-in / sign-up modal with email+password, OAuth, and optional persona step.
// Also handles the forgot-password request view (in-modal email entry + reset link send).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { usePersona } from "./PersonaProvider.jsx";
import { PERSONAS } from "../lib/personaConfig.js";
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithOAuth,
  resetPasswordForEmail,
  resendSignUpConfirmation,
  authEnabled,
} from "../lib/authService.js";
import { classifyAuthError } from "../lib/authErrors.js";

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

// ── Forgot-password view ────────────────────────────────────────────────────
// Two states inside the same shell: "forgot" (email input) and "forgot-sent"
// (confirmation that the reset link is on its way). Both render in place of
// the sign-in / sign-up form so the user keeps the same mental context.
function ForgotView({
  tab,
  email,
  setEmail,
  error,
  errorCta,
  onErrorCta,
  onSubmit,
  onBack,
  loading,
  setError,
  setErrorCta,
  setInfo,
}) {
  const sent = tab === "forgot-sent";
  return (
    <>
      <div className="auth-brand">
        <Icon name="layers" size={20} strokeWidth={2.2} />
        <span>DatIQ</span>
      </div>

      <h2 className="auth-title">
        {sent ? "Check your email" : "Reset your password"}
      </h2>
      <p className="auth-sub">
        {sent
          ? `If an account exists for ${email || "that address"}, we've sent a password reset link. It expires in 1 hour.`
          : "Enter the email address you signed up with. We'll send you a link to set a new password."}
      </p>

      {!sent && (
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {error && (
            <div className="auth-feedback auth-error" role="alert">
              <Icon name="alert-triangle" size={14} />
              <span>{error}</span>
              {errorCta && (
                <button
                  type="button"
                  className="auth-feedback-cta"
                  onClick={() => onErrorCta(errorCta.action)}
                >
                  {errorCta.label}
                </button>
              )}
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="auth-forgot-email">Email</label>
            <input
              id="auth-forgot-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={!!loading}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {loading === "forgot" ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}

      {sent && (
        <div className="auth-feedback auth-info" role="status">
          <Icon name="check-circle" size={14} />
          <span>
            Didn't get the email? Check your spam folder, or{" "}
            <button
              type="button"
              className="auth-link-button"
              onClick={() => {
                setError("");
                setErrorCta(null);
                setInfo("");
                onBack(); // back to "forgot" form
              }}
            >
              try again
            </button>
            .
          </span>
        </div>
      )}

      <button
        type="button"
        className="auth-back-link"
        onClick={() => {
          setError("");
          setErrorCta(null);
          setInfo("");
          onBack();
        }}
      >
        <Icon name="arrow-left" size={14} />
        Back to sign in
      </button>
    </>
  );
}

// ── Persona picker step (shown after sign-up if not yet onboarded) ──
function PersonaStep({ onSelect, onSkip }) {
  return (
    <div className="auth-persona-step">
      <div className="auth-title" style={{ marginBottom: 4 }}>One more thing</div>
      <p className="auth-sub" style={{ marginBottom: 16 }}>
        Choose your primary role so DatIQ can tailor your experience. You can change this any time.
      </p>
      <div className="auth-persona-grid">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            className="auth-persona-card"
            onClick={() => onSelect(p.id)}
            style={{ "--pc": p.color }}
          >
            <span className="auth-persona-icon" style={{ background: `color-mix(in srgb, ${p.color} 14%, transparent)`, color: p.color }}>
              <Icon name={p.icon} size={16} />
            </span>
            <span className="auth-persona-label">{p.label}</span>
          </button>
        ))}
      </div>
      <button className="ob-skip-link" onClick={onSkip} style={{ marginTop: 12, fontSize: ".84em" }}>
        Skip for now
      </button>
    </div>
  );
}

export default function AuthModal() {
  const { closeAuth, authError, authMode } = useAuth();
  const { onboarded, selectPersona, completeOnboarding } = usePersona();
  const navigate = useNavigate();

  // "signin" | "signup" | "forgot" | "forgot-sent"
  const [tab, setTab] = useState(authMode === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(authError || "");
  const [errorCta, setErrorCta] = useState(null); // {label, action} from classifyAuthError
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState("");
  const [showPersonaStep, setShowPersonaStep] = useState(false);

  // A11y: Escape closes the modal. Standard dialog keyboard contract.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") closeAuth(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeAuth]);

  function switchTab(t) {
    setTab(t);
    setError("");
    setErrorCta(null);
    setInfo("");
  }

  /** Run a CTA attached to a classified error (back-to-signin, open-forgot, …). */
  function handleErrorCta(action) {
    if (action === "back-to-signin") {
      switchTab("signin");
    } else if (action === "open-forgot") {
      switchTab("forgot");
    } else if (action === "resend-confirmation") {
      handleResendConfirmation();
    }
  }

  async function handleResendConfirmation() {
    if (!email) {
      switchTab("signup");
      return;
    }
    setError("");
    setErrorCta(null);
    setInfo("");
    setLoading("resend");
    try {
      await resendSignUpConfirmation(email);
      setInfo("A fresh confirmation link is on its way. Check your inbox (and spam folder).");
    } catch (err) {
      const friendly = classifyAuthError(err);
      setError(friendly.message);
      setErrorCta(friendly.cta);
    } finally {
      setLoading("");
    }
  }

  function handlePersonaSelect(id) {
    selectPersona(id);
    completeOnboarding("");
    closeAuth();
    navigate("/");
  }

  function handlePersonaSkip() {
    completeOnboarding("");
    closeAuth();
    navigate("/");
  }

  async function handleEmail(e) {
    e.preventDefault();
    if (!authEnabled) {
      setError("Auth not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setError("");
    setErrorCta(null);
    setInfo("");
    setLoading("email");
    try {
      if (tab === "signin") {
        await signInWithEmail(email, password);
      } else {
        const { user } = await signUpWithEmail(email, password);
        if (user && !user.confirmed_at && !user.email_confirmed_at) {
          setInfo("Check your email for a confirmation link to activate your account.");
        } else if (!onboarded) {
          // Account created & confirmed — offer persona selection
          setShowPersonaStep(true);
        }
      }
    } catch (err) {
      const friendly = classifyAuthError(err, {
        operation: tab === "signup" ? "signup" : "signin",
      });
      setError(friendly.message);
      setErrorCta(friendly.cta);
    } finally {
      setLoading("");
    }
  }

  async function handleForgotSubmit(e) {
    e.preventDefault();
    if (!authEnabled) {
      setError("Auth not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setError("");
    setErrorCta(null);
    setInfo("");
    setLoading("forgot");
    try {
      await resetPasswordForEmail(email);
      setTab("forgot-sent");
    } catch (err) {
      const friendly = classifyAuthError(err);
      setError(friendly.message);
      setErrorCta(friendly.cta);
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
      <div className="auth-modal" role="dialog" aria-modal="true" aria-label={showPersonaStep ? "Choose your role" : "Sign in"}>
        <button className="auth-close" onClick={closeAuth} aria-label="Close">
          <Icon name="x" size={18} />
        </button>

        {showPersonaStep ? (
          <PersonaStep onSelect={handlePersonaSelect} onSkip={handlePersonaSkip} />
        ) : tab === "forgot" || tab === "forgot-sent" ? (
          <ForgotView
            tab={tab}
            email={email}
            setEmail={setEmail}
            error={error}
            errorCta={errorCta}
            onErrorCta={handleErrorCta}
            onSubmit={handleForgotSubmit}
            onBack={() => switchTab("signin")}
            loading={loading}
            setError={setError}
            setErrorCta={setErrorCta}
            setInfo={setInfo}
          />
        ) : (
          <>
            {/* Brand */}
            <div className="auth-brand">
              <Icon name="layers" size={20} strokeWidth={2.2} />
              <span>DatIQ</span>
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
              <button className="oauth-btn" onClick={() => handleOAuth("google")} disabled={!!loading} aria-label="Continue with Google">
                {loading === "google" ? <Spinner /> : <GoogleLogo />}
                Continue with Google
              </button>
              <button className="oauth-btn" onClick={() => handleOAuth("azure")} disabled={!!loading} aria-label="Continue with Microsoft">
                {loading === "azure" ? <Spinner /> : <MicrosoftLogo />}
                Continue with Microsoft
              </button>
              <button className="oauth-btn" onClick={() => handleOAuth("github")} disabled={!!loading} aria-label="Continue with GitHub">
                {loading === "github" ? <Spinner /> : <GitHubLogo />}
                Continue with GitHub
              </button>
            </div>

            <div className="auth-divider"><span>or continue with email</span></div>

            <div className="auth-tabs" role="tablist">
              <button role="tab" aria-selected={tab === "signin"} className={"auth-tab" + (tab === "signin" ? " active" : "")} onClick={() => switchTab("signin")}>
                Sign in
              </button>
              <button role="tab" aria-selected={tab === "signup"} className={"auth-tab" + (tab === "signup" ? " active" : "")} onClick={() => switchTab("signup")}>
                Create account
              </button>
            </div>

            <form className="auth-form" onSubmit={handleEmail} noValidate>
              {error && (
                <div className="auth-feedback auth-error" role="alert">
                  <Icon name="alert-triangle" size={14} />
                  <span>{error}</span>
                  {errorCta && (
                    <button
                      type="button"
                      className="auth-feedback-cta"
                      onClick={() => handleErrorCta(errorCta.action)}
                    >
                      {errorCta.label}
                    </button>
                  )}
                </div>
              )}
              {info && (
                <div className="auth-feedback auth-info" role="status">
                  <Icon name="check-circle" size={14} />{info}
                </div>
              )}

              <div className="auth-field">
                <label htmlFor="auth-email">Email</label>
                <input id="auth-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
              </div>

              <div className="auth-field">
                <label htmlFor="auth-password">Password</label>
                <input id="auth-password" type="password" autoComplete={tab === "signin" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
              </div>

              {tab === "signin" && (
                <div className="auth-forgot-row">
                  <button
                    type="button"
                    className="auth-forgot-link"
                    onClick={() => switchTab("forgot")}
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              <Button variant="primary" size="sm" type="submit" disabled={!!loading} style={{ width: "100%", justifyContent: "center" }}>
                {loading === "email" ? "Loading…" : tab === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>

            <p className="auth-footer-note">
              By continuing you agree to our{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
