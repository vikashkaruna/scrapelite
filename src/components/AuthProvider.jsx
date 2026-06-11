// AuthProvider.jsx — global auth context.
// Tracks the current Supabase session, exposes user info and modal controls.
// Also keeps apiClient in sync with the current JWT so all API calls carry auth.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getSession, onAuthStateChange } from "../lib/authService.js";
import { setAuthToken } from "../lib/apiClient.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    // If the confirmation link (or OAuth redirect) lands with #error=... in the
    // hash, open the modal immediately so the user sees a friendly message
    // instead of a blank page. Clean the hash so it doesn't persist on reload.
    const hash = window.location.hash;
    if (hash.includes("error=")) {
      const params = new URLSearchParams(hash.slice(1));
      const raw = params.get("error_description") || "Authentication failed.";
      setAuthError(raw.replace(/\+/g, " "));
      setShowAuthModal(true);
      window.history.replaceState(null, "", window.location.pathname);
    }

    // Restore existing session (e.g. after OAuth redirect or page reload).
    getSession().then((s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setAuthToken(s?.access_token ?? null);
      setAuthLoading(false);
    });

    // Keep state in sync for all auth events: sign-in, sign-out, token refresh.
    const unsub = onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setAuthToken(s?.access_token ?? null);
      if (_event === "SIGNED_IN") { setShowAuthModal(false); setAuthError(""); }
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
