import { GuestTrialModal } from "datiq";

// GuestTrialModal takes NO props — it is entirely driven by GuestTrialProvider's
// context (useGuestTrial()). GuestTrialProvider seeds its `showHardBlock` state
// SYNCHRONOUSLY on mount from localStorage ("datiq.guestTrial": {count, batchCount})
// whenever a stored counter already exceeds a hard limit — so an already-exhausted
// guest sees the block immediately on page load, not just after one more attempt.
// That mount-time path is the ONLY state this static, mount-only capture harness
// can reach: the soft prompt (`showPrompt`) is set true exclusively by a LIVE
// trackGuestExtraction()/trackGuestBatchRun() call fired after a real extraction
// completes — GuestTrialProvider's mount effect never sets it, so it has no
// reachable render here without simulating an actual extraction. See
// .design-sync/learnings/wave-account-modals.md for that limitation.
//
// The capture harness does a full page navigation per story (`?story=<Name>`),
// which re-runs this whole module from scratch — so reading the `story` query
// param at module scope lets each of the two stories below seed a DIFFERENT
// trial state into the SAME localStorage key before GuestTrialProvider's mount
// effect ever reads it, even though both stories share one browser profile.
function seedGuestTrial() {
  try {
    const params = new URLSearchParams(window.location.search);
    const story = params.get("story");
    const base = { count: 0, batchCount: 0, sid: "guest_preview_9f2a" };
    // Defaults (SINGLE_HARD_LIMIT=10, BATCH_HARD_LIMIT=5) come from
    // guestTrialService.js and are what globalSettingsService falls back to
    // when nothing is cached — clear any stale cached admin config from an
    // earlier capture run so those built-in defaults are what's in effect.
    localStorage.removeItem("datiq.globalSettings");
    const state =
      story === "HardBlockBatchRuns"
        ? { ...base, batchCount: 6 } // >= BATCH_HARD_LIMIT (5) -> reason "batch"
        : { ...base, count: 12 }; // >= SINGLE_HARD_LIMIT (10) -> reason "single"
    localStorage.setItem("datiq.guestTrial", JSON.stringify(state));
  } catch {
    /* no-op outside a browser */
  }
}
seedGuestTrial();

// The capture harness's own single-story wrapper (`.ds-single`) sets
// `transform: translateZ(0)` on the mount root purely as a paint-perf hint.
// CSS spec fallout: a `transform` on an ancestor makes it the containing
// block for `position:fixed` descendants — GuestTrialModal's real overlay is
// `position:fixed; inset:0`, so inside that ONE wrapper (grid-mode capture
// never hits this, only the harness's per-story `?story=` navigation) it
// resolves `inset:0` against a zero-height ancestor instead of the
// viewport, collapsing the overlay to ~40px and shooting the centered
// modal ~220px above frame 0 — headline/icon cropped, only the lower half
// visible. Nothing to do with DatIQ: Shell never wraps children in a
// transform, so this never happens in the real app. Neutralized locally by
// resetting that one ancestor's transform from inside the story — doesn't
// touch app source, just undoes a preview-harness-only artifact.
function ResetSingleStoryTransform() {
  return <style>{`.ds-single{transform:none!important}`}</style>;
}

export function HardBlockSingleUrl() {
  return (
    <>
      <ResetSingleStoryTransform />
      <GuestTrialModal />
    </>
  );
}

export function HardBlockBatchRuns() {
  return (
    <>
      <ResetSingleStoryTransform />
      <GuestTrialModal />
    </>
  );
}
