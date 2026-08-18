// GuestTrialProvider.jsx — tracks guest (non-logged-in) trial extraction usage.
//
// Responsibilities:
//  1. Soft gate  — show sign-up prompt after guest_trial_soft_limit extractions
//                  (re-prompts every guest_trial_reprompt_interval after limit).
//  2. Hard block — prevent further use after hard limits are reached:
//                  • guest_single_hard_limit for single-URL extractions
//                  • guest_batch_hard_limit  for batch runs
//  3. Logout cleanup — on sign-out, clear all sensitive localStorage data so a
//                  subsequent user on the same machine sees a clean slate. The
//                  trial count itself is NEVER cleared (prevents bypass via
//                  sign-in/out cycling). The app navigates to "/" after cleanup
//                  to flush any in-memory state held by route components.
//
// Must be placed INSIDE AuthProvider (to react to login events) and INSIDE
// BrowserRouter (to call useNavigate).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider.jsx";
import {
  getGuestCount,
  getGuestBatchCount,
  incrementGuestCount,
  incrementGuestBatchCount,
  shouldShowTrialPrompt,
  isTrialLimitReached,
  isSingleHardLimitReached,
  isBatchHardLimitReached,
  TRIAL_LIMIT,
  SINGLE_HARD_LIMIT,
  BATCH_HARD_LIMIT,
} from "../lib/guestTrialService.js";
import { getSettings, loadSettings } from "../lib/globalSettingsService.js";

// Keys cleared on logout — must NOT include the guest trial key itself
// (that persistence is intentional to prevent bypass via sign-in/out cycling).
const SENSITIVE_KEYS = [
  "datiq.saved",       // saved extractions list
  "datiq.current",     // current extraction shown on /preview
  "datiq.enrichments", // enrichment cache per URL
  "datiq.batchRuns",   // batch run history
  "datiq.batchMap",    // extractionId → batchRunId map
  "datiq.batchDraft",  // batch textarea draft
  "datiq.stats",       // cached aggregate stats (stale after logout)
];

const GuestTrialContext = createContext({
  count: 0,
  batchCount: 0,
  showPrompt: false,
  setShowPrompt: () => {},
  showHardBlock: false,
  setShowHardBlock: () => {},
  hardBlockReason: "single",
  checkCanExtractSingle: () => ({ allowed: true }),
  checkCanExtractBatch: () => ({ allowed: true }),
  requireGuestCredit: () => true,
  trackGuestExtraction: () => {},
  trackGuestBatchRun: () => {},
  TRIAL_LIMIT,
  SINGLE_LIMIT: SINGLE_HARD_LIMIT,
  BATCH_LIMIT: BATCH_HARD_LIMIT,
});

export function useGuestTrial() {
  return useContext(GuestTrialContext);
}

