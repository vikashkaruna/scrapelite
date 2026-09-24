// useBusy — one "DatIQ is working" state per page.
//
//   const { busy, label, run } = useBusy();
//   run("Deleting watchlist…", () => api.delete(id));
//
// `busy` disables the page's action buttons, so a slow action cannot be
// pressed twice; <BusyIndicator label={label} /> shows what is running. Only
// one action at a time: a second run() while busy is ignored and returns
// undefined, which is what a disabled button would have done.
import { useCallback, useRef, useState } from "react";

export function useBusy() {
  const [label, setLabel] = useState(null);
  const active = useRef(false);
  const run = useCallback(async (text, fn) => {
    if (active.current) return undefined;
    active.current = true;
    setLabel(text || "Working…");
    try { return await fn(); } finally { active.current = false; setLabel(null); }
  }, []);
  return { busy: label !== null, label, run };
}
