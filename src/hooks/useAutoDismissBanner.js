// useAutoDismissBanner — lets an advisory banner leave on its own, the way the
// GA4 consent bar does, once the reader has had time to read it.
//
// The dwell time scales with the copy (a long message gets longer) and is
// clamped, so a one-liner doesn't linger and a paragraph isn't snatched away.
// Hovering or focusing the banner pauses the clock — someone mid-sentence, or
// about to click the CTA, must never have it vanish under the pointer.
//
// ⚠️ AUTO-HIDING IS NOT DISMISSING. It is session-scoped (sessionStorage) and
// purely cosmetic: an explicit ✕ still writes the banner's own monthly
// dismissal, and the banner may legitimately come back next session while the
// condition that raised it (low credits, an offer) still holds. Auto-hide must
// never write that monthly key — an ignored banner is not a declined one.
//
// Phases: "shown" → "leaving" (CSS collapses height/opacity) → "gone".
import { useCallback, useEffect, useRef, useState } from "react";

export const MIN_DWELL_MS = 8_000;
export const MAX_DWELL_MS = 20_000;
const BASE_MS = 4_000;
const PER_CHAR_MS = 55;
export const LEAVE_MS = 350;

/** Reading time for a message of `textLength` characters, clamped. */
export function dwellMs(textLength = 0) {
  const n = Number.isFinite(textLength) ? Math.max(0, textLength) : 0;
  return Math.min(MAX_DWELL_MS, Math.max(MIN_DWELL_MS, BASE_MS + n * PER_CHAR_MS));
}

const seenKey = (id) => `datiq.banner.${id}.autoHidden`;
function wasAutoHidden(id) {
  try { return sessionStorage.getItem(seenKey(id)) === "1"; } catch { return false; }
}
function markAutoHidden(id) {
  try { sessionStorage.setItem(seenKey(id), "1"); } catch { /* private mode */ }
  announceBannerChange();
}

/** True once a banner has auto-hidden this session (lets a sibling banner take its slot). */
export function bannerAutoHidden(id) { return wasAutoHidden(id); }

export const BANNER_CHANGE_EVENT = "datiq:banner-change";
/** Tell sibling banners a slot freed up (auto-hide or an explicit ✕). */
export function announceBannerChange() {
  try { window.dispatchEvent(new Event(BANNER_CHANGE_EVENT)); } catch { /* no window */ }
}

/**
 * @param {string}  id          stable banner id (scopes the session flag)
 * @param {boolean} active      true only while the banner would actually render
 * @param {number}  textLength  characters of copy, for the dwell time
 * @returns {{ phase: "shown"|"leaving"|"gone", hoverProps: object, hide: () => void }}
 */
export function useAutoDismissBanner(id, { active, textLength }) {
  const [phase, setPhase] = useState(() => (wasAutoHidden(id) ? "gone" : "shown"));
  const [paused, setPaused] = useState(false);
  const hideTimer = useRef(null);
  const goneTimer = useRef(null);

  const hide = useCallback(() => {
    setPhase((p) => (p === "shown" ? "leaving" : p));
  }, []);

  // Start (or restart after a pause) the reading clock.
  useEffect(() => {
    if (!active || paused || phase !== "shown") return undefined;
    hideTimer.current = setTimeout(hide, dwellMs(textLength));
    return () => clearTimeout(hideTimer.current);
  }, [active, paused, phase, textLength, hide]);

  // After the collapse animation, unmount and remember for this session.
  useEffect(() => {
    if (phase !== "leaving") return undefined;
    goneTimer.current = setTimeout(() => {
      markAutoHidden(id);
      setPhase("gone");
    }, LEAVE_MS);
    return () => clearTimeout(goneTimer.current);
  }, [phase, id]);

  const hoverProps = {
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
    onFocus: () => setPaused(true),
    onBlur: () => setPaused(false),
  };

  return { phase, hoverProps, hide };
}
