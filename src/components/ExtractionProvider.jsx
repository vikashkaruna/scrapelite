// ExtractionProvider.jsx — orchestrates the extract → preview → save flow and
// shares the "current" extraction across routes.
import { createContext, useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { extractStructure } from "../lib/firecrawlService.js";
import { summarize, categorizeLinks } from "../lib/aiService.js";
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
  const lastOpts = useRef({});

  // Run Firecrawl + AI, then route to the preview screen.
  const extract = useCallbackSafe(async (url, options = {}) => {
    const id = ++reqId.current;
    lastUrl.current = url;
    lastOpts.current = options;
    setLoadingUrl(url);
    setLoading(true);
    try {
      const structure = await extractStructure(url, options);
      // Summarize and AI-tag the links concurrently.
      const [ai_summary, links] = await Promise.all([
        summarize(structure),
        categorizeLinks(structure.links, structure.url),
      ]);
      if (reqId.current !== id) return; // superseded by a newer extraction
      const result = {
        ...structure,
        links,
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
      // Show modal with a "Try again" button that re-submits the same URL + options.
      showError(err, {}, () => extract(lastUrl.current, lastOpts.current));
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
