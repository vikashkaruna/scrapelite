// AuthProvider.jsx — global auth context.
// Tracks the current Supabase session, exposes user info and modal controls.
// Also keeps apiClient in sync with the current JWT so all API calls carry auth.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getSession, onAuthStateChange } from "../lib/authService.js";
import { setAuthToken } from "../lib/apiClient.js";
import { applyTrialCredit } from "../lib/usageService.js";
import { linkConsentToUser } from "../lib/consentService.js";
import { claimBillingSession } from "../lib/billingRepo.js";
import { clearEntitlementCache } from "../lib/entitlementClient.js";

const AuthContext = createContext(null);

/**
 * Returns true if the current URL hash looks like an OAuth / magic-link /
 * recovery callback (i.e. it carries session tokens or an error). The Supabase
 * auth-js v2 client auto-detects these in its `_initialize()` and is supposed
 * to clean the hash itself — but only if the project the URL was issued for
 * matches the project the client is configured with. When they don't match,
 * the auto-detect silently bails and the hash stays in the URL forever, which
 * is what the user sees after a Google sign-in that "fails" silently.
 */
function hasAuthHash(hash) {
  if (!hash || hash.length < 2) return false;
  const body = hash.slice(1); // strip leading '#'
  return (
    body.includes("access_token=") ||
    body.includes("refresh_token=") ||
    body.includes("error=") ||
    body.includes("error_description=") ||
    body.includes("code=") || // PKCE flow
    body.includes("type=recovery")
  );
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    // ── 1. Clean up the URL hash on the FIRST mount ───────────────────────
    // Three callbacks can land here:
    //   a) #error=access_denied&error_description=... — bail and open modal
    //   b) #access_token=...&refresh_token=... — implicit grant (legacy)
    //   c) ?code=... — PKCE grant (preferred, but Supabase may put it in hash)
    //
    // For (a) we surface the error. For (b)/(c) we let the Supabase client's
    // own _initialize() parse the hash and notify us via onAuthStateChange,
    // BUT we also strip the hash right after the init promise resolves so
    // the user never sees `datiq.app/#access_token=eyJ...` in their address
    // bar (token-in-URL is also a leaky-URL smell, even when it's fragment).
    const hash = window.location.hash;
    const search = window.location.search;
    const queryLooksLikeAuthCallback = /[?&](code|access_token|error|error_description|provider_token)=/.test(search);

    if (hash.includes("error=")) {
      const params = new URLSearchParams(hash.slice(1));
      const raw = params.get("error_description") || params.get("error") || "Authentication failed.";
      setAuthError(raw.replace(/\+/g, " "));
      setShowAuthModal(true);
      // Clean BOTH hash and any leftover query so reloads don't replay the error.
      window.history.replaceState(null, "", window.location.pathname);
    } else if (hasAuthHash(hash) || queryLooksLikeAuthCallback) {
      // Clean the URL immediately. The Supabase client reads the URL during
      // its own auto-init, so we don't lose the tokens by doing this — the
      // client's internal snapshot is taken from window.location at the start
      // of _initialize(). After that, the URL can be cleaned.
      // (If the auto-init bails because the project the hash was issued for
      //  doesn't match the configured project, the user still gets a clean URL
      //  and the modal-with-error fallback below kicks in.)
      window.history.replaceState(null, "", window.location.pathname);
    }

    // ── 2. Restore existing session ───────────────────────────────────────
    // The Supabase client auto-initializes on first API call (i.e. this
    // getSession()) and parses any auth hash it finds. If parse succeeds
    // the resolved session is non-null; if parse fails the resolved session
    // is null. Either way we record the outcome.
    //
    // `signInDetected` is the trigger for the "callback landed but no
    // session" fallback below. It's ONLY set when the URL had success-shaped
    // auth params (access_token / code / refresh_token / type=recovery) — NOT
    // when the URL had `error=`, because the error branch above already
    // surfaces its own specific message and we don't want to overwrite it
    // with a generic "couldn't start your session" when the underlying cause
    // is "user clicked Cancel" or "provider denied access".
    const hasSuccessShape =
      hash.includes("access_token=") ||
      hash.includes("refresh_token=") ||
      hash.includes("code=") ||
      hash.includes("type=recovery") ||
      /[?&](code|access_token|provider_token)=/.test(search);
    let signInDetected = hasSuccessShape;

    getSession().then((s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setAuthToken(s?.access_token ?? null);
      setAuthLoading(false);

      // OAuth callback landed but no session was produced. The Supabase
      // client's auto-init failed silently (most often: the project the
      // hash was issued for is not the project the client is configured
      // with — see NETLIFY-ENVIRONMENTS.md §6). Tell the user something
      // instead of leaving them on what looks like a working but empty page.
      // /reset-password owns its own recovery-link error UI (see ResetPassword.jsx)
      // and is a better fit for a failed recovery exchange than this generic,
      // OAuth-project-mismatch-flavored message — showing both stacks two
      // uncoordinated error surfaces on one failure. Let that page be the only
      // one that reports it.
      if (signInDetected && !s && window.location.pathname !== "/reset-password") {
        setAuthError(
          "Sign-in completed but we couldn't start your session. " +
            "This usually means the site is pointing at a different sign-in " +
            "service than the one that handled the OAuth callback. " +
            "Please try again, or use email + password."
        );
        setShowAuthModal(true);
      }
    });

    // ── 3. Subscribe to auth state changes ────────────────────────────────
    // Keep state in sync for all auth events: sign-in, sign-out, token refresh.
    const unsub = onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setAuthToken(s?.access_token ?? null);
      // Any successful session (fresh sign-in OR an existing session being
      // hydrated from storage) means we can close the auth modal and clear
      // the "OAuth callback landed but no session produced" error.
      if (_event === "SIGNED_IN" || _event === "INITIAL_SESSION") {
        setShowAuthModal(false);
        setAuthError("");
        signInDetected = false;
      }
      if (_event === "SIGNED_IN") {
        // FR-Z-02 (Q2 2026-07-15): grant the once-only trial credit on signup
        // (25 extractions for the Free plan). Idempotent — re-runs are no-ops.
        try { applyTrialCredit("free"); } catch { /* localStorage unavailable */ }
        // Attach this now-known user to the consent record their anonymous
        // session already wrote. Most consent is given before signup, so
        // without this back-fill the majority of records would never be
        // traceable to a person — which is the population an access or
        // erasure request actually concerns. Does NOT change the choice.
        try {
          linkConsentToUser().catch(() => { /* best-effort */ });
        } catch { /* best-effort */ }
        // Claim this browser's billing session for the signed-in user, so a
        // purchase made before signing in (or in a previous session) is bound
        // to the account rather than to localStorage. Idempotent, and refuses
        // if the session already belongs to somebody else. Then drop the
        // entitlement cache so the first render after sign-in reflects the
        // freshly-merged plan rather than the signed-out one.
        try {
          claimBillingSession()
            .catch(() => { /* best-effort */ })
            .finally(() => { clearEntitlementCache(); });
        } catch { /* best-effort */ }
        // F49 — fire-and-forget welcome email. The server is idempotent
        // (it checks the `welcomeEmailSent` user-metadata flag before
        // sending) so this is safe to call on every sign-in.
        try {
          const u = s?.user;
          if (u && u.id && u.email) {
            const name = u.user_metadata?.name || u.user_metadata?.full_name || "";
            fetch("/api/welcome-email", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${s.access_token}` },
              body: JSON.stringify({ userId: u.id, email: u.email, name, planLabel: "Free" }),
              keepalive: true,
            }).catch(() => { /* best-effort */ });
          }
        } catch { /* best-effort */ }
      }
      if (_event === "SIGNED_OUT") {
        // The cached entitlement belongs to the user who just left. Leaving it
        // behind would let the next person on this browser see their plan.
        try { clearEntitlementCache(); } catch { /* ignore */ }
      }
    });

    return unsub;
  }, []);

  const openAuth = useCallback((mode = "signin") => { setAuthMode(mode); setShowAuthModal(true); }, []);
  const closeAuth = useCallback(() => { setShowAuthModal(false); setAuthError(""); }, []);

  return (
    <AuthContext.Provider
      value={{ user, session, authLoading, showAuthModal, authMode, authError, openAuth, closeAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be called inside <AuthProvider>");
  return ctx;
}