export function GuestTrialProvider({ children }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Load limits from cache immediately; async-refresh from server on mount.
  const [settings, setSettings] = useState(getSettings);
  const [count, setCount] = useState(getGuestCount);
  const [batchCount, setBatchCount] = useState(getGuestBatchCount);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showHardBlock, setShowHardBlock] = useState(false);
  const [hardBlockReason, setHardBlockReason] = useState("single");

  // NOTE: an over-limit guest is deliberately NOT shown the hard block on mount
  // any more (R17 #118 used to do that).
  //
  // That behaviour existed because an extraction attempt was the only trigger,
  // and four extraction paths didn't check at all — so mount-time visibility
  // was doing defensive work. requireGuestCredit() now runs on every path, so
  // the modal enforces nothing on mount: it can be closed, and closing grants
  // nothing. It is purely a notification there, and GuestTrialBanner already
  // does that job permanently and without blocking the page.
  //
  // Which leaves only the cost: a full-viewport interstitial thrown at someone
  // who has just loaded the homepage and done nothing — no intent, no context,
  // nothing invested. The same dialog at the moment they actually try to
  // extract has all three. Keeping it here made the gate more annoying without
  // making it any stronger.

  const prevUserRef = useRef(user);

  // Async-refresh settings once on mount.
  useEffect(() => {
    loadSettings().then(setSettings).catch(() => {});
  }, []);

  // Derived limits (fall back to built-in constants when settings haven't loaded yet).
  const softLimit       = settings.guest_trial_soft_limit      ?? TRIAL_LIMIT;
  const repromptInterval = settings.guest_trial_reprompt_interval ?? 2;
  const singleHardLimit = settings.guest_single_hard_limit     ?? SINGLE_HARD_LIMIT;
  const batchHardLimit  = settings.guest_batch_hard_limit      ?? BATCH_HARD_LIMIT;

  // ── Auth transition handler ──────────────────────────────────────────────────
  useEffect(() => {
    const wasLoggedIn = prevUserRef.current != null;
    const isLoggedIn  = user != null;

    if (isLoggedIn && !wasLoggedIn) {
      // ── Guest → Logged in ────────────────────────────────────────────────────
      // Close any active prompt. Count is NOT cleared — if they log out later the
      // prior usage is restored and they can't get a fresh window by cycling auth.
      setShowPrompt(false);
      setShowHardBlock(false);

    } else if (!isLoggedIn && wasLoggedIn) {
      // ── Logged in → Logged out ───────────────────────────────────────────────
      // Clear all sensitive localStorage keys so the next user on this machine
      // cannot see the previous user's saved extractions, enrichments, etc.
      SENSITIVE_KEYS.forEach((k) => {
        try { localStorage.removeItem(k); } catch { /* skip */ }
      });

      // Restore trial counts from localStorage (the trial key is preserved).
      const restored      = getGuestCount();
      const restoredBatch = getGuestBatchCount();
      setCount(restored);
      setBatchCount(restoredBatch);

      // Re-apply the appropriate gate for the restored counts.
      if (isSingleHardLimitReached(restored, singleHardLimit)) {
        setShowPrompt(false);
        setHardBlockReason("single");
        setShowHardBlock(true);
      } else if (isBatchHardLimitReached(restoredBatch, batchHardLimit)) {
        setShowPrompt(false);
        setHardBlockReason("batch");
        setShowHardBlock(true);
      } else if (isTrialLimitReached(restored, softLimit)) {
        setShowHardBlock(false); // ensure hard block cleared before soft prompt
        setShowPrompt(true);
      } else {
        // Below all limits — clean slate
        setShowHardBlock(false);
        setShowPrompt(false);
      }

      // Navigate to home so in-memory React state (Dashboard items, etc.) is flushed.
      navigate("/");
    }

    prevUserRef.current = user;
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pre-flight checks (called before an extraction starts) ───────────────────

  const checkCanExtractSingle = useCallback(() => {
    if (user) return { allowed: true };
    if (isSingleHardLimitReached(count, singleHardLimit)) {
      return { allowed: false, reason: "single" };
    }
    return { allowed: true };
  }, [user, count, singleHardLimit]);

  const checkCanExtractBatch = useCallback(() => {
    if (user) return { allowed: true };
    if (isBatchHardLimitReached(batchCount, batchHardLimit)) {
      return { allowed: false, reason: "batch" };
    }
    return { allowed: true };
  }, [user, batchCount, batchHardLimit]);

  /**
   * The single gate every extraction entry point must call.
   *
   * Returns true if the caller may proceed; returns false AND raises the hard
   * block if not. Checking and blocking used to be two separate steps that each
   * caller wired up itself, which is how four paths — batch per-row Retry,
   * the Schedules "Run now" button, the battle card, and quick-action enrich —
   * ended up reaching extractStructure() with no gate and no counter at all.
   *
   * `kind` is "batch" for a multi-URL run, anything else for a single URL.
   */
  const requireGuestCredit = useCallback(
    (kind = "single") => {
      if (user) return true; // logged-in users are never gated
      const check = kind === "batch" ? checkCanExtractBatch() : checkCanExtractSingle();
      if (check.allowed) return true;
      setHardBlockReason(check.reason);
      setShowHardBlock(true);
      return false;
    },
    [user, checkCanExtractBatch, checkCanExtractSingle],
  );

  // ── Post-extraction tracking (called after a successful extraction) ───────────

  const trackGuestExtraction = useCallback(
    (n = 1) => {
      if (user) return; // logged-in users don't consume trial credits
      const newCount = incrementGuestCount(n);
      setCount(newCount);
      if (isSingleHardLimitReached(newCount, singleHardLimit)) {
        setHardBlockReason("single");
        setShowHardBlock(true);
      } else if (shouldShowTrialPrompt(newCount, softLimit, repromptInterval)) {
        setShowPrompt(true);
      }
    },
    [user, singleHardLimit, softLimit, repromptInterval],
  );

  const trackGuestBatchRun = useCallback(
    (n = 1) => {
      if (user) return;
      // Increment the batch-specific counter (for batch hard limit).
      const newBatchCount = incrementGuestBatchCount(n);
      setBatchCount(newBatchCount);
      // Also increment the combined counter (for soft prompt).
      const newCount = incrementGuestCount(n);
      setCount(newCount);

      if (isBatchHardLimitReached(newBatchCount, batchHardLimit)) {
        setHardBlockReason("batch");
        setShowHardBlock(true);
      } else if (shouldShowTrialPrompt(newCount, softLimit, repromptInterval)) {
        setShowPrompt(true);
      }
    },
    [user, batchHardLimit, softLimit, repromptInterval],
  );

  return (
    <GuestTrialContext.Provider
      value={{
        count,
        batchCount,
        showPrompt,
        setShowPrompt,
        showHardBlock,
        setShowHardBlock,
        hardBlockReason,
        setHardBlockReason,
        checkCanExtractSingle,
        checkCanExtractBatch,
        requireGuestCredit,
        trackGuestExtraction,
        trackGuestBatchRun,
        TRIAL_LIMIT: softLimit,
        SINGLE_LIMIT: singleHardLimit,
        BATCH_LIMIT: batchHardLimit,
      }}
    >
      {children}
    </GuestTrialContext.Provider>
  );
}
