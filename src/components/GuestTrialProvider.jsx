// GuestTrialProvider.jsx — tracks guest (non-logged-in) trial extraction usage
// and exposes helpers to trigger the sign-up prompt after TRIAL_LIMIT extractions.
// Must be placed INSIDE AuthProvider so it can react to login events.
//
// Key design: trial count is NEVER cleared on login. This prevents the bypass
// where a user extracts N times as a guest → logs in → logs out → gets a fresh
// trial. On logout, count is re-read from localStorage so prior usage is honoured.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider.jsx";
import {
  getGuestCount,
  incrementGuestCount,
  shouldShowTrialPrompt,
  isTrialLimitReached,
  TRIAL_LIMIT,
} from "../lib/guestTrialService.js";

const GuestTrialContext = createContext({
  count: 0,
  showPrompt: false,
  setShowPrompt: () => {},
  trackGuestExtraction: () => {},
  TRIAL_LIMIT: 3,
});

export function useGuestTrial() {
  return useContext(GuestTrialContext);
}

export function GuestTrialProvider({ children }) {
  const { user } = useAuth();
  const [count, setCount] = useState(getGuestCount);
  const [showPrompt, setShowPrompt] = useState(false);
  // Track previous user so we can detect login ↔ logout transitions.
  const prevUserRef = useRef(user);

  useEffect(() => {
    const wasLoggedIn = prevUserRef.current != null;
    const isLoggedIn  = user != null;

    if (isLoggedIn && !wasLoggedIn) {
      // ── Guest → Logged in ──────────────────────────────────────────────────
      // Close any active trial prompt. Do NOT clear the localStorage count —
      // if the user logs out again their prior usage history is restored and
      // they cannot get a fresh 3-extraction window by cycling sign-in/out.
      setShowPrompt(false);
    } else if (!isLoggedIn && wasLoggedIn) {
      // ── Logged in → Logged out ─────────────────────────────────────────────
      // Re-read count from localStorage so prior guest usage is reinstated.
      // This is the key fix: after sign-out the count picks up where it left
      // off (e.g. if they extracted 3+ times before signing up, they're still
      // over the limit and the prompt will fire on the next extraction attempt).
      const restored = getGuestCount();
      setCount(restored);
      // If already past the limit, show the prompt immediately so they know.
      if (isTrialLimitReached(restored)) {
        setShowPrompt(true);
      }
    }

    prevUserRef.current = user;
  }, [user]);

  const trackGuestExtraction = useCallback(
    (n = 1) => {
      if (user) return; // logged-in users don't consume trial credits
      const newCount = incrementGuestCount(n);
      setCount(newCount);
      if (shouldShowTrialPrompt(newCount)) {
        setShowPrompt(true);
      }
    },
    [user],
  );

  return (
    <GuestTrialContext.Provider
      value={{ count, showPrompt, setShowPrompt, trackGuestExtraction, TRIAL_LIMIT }}
    >
      {children}
    </GuestTrialContext.Provider>
  );
}
