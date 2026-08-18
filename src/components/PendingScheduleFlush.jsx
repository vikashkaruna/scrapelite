// PendingScheduleFlush.jsx — finishes saving a schedule that was built while
// signed out, once the user signs in.
//
// Mounted once, globally, in the Shell. It renders nothing; it exists purely to
// watch the auth transition. It lives here rather than in ScheduleEditor or
// /schedules because OAuth sign-in navigates the whole document away and comes
// back on whatever route the callback lands on — the editor that stashed the
// schedule is long unmounted by then.
//
// See lib/pendingSchedule.js for why a schedule can't just be left in
// localStorage the way an extraction can.
import { useEffect, useRef } from "react";
import { useAuth } from "./AuthProvider.jsx";
import { useToast } from "./Toast.jsx";
import { saveSchedule } from "../lib/schedulerService.js";
import { takePendingSchedule, clearPendingSchedule } from "../lib/pendingSchedule.js";

export default function PendingScheduleFlush({ onSaved }) {
  const { user } = useAuth();
  const showToast = useToast();
  // Guards against a double-flush if the effect re-runs while the save is
  // still in flight (React 18 StrictMode double-invokes effects in dev).
  const flushingRef = useRef(false);

  useEffect(() => {
    // Deliberately NOT gated on a signed-out → signed-in transition. An OAuth
    // callback can land with the session already restored, so this component's
    // very first render may show a user and never see the transition. The
    // stash itself is the trigger: if one exists and there's a session, save
    // it. takePendingSchedule() consumes it, so this can't repeat.
    if (!user || flushingRef.current) return;

    const pending = takePendingSchedule();
    if (!pending) return;

    flushingRef.current = true;
    saveSchedule(pending)
      .then((saved) => {
        showToast(`Schedule saved — "${saved?.label || pending.label || "your schedule"}" is now running.`, "calendar-clock");
        onSaved?.(saved || pending);
      })
      .catch((err) => {
        // Put it back so the next attempt (or a manual retry) can still use it,
        // unless the server rejected it on the merits — a plan denial or a
        // validation error will fail identically every time.
        console.warn("[DatIQ] Pending schedule save failed:", err);
        if (err?.status >= 500 || err?.status === undefined) {
          // Transient — keep it for another go.
          // (takePendingSchedule already removed it, so write it back.)
          import("../lib/pendingSchedule.js").then((m) => m.setPendingSchedule(pending));
          showToast("Couldn't save your schedule yet — we'll retry.", "alert-triangle");
        } else {
          clearPendingSchedule();
          showToast(err?.message || "Couldn't save your schedule.", "alert-triangle");
        }
      })
      .finally(() => { flushingRef.current = false; });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
