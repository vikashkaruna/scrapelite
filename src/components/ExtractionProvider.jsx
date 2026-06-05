// ExtractionProvider.jsx — orchestrates the extract → preview → save flow and
// shares the "current" extraction across routes.
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { extractStructure } from "../lib/firecrawlService.js";
import { summarize } from "../lib/aiService.js";
import { saveExtraction } from "../lib/extractionsRepo.js";
import { uid } from "../lib/utils.js";

const ExtractionContext = createContext(null);

export function useExtraction() {
  return useContext(ExtractionContext);
}

export function ExtractionProvider({ children }) {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(null); // extraction shown on /preview
  const [loading, setLoading] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState("");
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  // Run Firecrawl + AI, then route to the preview screen.
  const extract = useCallbackSafe(async (url) => {
    const id = ++reqId.current;
    setError(null);
    setLoadingUrl(url);
    setLoading(true);
    try {
      const structure = await extractStructure(url);
      const ai_summary = await summarize(structure);
      if (reqId.current !== id) return; // a newer extraction superseded this one
      const result = {
        ...structure,
        ai_summary,
        id: uid(),
        created_at: new Date().toISOString(),
      };
      setCurrent(result);
      setLoading(false);
      navigate("/preview");
    } catch (err) {
      if (reqId.current !== id) return;
      console.error("[ScrapeLite] Extraction failed:", err);
      setError(err?.message || "Something went wrong while extracting this page.");
      setLoading(false);
      navigate("/");
    }
  });

  // Persist the current (or given) extraction, then go to the dashboard.
  const save = async (data) => {
    const saved = await saveExtraction(data || current);
    return saved;
  };

  const view = (item) => {
    setCurrent(item);
    navigate("/preview");
  };

  const value = { current, setCurrent, loading, loadingUrl, error, setError, extract, save, view };
  return <ExtractionContext.Provider value={value}>{children}</ExtractionContext.Provider>;
}

// React doesn't expose useCallback under a different name; tiny local alias to
// keep the handler stable without re-creating per render isn't critical here,
// so we just return the function as-is.
function useCallbackSafe(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useRef((...args) => ref.current(...args)).current;
}
