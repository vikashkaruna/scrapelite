// ResetPassword.jsx — landing page for the Supabase password-recovery flow.
//
// When the user clicks the link in the password-reset email, Supabase
// redirects them to <origin>/reset-password#access_token=...&type=recovery.
// The Supabase client auto-picks up the recovery token from the URL and
// signs the user in with a temporary session. This page then shows a
// "Set a new password" form, calls updateUser({ password }) to commit
// the change, and routes the user to /account on success.
//
// If the link has expired or is invalid, the page shows a friendly
// message and a "Request a new link" CTA that opens the auth modal in
// the forgot-password view.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { updatePassword, authEnabled } from "../lib/authService.js";
import { classifyAuthError } from "../lib/authErrors.js";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { user, openAuth } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [errorCta, setErrorCta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // The Supabase client picks up the recovery token from the URL hash on
  // mount and fires a SIGNED_IN event. The AuthProvider reflects this as
  // `user` becoming non-null. We wait for that to know we have a valid
  // recovery session.
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  useEffect(() => {
    // Give the AuthProvider a beat to read the URL hash + call getSession.
    const t = setTimeout(() => setRecoveryChecked(true), 250);
    return () => clearTimeout(t);
  }, []);

  // If after checking we still have no user → the link is bad.
  const linkLooksBad = recoveryChecked && !user;

  function handleErrorCta(action) {
    if (action === "back-to-signin") {
      navigate("/");
    } else if (action === "open-forgot") {
      openAuth("signin");
      navigate("/");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setErrorCta(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match. Please re-enter.");
      return;
    }
    if (!authEnabled) {
      setError("Auth not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      setSuccess(true);
    } catch (err) {
      const friendly = classifyAuthError(err);
      setError(friendly.message);
      setErrorCta(friendly.cta);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="page">
        <div className="container">
          <div className="reset-pw-card">
            <div className="reset-pw-icon reset-pw-icon-success">
              <Icon name="check-circle" size={28} />
            </div>
            <h1 className="reset-pw-title">Password updated</h1>
            <p className="reset-pw-sub">
              You're all set. Sign in with your new password to continue.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate("/account")}
              style={{ width: "100%", justifyContent: "center" }}
            >
              Go to your account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (linkLooksBad) {
    return (
      <div className="page">
        <div className="container">
          <div className="reset-pw-card">
            <div className="reset-pw-icon reset-pw-icon-error">
              <Icon name="alert-triangle" size={28} />
            </div>
            <h1 className="reset-pw-title">This reset link isn't valid</h1>
            <p className="reset-pw-sub">
              The link may have already been used, or it has expired (links are good
              for 1 hour). Request a fresh reset link from the sign-in screen and we'll
              send you a new one.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                openAuth("signin");
                navigate("/");
              }}
              style={{ width: "100%", justifyContent: "center" }}
            >
              Back to sign in
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <div className="reset-pw-card">
          <div className="reset-pw-icon">
            <Icon name="shield" size={28} />
          </div>
          <h1 className="reset-pw-title">Set a new password</h1>
          <p className="reset-pw-sub">
            Choose a new password for your DatIQ account. It must be at least 6 characters.
          </p>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
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

            <div className="auth-field">
              <label htmlFor="reset-pw">New password</label>
              <input
                id="reset-pw"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                autoFocus
              />
            </div>

            <div className="auth-field">
              <label htmlFor="reset-pw-confirm">Confirm new password</label>
              <input
                id="reset-pw-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={loading}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {loading ? "Updating…" : "Update password"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
