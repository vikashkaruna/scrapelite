// TemplateRunProvider — owns an in-flight TEMPLATE run, above the router.
//
// ── WHY THIS SITS ABOVE THE ROUTER ─────────────────────────────────────────
// Exactly the reason BatchRunProvider does. A template run is 2-4 scrapes plus
// 2-3 AI calls — tens of seconds — and it used to live in TemplateRunner's own
// component body with its own in-page progress bar. So navigating away both
// HID the progress and ABANDONED the run, and the product had three different
// progress surfaces for the same shape of work (single extraction, batch,
// template) with three different visual languages.
//
// Lifting it here gives the run the same two properties batch already has:
// it survives navigation, and it reports through the ONE shared dock.
//
// ⚠️ The provider owns the run but NOT the result rendering. Templates.jsx
// still renders the finished run, because that is a page concern; this holds
// only what has to outlive the page.
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useNavigate } from "react-router";

const Ctx = createContext(null);

export function useTemplateRun() {
  return useContext(Ctx);
}

export function TemplateRunProvider({ children }) {
  // { templateKey, title, message, percent, status: "running"|"done"|"error",
  //   runId, error }
  const [job, setJob] = useState(null);
  const navigate = useNavigate();
  // Lets a caller abandon a run's UI updates without cancelling the promise
  // chain, which we cannot interrupt mid-fetch.
  const activeRef = useRef(0);

  const startTemplateRun = useCallback((templateKey, title) => {
    const token = ++activeRef.current;
    setJob({ templateKey, title, message: "Starting…", percent: 5, status: "running" });
    return token;
  }, []);

  const updateTemplateRun = useCallback((token, patch) => {
    // A stale run must not paint over a newer one — same guard the extraction
    // auto-save needed when a late save could revert a newer extraction.
    if (token !== activeRef.current) return;
    setJob((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const finishTemplateRun = useCallback((token, { runId, error } = {}) => {
    if (token !== activeRef.current) return;
    setJob((prev) => prev && ({
      ...prev,
      status: error ? "error" : "done",
      percent: 100,
      message: error ? String(error) : "Done",
      runId: runId || prev.runId,
      error: error || null,
    }));
  }, []);

  const clearTemplateRun = useCallback(() => {
    activeRef.current += 1;
    setJob(null);
  }, []);

  const viewTemplateRun = useCallback(() => {
    setJob((prev) => {
      if (prev?.runId) navigate(`/templates?runId=${encodeURIComponent(prev.runId)}`);
      else if (prev?.templateKey) navigate(`/templates?key=${encodeURIComponent(prev.templateKey)}`);
      return null;
    });
  }, [navigate]);

  return (
    <Ctx.Provider value={{
      job, startTemplateRun, updateTemplateRun, finishTemplateRun,
      clearTemplateRun, viewTemplateRun,
    }}>
      {children}
    </Ctx.Provider>
  );
}
