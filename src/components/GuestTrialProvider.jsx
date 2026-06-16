// GuestTrialProvider.jsx — tracks guest (non-logged-in) trial extraction usage
// and exposes helpers to trigger the sign-up prompt after TRIAL_LIMIT extractions.
// Must be placed INSIDE AuthProvider so it can react to login events.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider.jsx";
import {
  clearGuestTrial,
  getGuestCount,
  incrementGuestCount,
  shouldShowTrialPrompt,
  TRIAL_LIMIT,
} from "../lib/guestTrialService.js";

const GuestTrialContext = createContext({
  count: 0,
  showPrompt: false,
  setShowPrompt: () => {},
  trackGuestExtraction: () => {},
});

export function useGuestTrial() {
  return useContext(GuestTrialContext);
}

export function GuestTrialProvider({ children }) {
  const { user } = useAuth();
  const [count, setCount] = useState(getGuestCount);
  const [showPrompt, setShowPrompt] = useState(false);
  const prevUserRef = useRef(user);

  // When the user logs in, clear trial state so returning users start fresh.
  useEffect(() => {
    if (user && !prevUserRef.current) {
      clearGuestTrial();
      setCount(0);
      setShowPrompt(false);
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
