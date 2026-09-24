// Toast.jsx — lightweight global toast via React context.
import { createContext, useCallback, useContext, useRef, useState } from "react";
import Icon from "./Icon.jsx";

const ToastContext = createContext(() => {});

/**
 * Subscribe to the ToastProvider. Returns the show function DIRECTLY (not
 * an object wrapping it) — i.e. `const showToast = useToast()` is the
 * correct usage; `useToast().showToast` is a TypeError. Calling
 * `showToast(msg, icon)` renders a `.toast` node for ~2.6s.
 *
 * The default `icon` is "check-circle" (any lucide name registered in
 * `Icon.jsx` works).
 *
 * Optional third argument `{ tone }`: "error" | "warn" | "info". A failure
 * used to render with the same success tick as a success — every error toast
 * in the app said "done" in its icon. A toned toast gets a matching icon and
 * colour, stays long enough to read (5s), and an error is announced as an
 * alert. Omitting it keeps the original behaviour exactly.
 *
 * @returns {(msg: string, icon?: string, opts?: { tone?: "error"|"warn"|"info" }) => void}
 */
export function useToast() {
  return useContext(ToastContext);
}

const TONE_ICON = { error: "alert-triangle", warn: "alert-circle", info: "info" };

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const showToast = useCallback((msg, icon, opts = {}) => {
    const tone = TONE_ICON[opts?.tone] ? opts.tone : null;
    setToast({ msg, icon: icon || (tone ? TONE_ICON[tone] : "check-circle"), tone, id: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), tone ? 5000 : 2600);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && (
        <div className={`toast${toast.tone ? ` toast-${toast.tone}` : ""}`} key={toast.id} role={toast.tone === "error" ? "alert" : "status"}>
          <Icon name={toast.icon} size={18} /> {toast.msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}
