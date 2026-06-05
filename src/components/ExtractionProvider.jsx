// ExtractionProvider.jsx — orchestrates the extract → preview → save flow and
// shares the "current" extraction across routes.
import { createContext, useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { extractStructure } from "../lib/firecrawlService.js";
import { summarize } from "../lib/aiService.js";
import { saveExtraction } from "../lib/extractionsRepo.js";
import { useErrorModal } from "./ErrorModal.jsx";
import { uid } from "../lib/utils.js";

const ExtractionContext = createContext(null);

export function useExtraction() {
  return useContext(ExtractionContext);
}

export function ExtractionProvider({ children }) {
  const navigate = useNavigate();
  const showError = useErrorModal();
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState("");
  const reqId = useRef(0);
  const lastUrl = useRef("");

  // Run Firecrawl + AI, then route to the preview screen.
  const extract = useCallbackSafe(async (url) => {
    const id = ++reqId.current;
    lastUrl.current = url;
    setLoadingUrl(url);
    setLoading(true);
    try {
      const structure = await extractStructure(url);
      const ai_summary = await summarize(structure);
      if (reqId.current !== id) return; // superseded by a newer extraction
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
      setLoading(false);
      navigate("/");
      // Show modal with a "Try again" button that re-submits the same URL.
      showError(err, {}, () => extract(lastUrl.current));
    }
  });

  // Persist the current (or given) extraction.
  const save = async (data) => {
    const saved = await saveExtraction(data || current);
    return saved;
  };

  const view = (item) => {
    setCurrent(item);
    navigate("/preview");
  };

  const value = { current, setCurrent, loading, loadingUrl, extract, save, view };
  return <ExtractionContext.Provider value={value}>{children}</ExtractionContext.Provider>;
}

// Stable callback ref — keeps the handler identity stable without useCallback.
function useCallbackSafe(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useRef((...args) => ref.current(...args)).current;
}
